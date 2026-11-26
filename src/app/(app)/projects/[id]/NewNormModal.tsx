"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import NumInput from "@/app/(app)/NumInput";
import { createManualNormAction, similarUnassignedRowsAction, type NewNormLine, type UnassignedSimilarRow } from "@/lib/actions";
import AssignSimilarDialog from "./AssignSimilarDialog";
import { parseQuantityInput } from "@/lib/formula";
import QtyFormulaHint from "@/app/(app)/QtyFormulaHint";
import { createMatcher, roughCodeHints, stateHeadingHints, type CatalogEntry } from "@/lib/boq-match";
import { suggestNormCodes } from "@/lib/rough-norms";

// Danh mục (để gợi ý mã) tải 1 lần khi mở cửa sổ
type CatalogData = { items: CatalogEntry[]; usedCodes: string[]; stateHeadings: [string, string][] };
// tải mỗi lần mở cửa sổ để danh sách mã đã dùng luôn mới (không gợi ý lại mã vừa tạo)
const loadCatalog = (): Promise<CatalogData> => fetch("/api/catalog").then((r) => r.json());

// Gợi ý mã định mức mới bám theo mã định mức dự toán nhà nước: mã theo đặc điểm phần thô (cốt thép theo
// cấu kiện + đường kính, bê tông theo cấu kiện + mác...), rồi mã của các định mức gần giống + đuôi -1, -2...
function computeCodeSuggestions(desc: string, unit: string, cat: CatalogData): string[] {
  const m = createMatcher(cat.items, []).match(desc, unit);
  const similar = [...(m.workItemId ? [cat.items.find((x) => x.id === m.workItemId)?.code ?? ""] : []), ...m.candidates.map((c) => c.code)].filter(Boolean);
  return suggestNormCodes(roughCodeHints(desc, unit), similar, new Set(cat.usedCodes));
}

type Res = { id: string; code: string; name: string; unit: string; sourceType: "VT" | "TB" | "NC"; unitPrice: number };
type Line = NewNormLine & { key: number };

const SECTIONS: { cat: "VT" | "NC" | "TB"; title: string }[] = [
  { cat: "VT", title: "1. Vật tư" },
  { cat: "NC", title: "2. Nhân công" },
  { cat: "TB", title: "3. Máy thi công" },
];

let resCache: Res[] | null = null;
let keySeq = 1;
const emptyLine = (cat: "VT" | "NC" | "TB"): Line => ({ key: keySeq++, category: cat, code: "", name: "", unit: "", quantity: "", unitPrice: 0 });

