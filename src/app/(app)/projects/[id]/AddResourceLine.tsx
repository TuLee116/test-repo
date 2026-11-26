"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addWorkItemResourceLineAction, createInlineResourceAction, similarWorkItemsForLineAction, type SimilarWorkItem } from "@/lib/actions";
import SimilarLineDialog from "./SimilarLineDialog";
import { normalizeText } from "@/lib/text-normalize";
import QtyFormulaHint from "@/app/(app)/QtyFormulaHint";

type Res = { id: string; code: string; name: string; unit: string; sourceType: string; unitPrice: number };
const CAT: Record<string, string> = { VT: "Vật liệu", NC: "Nhân công", TB: "Máy TC" };

// Danh mục hao phí tải 1 lần cho cả trang (hàng trăm form dùng chung), tránh nhét cả danh mục vào từng dòng công tác
let cache: Res[] | null = null;
let loading: Promise<Res[]> | null = null;
function loadResources(): Promise<Res[]> {
  if (cache) return Promise.resolve(cache);
  loading ??= fetch("/api/resources", { credentials: "same-origin" })
    .then(async (r) => {
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) throw new Error(r.status === 401 || r.redirected ? "Phiên đăng nhập đã hết — hãy tải lại trang và đăng nhập lại" : `Máy chủ trả lỗi ${r.status}`);
      return (await r.json()) as { items: Res[] };
    })
    .then((j) => (cache = j.items))
    .catch((e) => {
      loading = null; // cho phép thử lại, không kẹt mãi ở lần lỗi đầu
      throw e;
    });
  return loading;
}

