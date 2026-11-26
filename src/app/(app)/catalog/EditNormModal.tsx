"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createNormAction, updateWorkItemNormAction } from "@/lib/actions";
import { parseQuantityInput } from "@/lib/formula";
import type { CatalogLine, CatalogRow } from "./CatalogTable";

type Res = { id: string; code: string; name: string; unit: string; sourceType: "VT" | "TB" | "NC" };
type Line = { key: number; id?: string; category: "VT" | "NC" | "TB"; code: string; name: string; unit: string; quantity: string };

const SECTIONS: { cat: "VT" | "NC" | "TB"; title: string; noun: string }[] = [
  { cat: "VT", title: "1. Vật tư", noun: "vật tư" },
  { cat: "NC", title: "2. Nhân công", noun: "nhân công" },
  { cat: "TB", title: "3. Máy thi công", noun: "máy" },
];

let resCache: Res[] | null = null;
let keySeq = 1;
const emptyLine = (cat: "VT" | "NC" | "TB"): Line => ({ key: keySeq++, category: cat, code: "", name: "", unit: "", quantity: "" });
const fromLine = (l: CatalogLine): Line => ({
  key: keySeq++,
  id: l.id,
  category: l.category,
  code: l.code,
  name: l.name,
  unit: l.unit,
  quantity: l.formula ? "=" + l.formula : String(l.quantity).replace(".", ","),
});