// Nút + cửa sổ "Bổ sung định mức thủ công" cho công tác chưa có định mức trong dữ liệu
export default function NewNormModal({
  projectId,
  boqItemId,
  defaultName,
  defaultUnit,
  onCreated,
}: {
  projectId: string;
  boqItemId: string;
  defaultName: string;
  defaultUnit: string;
  onCreated?: () => void; // gọi sau khi tạo xong (VD đóng ô chọn mã)
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [resources, setResources] = useState<Res[]>(resCache ?? []);
  const [code, setCode] = useState("");
  const [name, setName] = useState(defaultName);
  const [unit, setUnit] = useState(defaultUnit);
  const [lines, setLines] = useState<Line[]>(() => SECTIONS.map((s) => emptyLine(s.cat)));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [codeHints, setCodeHints] = useState<string[]>([]);
  const [assignAfter, setAssignAfter] = useState<{ workItemId: string; rows: UnassignedSimilarRow[] } | null>(null);
  const [groupHints, setGroupHints] = useState<{ prefix: string; code: string; title: string }[]>([]);

  function openModal() {
    setOpen(true);
    setError("");
    loadCatalog().then((cat) => {
      setCodeHints(computeCodeSuggestions(defaultName, defaultUnit, cat));
      setGroupHints(stateHeadingHints(defaultName, defaultUnit, cat.stateHeadings));
    });
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

  // Gõ tên trùng vật tư/nhân công/máy đã có trong dữ liệu → tự điền ĐVT + đơn giá
  function onNameChange(l: Line, value: string) {
    const hit = resources.find((r) => r.sourceType === l.category && r.name.toLowerCase() === value.trim().toLowerCase());
    patch(l.key, hit ? { name: value, code: hit.code, unit: hit.unit, unitPrice: hit.unitPrice } : { name: value });
  }

  function onCodeChange(l: Line, value: string) {
    const hit = resources.find((r) => r.sourceType === l.category && r.code.toLowerCase() === value.trim().toLowerCase());
    patch(l.key, hit ? { code: value, name: hit.name, unit: hit.unit, unitPrice: hit.unitPrice } : { code: value });
  }

  function save() {
    setError("");
    const used = lines.filter((l) => l.name.trim() || l.code.trim());
    for (const l of used) {
      const q = parseQuantityInput(l.quantity);
      if (!q.ok) return setError(`Định mức của "${l.name}" không hợp lệ: ${q.error}`);
    }
    start(async () => {
      const res = await createManualNormAction(projectId, boqItemId, {
        code,
        name,
        unit,
        lines: used.map((l) => ({ category: l.category, code: l.code, name: l.name, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice })),
      });
      if (!res.ok) setError(res.error ?? "Lỗi không xác định");
      else {
        setOpen(false);
        const rows = res.workItemId ? await similarUnassignedRowsAction(projectId, boqItemId) : [];
        if (rows.length && res.workItemId) setAssignAfter({ workItemId: res.workItemId, rows });
        else onCreated?.();
        router.refresh();
      }
    });
  }

  const th = "px-1.5 py-1 text-left text-[11px] font-medium text-slate-600";
  const field = "w-full rounded border border-slate-300 px-1.5 py-1 text-xs";

  return (
    <>
      <button type="button" onClick={openModal} className="ml-2 rounded border border-blue-500 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100">
        ＋ Bổ sung định mức thủ công
      </button>
      {assignAfter && (
        <AssignSimilarDialog
          projectId={projectId}
          workItemId={assignAfter.workItemId}
          code={code}
          rows={assignAfter.rows}
          onClose={() => {
            setAssignAfter(null);
            onCreated?.();
          }}
        />
      )}

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-6 w-full max-w-4xl rounded-lg bg-white p-5 not-italic text-slate-800 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Bổ sung định mức thủ công</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Định mức mới được lưu vào danh mục chung, dùng lại được cho các gói thầu khác. Gõ mã hoặc tên trùng vật tư/nhân công/máy đã có thì hệ thống tự điền; để trống mã thì hệ thống tự đặt. Mã do người dùng đặt sẽ được quản trị viên kiểm tra và thống nhất lại.</p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_100px]">
              <div>
                <label className="block text-xs font-medium text-slate-700">Mã định mức mới *</label>
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={codeHints[0] ? `VD: ${codeHints[0]}` : "VD: AF.61611"} className={field} autoFocus />
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
            {groupHints.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-slate-500">Nhóm mã nhà nước gần nhất (TT38/2026):</span>
                {groupHints.map((g) => (
                  <button
                    key={g.prefix}
                    type="button"
                    title={`${g.code} — ${g.title}. Bấm để điền tiền tố mã rồi gõ tiếp phần chi tiết`}
                    onClick={() => setCode(g.prefix)}
                    className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-emerald-800 hover:bg-emerald-100"
                  >
                    <span className="font-mono">{g.prefix}..</span> <span className="text-emerald-700">{g.title.charAt(0) + g.title.slice(1).toLowerCase()}</span>
                  </button>
                ))}
              </div>
            )}
            {codeHints.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-slate-500">Gợi ý mã (theo mã định mức nhà nước, chưa dùng):</span>
                {codeHints.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setCode(h)}
                    className={`rounded border px-1.5 py-0.5 font-mono ${code === h ? "border-blue-500 bg-blue-600 text-white" : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"}`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}

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
                      <th className={`${th} w-32`}>Mã {sec.cat === "VT" ? "vật tư" : sec.cat === "NC" ? "nhân công" : "máy"}</th>
                      <th className={th}>Tên {sec.cat === "VT" ? "vật tư" : sec.cat === "NC" ? "nhân công" : "máy thi công"}</th>
                      <th className={`${th} w-20`}>ĐVT</th>
                      <th className={`${th} w-32`}>Định mức</th>
                      <th className={`${th} w-32`}>Đơn giá</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines
                      .filter((l) => l.category === sec.cat)
                      .map((l) => (
                        <tr key={l.key} className="border-t border-slate-100">
                          <td className="px-1 py-0.5">
                            <input
                              list={`resc-${sec.cat}`}
                              value={l.code}
                              onChange={(e) => onCodeChange(l, e.target.value)}
                              placeholder="Mã (nếu có)"
                              className={field}
                            />
                          </td>
                          <td className="px-1 py-0.5">
                            <input
                              list={`res-${sec.cat}`}
                              value={l.name}
                              onChange={(e) => onNameChange(l, e.target.value)}
                              placeholder="Gõ tên hoặc chọn từ danh sách"
                              className={field}
                            />
                          </td>
                          <td className="px-1 py-0.5">
                            <input value={l.unit} onChange={(e) => patch(l.key, { unit: e.target.value })} className={field} />
                          </td>
                          <td className="px-1 py-0.5">
                            <input value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} placeholder="1 hoặc =1/3" className={`${field} text-right`} />
                            <QtyFormulaHint value={l.quantity} />
                          </td>
                          <td className="px-1 py-0.5">
                            <NumInput value={l.unitPrice} onCommit={(v) => patch(l.key, { unitPrice: v ?? 0 })} onLive={(v) => patch(l.key, { unitPrice: v })} className={`${field} text-right`} />
                          </td>
                          <td className="px-1 text-center">
                            <button type="button" title="Xoá dòng" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} className="text-red-500 hover:bg-red-100">
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <datalist id={`resc-${sec.cat}`}>
                  {resources
                    .filter((r) => r.sourceType === sec.cat)
                    .map((r) => (
                      <option key={r.id} value={r.code} label={r.name} />
                    ))}
                </datalist>
                <datalist id={`res-${sec.cat}`}>
                  {resources
                    .filter((r) => r.sourceType === sec.cat)
                    .map((r) => (
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
                {pending ? "Đang lưu..." : "Lưu định mức & áp dụng cho công tác này"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