// Form "Thêm dòng hao phí" của CHI TIẾT: gõ tên / mã để tìm hao phí có sẵn (hiện nhiều kết quả để chọn), hoặc tạo hao phí mới ngay tại đây.
export default function AddResourceLine({ workItemId, projectId }: { workItemId: string; projectId: string }) {
  const [category, setCategory] = useState<"VT" | "NC" | "TB">("VT");
  const [all, setAll] = useState<Res[]>(cache ?? []);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Res | null>(null);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", unit: "", price: "" });
  const [error, setError] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [pending, start] = useTransition();
  // sau khi thêm: đề xuất bổ sung cùng hao phí cho các công tác cùng loại trong dự án
  const [similar, setSimilar] = useState<{ resourceId: string; name: string; items: SimilarWorkItem[] } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const retry = () => {
    setLoadErr("");
    loadResources()
      .then(setAll)
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Không tải được danh mục"));
  };

  const matches = useMemo(() => {
    const t = normalizeText(q);
    if (!t) return all.filter((r) => r.sourceType === category).slice(0, 30);
    const words = t.split(" ");
    return all
      .map((r) => ({ r, hay: normalizeText(`${r.code} ${r.name}`) }))
      .filter((x) => words.every((w) => x.hay.includes(w)))
      .sort((a, b) => Number(b.r.sourceType === category) - Number(a.r.sourceType === category))
      .slice(0, 30)
      .map((x) => x.r);
  }, [q, all, category]);

  const submit = () =>
    start(async () => {
      setError("");
      try {
        let rid = picked?.id;
        let isNew = false;
        if (!rid && creating) {
          if (!draft.name.trim()) return setError("Nhập tên hao phí mới");
          const created = await createInlineResourceAction({ name: draft.name, unit: draft.unit, unitPrice: Number(draft.price.replace(/\D/g, "")) || 0, category });
          cache = [...(cache ?? []), created];
          rid = created.id;
          isNew = true;
        }
        if (!rid) return setError("Chọn hao phí có sẵn hoặc tạo hao phí mới");
        const fd = new FormData();
        fd.set("workItemId", workItemId);
        fd.set("resourceId", rid);
        fd.set("category", category);
        fd.set("quantity", qty);
        if (isNew) fd.set("newResource", "1");
        const added = await addWorkItemResourceLineAction(fd);
        if (!added.ok) return setError(added.error ?? "Lỗi");
        const resName = picked?.name ?? draft.name;
        const items = await similarWorkItemsForLineAction(projectId, workItemId, rid);
        if (items.length) setSimilar({ resourceId: rid, name: resName, items });
        setPicked(null);
        setQ("");
        setQty("");
        setCreating(false);
        setDraft({ name: "", unit: "", price: "" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lỗi");
      }
    });

  const cls = "rounded border border-slate-300 px-1.5 py-1 text-xs";
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-[10px] text-slate-500">Loại</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as "VT" | "NC" | "TB")} className={cls}>
          {Object.entries(CAT).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div ref={box} className="relative">
        <label className="block text-[10px] text-slate-500">Hao phí (gõ tên hoặc mã để tìm)</label>
        {picked ? (
          <div className={`${cls} flex w-72 items-center justify-between gap-2 bg-blue-50`}>
            <span className="truncate">
              <b>{picked.code}</b> — {picked.name} <span className="text-slate-400">({picked.unit})</span>
            </span>
            <button type="button" onClick={() => setPicked(null)} className="text-slate-500 hover:text-red-600" title="Chọn lại">
              ×
            </button>
          </div>
        ) : creating ? (
          <div className="flex items-center gap-1">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Tên hao phí mới" className={`${cls} w-52`} autoFocus />
            <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="ĐVT" className={`${cls} w-14`} />
            <input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^\d]/g, "") })} placeholder="Đơn giá" inputMode="numeric" className={`${cls} w-24 text-right`} />
            <button type="button" onClick={() => setCreating(false)} className="text-slate-500 hover:text-red-600" title="Bỏ tạo mới">
              ×
            </button>
          </div>
        ) : (
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              if (!cache) retry();
            }}
            onFocus={() => {
              setOpen(true);
              retry();
            }}
            placeholder="VD: xi măng, bê tông M300, nhân công..."
            className={`${cls} w-72`}
          />
        )}
        {open && !picked && !creating && (
          <div className="absolute left-0 top-full z-30 mt-0.5 max-h-64 w-[26rem] max-w-[90vw] overflow-y-auto rounded border border-slate-300 bg-white text-xs shadow-xl">
            {all.length === 0 && !loadErr && <p className="px-2 py-2 text-slate-400">Đang tải danh mục…</p>}
            {loadErr && (
              <p className="px-2 py-2 text-red-600">
                Không tải được danh mục hao phí: {loadErr}.{" "}
                <button type="button" onClick={retry} className="underline">
                  Thử lại
                </button>
              </p>
            )}
            {all.length > 0 && matches.length === 0 && <p className="px-2 py-2 text-slate-400">Không tìm thấy hao phí nào khớp.</p>}
            {matches.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setPicked(r);
                  setOpen(false);
                }}
                className="flex w-full items-baseline justify-between gap-2 border-b border-slate-100 px-2 py-1 text-left hover:bg-blue-50"
              >
                <span className="min-w-0 truncate">
                  <b className="text-slate-500">{r.code}</b> {r.name}
                </span>
                <span className="shrink-0 whitespace-nowrap text-slate-400">
                  {CAT[r.sourceType] ?? r.sourceType} · {r.unit} · {Math.round(r.unitPrice).toLocaleString("vi-VN")}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setDraft({ name: q, unit: "", price: "" });
                setOpen(false);
              }}
              className="w-full bg-slate-50 px-2 py-1.5 text-left font-medium text-blue-700 hover:bg-blue-50"
            >
              ＋ Tạo hao phí mới{q.trim() ? ` “${q.trim()}”` : ""}
            </button>
          </div>
        )}
      </div>

      <div>
        <label className="block text-[10px] text-slate-500">Định mức hao phí</label>
        <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="VD: 1/3 hoặc =2*0,5" title="Nhập số hoặc công thức kiểu Excel" className={`${cls} w-28`} />
        <QtyFormulaHint value={qty} />
      </div>
      <button type="button" disabled={pending || !qty.trim()} onClick={submit} className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40">
        {pending ? "Đang thêm..." : "+ Thêm dòng hao phí"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
      {similar && (
        <SimilarLineDialog sourceWorkItemId={workItemId} resourceId={similar.resourceId} resourceName={similar.name} items={similar.items} onClose={() => setSimilar(null)} />
      )}
    </div>
  );
}