// Cửa sổ điều chỉnh định mức 1 công tác (chỉ quản trị viên): mã / tên công tác, ĐVT, và từng dòng hao phí (thêm / sửa / xoá)
export default function EditNormModal({ row, isNew = false }: { row: CatalogRow; isNew?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [resources, setResources] = useState<Res[]>(resCache ?? []);
  const [code, setCode] = useState(row.code);
  const [name, setName] = useState(row.name);
  const [unit, setUnit] = useState(row.unit);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function openModal() {
    setCode(row.code);
    setName(row.name);
    setUnit(row.unit);
    setLines(isNew ? (["VT", "NC", "TB"] as const).map((c) => emptyLine(c)) : row.lines.map(fromLine));
    setError("");
    setOpen(true);
    // Danh sách hao phí dùng chung cả trang: đã tải thì đưa ngay vào form này (form của công tác khác mở
    // sau vẫn có gợi ý), đồng thời tải lại bản mới nhất (gồm hao phí người khác / form trước vừa tạo)
    if (resCache) setResources(resCache);
    fetch("/api/resources")
      .then((r) => r.json())
      .then((d) => {
        resCache = d.items as Res[];
        setResources(resCache);
      })
      .catch(() => {});
  }

  const patch = (key: number, p: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));

  function onNameChange(l: Line, value: string) {
    const hit = resources.find((r) => r.sourceType === l.category && r.name.toLowerCase() === value.trim().toLowerCase());
    patch(l.key, hit && !l.id ? { name: value, code: hit.code, unit: hit.unit } : { name: value });
  }
  function onCodeChange(l: Line, value: string) {
    const hit = resources.find((r) => r.sourceType === l.category && r.code.toLowerCase() === value.trim().toLowerCase());
    patch(l.key, hit && !l.id ? { code: value, name: hit.name, unit: hit.unit } : { code: value });
  }

  function save() {
    setError("");
    for (const l of lines.filter((x) => x.name.trim() || x.code.trim())) {
      const q = parseQuantityInput(l.quantity);
      if (!q.ok) return setError(`Định mức của "${l.name || l.code}" không hợp lệ: ${q.error}`);
    }
    start(async () => {
      const payload = {
        code,
        name,
        unit,
        lines: lines.map((l) => ({ id: l.id, category: l.category, code: l.code, name: l.name, unit: l.unit, quantity: l.quantity })),
      };
      const res = isNew ? await createNormAction(payload) : await updateWorkItemNormAction(row.id, payload);
      if (!res.ok) setError(res.error ?? "Lỗi không xác định");
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  const th = "px-1.5 py-1 text-left text-[11px] font-medium text-slate-600";
  const field = "w-full rounded border border-slate-300 px-1.5 py-1 text-xs";

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openModal();
        }}
        className={isNew ? "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" : "rounded border border-blue-500 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"}
      >
        {isNew ? "＋ Thêm định mức thủ công" : "✎ Điều chỉnh định mức"}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="my-6 w-full max-w-5xl rounded-lg bg-white p-5 text-slate-800 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">{isNew ? "Thêm định mức thủ công" : "Điều chỉnh định mức"}</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs text-amber-700">
              Lưu ý: sửa mã / tên / ĐVT của một vật tư, nhân công, máy sẽ đổi cho <b>tất cả công tác</b> đang dùng nó. Định mức nhập số hoặc công thức (VD =1/3). Muốn xoá hao phí thì bấm ×.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr_100px]">
              <div>
                <label className="block text-xs font-medium text-slate-700">Mã định mức</label>
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={isNew ? "VD: TM.001" : ""} className={field} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Tên công tác</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">ĐVT</label>
                <input value={unit} onChange={(e) => setUnit(e.target.value)} className={field} />
              </div>
            </div>

            {SECTIONS.map((sec) => (
              <div key={sec.cat} className="mt-4">
                <div className="flex items-center justify-between rounded-t bg-green-100 px-2 py-1">
                  <h3 className="text-sm font-semibold text-slate-900">{sec.title}</h3>
                  <button type="button" onClick={() => setLines((p) => [...p, emptyLine(sec.cat)])} className="rounded bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white">
                    + Thêm dòng
                  </button>
                </div>
                <table className="w-full border border-t-0 border-slate-200">
                  <thead>
                    <tr>
                      <th className={`${th} w-36`}>Mã {sec.noun}</th>
                      <th className={th}>Tên {sec.noun}</th>
                      <th className={`${th} w-20`}>ĐVT</th>
                      <th className={`${th} w-32`}>Định mức</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines
                      .filter((l) => l.category === sec.cat)
                      .map((l) => (
                        <tr key={l.key} className="border-t border-slate-100">
                          <td className="px-1 py-0.5">
                            <input list={`ec-${sec.cat}`} value={l.code} onChange={(e) => onCodeChange(l, e.target.value)} placeholder="Mã" className={field} />
                          </td>
                          <td className="px-1 py-0.5">
                            <input list={`en-${sec.cat}`} value={l.name} onChange={(e) => onNameChange(l, e.target.value)} placeholder="Tên" className={field} />
                          </td>
                          <td className="px-1 py-0.5">
                            <input value={l.unit} onChange={(e) => patch(l.key, { unit: e.target.value })} className={field} />
                          </td>
                          <td className="px-1 py-0.5">
                            <input value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} placeholder="1 hoặc =1/3" className={`${field} text-right`} />
                          </td>
                          <td className="px-1 text-center">
                            <button type="button" title="Xoá dòng hao phí này" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} className="text-red-500 hover:bg-red-100">
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    {lines.filter((l) => l.category === sec.cat).length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-2 py-2 text-center text-xs text-slate-400">
                          (chưa có dòng {sec.noun} — bấm &quot;+ Thêm dòng&quot;)
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <datalist id={`ec-${sec.cat}`}>
                  {resources.filter((r) => r.sourceType === sec.cat).map((r) => (
                    <option key={r.id} value={r.code} label={r.name} />
                  ))}
                </datalist>
                <datalist id={`en-${sec.cat}`}>
                  {resources.filter((r) => r.sourceType === sec.cat).map((r) => (
                    <option key={r.id} value={r.name} />
                  ))}
                </datalist>
              </div>
            ))}

            {error && <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
                Huỷ
              </button>
              <button type="button" disabled={pending} onClick={save} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                {pending ? "Đang lưu..." : isNew ? "Lưu định mức mới" : "Lưu định mức"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
