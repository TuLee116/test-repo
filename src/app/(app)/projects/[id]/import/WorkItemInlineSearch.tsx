"use client";

import { useMemo, useState } from "react";
import { normalizeText } from "@/lib/text-normalize";
import { paintCount, paintLabel, paintPartsOfNorm } from "@/lib/paint";

// res: tên các hao phí bên trong định mức (để tìm theo vật tư, VD hãng sơn) - không bắt buộc
export type CatalogOption = { id: string; code: string; name: string; unit: string; res?: string; manual?: boolean };

type Hit = { it: CatalogOption; via: string | null; near: boolean };

export default function WorkItemInlineSearch({
  items,
  suggestions,
  placeholder,
  onPick,
  autoFocus,
  inline,
}: {
  items: CatalogOption[];
  // Mã gần nhất theo nội dung dòng BOQ (đã loại mã lệch loại công tác/cấu kiện/đường kính) - hiện ngay
  // khi bấm vào ô, chưa cần gõ gì.
  suggestions?: CatalogOption[];
  placeholder?: string;
  onPick: (item: CatalogOption) => void;
  autoFocus?: boolean;
  inline?: boolean; // danh sách nằm ngay dưới ô gõ (trong khung nổi), không phải lớp thả xuống
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(!!autoFocus);

  const searchIndex = useMemo(
    () =>
      items.map((it) => {
        const res = (it.res ?? "").split(" | ").filter(Boolean);
        return { it, key: normalizeText(`${it.code} ${it.name}`), res, resKeys: res.map((r) => normalizeText(r)) };
      }),
    [items]
  );

  // Không phân biệt dấu, gõ nhiều từ (không cần đúng thứ tự). Thứ tự ưu tiên: (1) tên/mã định mức chứa đủ các từ,
  // (2) tên định mức + tên hao phí bên trong chứa đủ các từ (VD "sơn Dulux"), (3) gần đúng: chứa phần lớn các từ.
  const filtered = useMemo((): Hit[] => {
    const words = normalizeText(query).split(" ").filter(Boolean);
    if (!words.length) return [];
    const exact: Hit[] = [];
    const viaRes: Hit[] = [];
    const near: { h: Hit; score: number }[] = [];
    for (const x of searchIndex) {
      if (words.every((w) => x.key.includes(w))) {
        exact.push({ it: x.it, via: null, near: false });
        continue;
      }
      const all = `${x.key} ${x.resKeys.join(" ")}`;
      const has = words.filter((w) => all.includes(w));
      const viaName = x.res.find((_, i) => words.some((w) => !x.key.includes(w) && x.resKeys[i].includes(w))) ?? null;
      if (has.length === words.length) viaRes.push({ it: x.it, via: viaName, near: false });
      else if (words.length >= 2 && has.length / words.length >= 0.6) near.push({ h: { it: x.it, via: viaName, near: true }, score: has.length });
    }
    // hệ sơn: đủ bộ bả + lót + phủ lên đầu (giữ nguyên thứ tự trong cùng mức)
    const byPaint = (l: Hit[]) => l.map((h, i) => ({ h, i, n: paintCount(paintPartsOfNorm(h.it.res)) })).sort((a, b) => b.n - a.n || a.i - b.i).map((x) => x.h);
    const out = [...byPaint(exact), ...byPaint(viaRes)];
    if (out.length < 5) out.push(...near.sort((a, b) => b.score - a.score).map((n) => n.h));
    return out.slice(0, 30);
  }, [searchIndex, query]);

  const showSuggestions = !query.trim() && !!suggestions?.length;
  const list: Hit[] = showSuggestions ? suggestions!.map((it) => ({ it, via: null, near: false })) : filtered;

  return (
    <div className="relative">
      <input
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => !inline && setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || (suggestions?.length ? "Chọn gợi ý hoặc gõ để tìm..." : "Tìm công tác...")}
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
      />
      {inline && !query.trim() && !showSuggestions && (
        <div className="mt-1.5 px-1 text-[11px] text-slate-400">Danh mục chưa có mã gần với dòng này — gõ tên hoặc mã để tìm, hoặc bổ sung định mức mới.</div>
      )}
      {(inline || open) && (query.trim() || showSuggestions) && (
        <div
          className={
            inline
              ? "mt-1.5 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white text-left"
              : "absolute z-20 mt-1 max-h-64 w-96 overflow-y-auto rounded-md border border-slate-200 bg-white text-left shadow-lg"
          }
        >
          {showSuggestions && <div className="border-b border-slate-100 bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-700">Gợi ý theo nội dung dòng BOQ</div>}
          {list.map(({ it, via, near }) => (
            <button
              type="button"
              key={it.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(it);
                setQuery("");
                setOpen(false);
              }}
              className="block w-full border-b border-slate-100 px-2 py-1.5 text-left text-xs last:border-0 hover:bg-slate-50"
            >
              <div className="whitespace-pre-line font-medium text-slate-800">{it.name}</div>
              <div className="text-[11px] text-slate-400">
                {it.code} · {it.unit}
                {near && <span className="ml-1 rounded bg-amber-50 px-1 text-amber-700">gần đúng</span>}
                {(() => {
                  const p = paintPartsOfNorm(it.res);
                  const lb = paintLabel(p);
                  return lb ? <span className={`ml-1 rounded px-1 ${paintCount(p) === 3 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{lb}</span> : null;
                })()}
              </div>
              {via && <div className="text-[10px] text-sky-700">khớp theo hao phí: {via}</div>}
            </button>
          ))}
          {list.length === 0 && <div className="px-2 py-1.5 text-xs text-slate-400">Không tìm thấy.</div>}
        </div>
      )}
    </div>
  );
}
