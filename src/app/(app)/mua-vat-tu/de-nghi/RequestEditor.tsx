"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NumInput from "../../NumInput";
import { loadBudgetAction, saveRequestAction, submitRequestAction, type RequestItemInput } from "@/lib/proc-actions";
import type { BudgetRow } from "@/lib/proc-budget";
import { confirmNear } from "@/app/(app)/confirm-near";
import { fmtQty } from "@/lib/fmt-qty";
import { FormApprovals, FormLetterhead, FormSheet } from "../forms/FormBits";
import ExcelGrid, { xcell, type GridPaste } from "../../ExcelGrid";

const GRID_COLS = ["name", "spec", "unit", "contractQty", "finalQty", "forecastQty", "quantity", "note"] as const;
const NUM_COLS = new Set(["contractQty", "finalQty", "forecastQty", "quantity"]);

// Lập / sửa phiếu đề nghị = nhập thẳng trên GIẤY ĐỀ XUẤT VẬT TƯ (theo mẫu Excel của BCH).
// Bảng liệt kê sẵn TOÀN BỘ vật tư theo DT-CP của dự án (TH Vật Tư): người dùng chỉ nhập KL đặt hàng đợt này
// (và KL hợp đồng / dự kiến QT / dự trù HT nếu có); khi lưu chỉ giữ các dòng có KL đặt hàng.
// Công trình = tên dự án; Hạng mục = gói thầu (packageName) của dự án.

type Row = RequestItemInput & { key: string };
type ProjectOpt = { id: string; name: string; packageName: string; label: string };
const fq = fmtQty;
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
let seq = 0;

// Dòng bảng = mọi vật tư DT-CP (lấy dòng đã nhập của phiếu nếu có) + vật tư ngoài DT-CP đã có trong phiếu
function buildRows(budget: BudgetRow[], items: RequestItemInput[]): Row[] {
  const used = new Set<number>();
  const rows: Row[] = budget.map((b) => {
    const k = items.findIndex((it, i) => !used.has(i) && it.resourceId === b.resourceId);
    if (k >= 0) {
      used.add(k);
      return { ...items[k], key: `r${seq++}` };
    }
    return { key: `r${seq++}`, resourceId: b.resourceId, name: b.name, spec: "", unit: b.unit, quantity: 0, note: "", ...b.last };
  });
  return [...rows, ...items.filter((_, i) => !used.has(i)).map((it) => ({ ...it, key: `r${seq++}` }))];
}

export default function RequestEditor({
  requestId,
  projects,
  projectId: initProjectId,
  budget: initBudget,
  initial,
}: {
  requestId: string | null;
  projects: ProjectOpt[];
  projectId: string;
  budget: BudgetRow[];
  initial: { title: string; neededDate: string; note: string; contractNo: string; category: string; area: string; batchNo: number; items: RequestItemInput[] };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(initial.title);
  const [neededDate, setNeededDate] = useState(initial.neededDate);
  const [note, setNote] = useState(initial.note);
  const [contractNo, setContractNo] = useState(initial.contractNo);
  const [area, setArea] = useState(initial.area);
  const [batchNo, setBatchNo] = useState(initial.batchNo);
  const [projectId, setProjectId] = useState(initProjectId);
  const [projName, setProjName] = useState(projects.find((p) => p.id === initProjectId)?.name ?? "");
  const [budget, setBudget] = useState(initBudget);
  const [rows, setRows] = useState<Row[]>(() => buildRows(initBudget, initial.items));
  const [q, setQ] = useState("");
  const [onlyFilled, setOnlyFilled] = useState(!!requestId);
  const [loading, startLoad] = useTransition();
  const budgetById = useMemo(() => new Map(budget.map((b) => [b.resourceId, b])), [budget]);
  const today = useMemo(() => new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }), []);
  const names = useMemo(() => [...new Set(projects.map((p) => p.name))], [projects]);
  const packages = projects.filter((p) => p.name === projName);
  const project = projects.find((p) => p.id === projectId);

  const filled = rows.filter((r) => r.quantity > 0 || (!r.resourceId && (r.name || r.unit)));
  const shown = useMemo(() => {
    const words = strip(q).split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      if (onlyFilled && !(r.quantity > 0 || !r.resourceId)) return false;
      if (!words.length) return true;
      const b = r.resourceId ? budgetById.get(r.resourceId) : undefined;
      const hay = strip(`${r.name} ${r.spec} ${b?.code ?? ""}`);
      return words.every((w) => hay.includes(w));
    });
  }, [rows, q, onlyFilled, budgetById]);

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addFree = () => {
    setRows((rs) => [...rs, { key: `r${seq++}`, resourceId: null, name: "", spec: "", unit: "", quantity: 0, note: "", contractQty: null, finalQty: null, forecastQty: null }]);
    setQ("");
  };

  // Dán vùng copy từ Excel: ghi lần lượt vào các ô theo dòng / cột đang hiện
  const pasteGrid = (cells: GridPaste[]) =>
    setRows((rs) =>
      rs.map((r) => {
        const cs = cells.filter((c) => c.row === r.key);
        if (!cs.length) return r;
        const p: Row = { ...r };
        for (const c of cs) {
          if (c.col === "quantity") p.quantity = c.num ?? 0;
          else if (NUM_COLS.has(c.col)) (p as Record<string, unknown>)[c.col] = c.num;
          else (p as Record<string, unknown>)[c.col] = c.text;
        }
        return p;
      }),
    );

  const changeProject = async (id: string) => {
    if (id === projectId) return;
    if (filled.length && !(await confirmNear("Đổi công trình / hạng mục sẽ bỏ khối lượng đang nhập. Tiếp tục?"))) return false;
    setProjectId(id);
    setRows([]);
    setBudget([]);
    if (id)
      startLoad(async () => {
        const r = await loadBudgetAction(id);
        if (!r.ok) return window.alert(r.error);
        setBudget(r.budget);
        setRows(buildRows(r.budget, []));
        setContractNo((v) => v || r.defaults.contractNo);
        setArea((v) => v || r.defaults.area);
        setBatchNo(r.defaults.batchNo);
      });
    return true;
  };

  const save = (submit: boolean) =>
    start(async () => {
      const items: RequestItemInput[] = filled.map((r) => ({ resourceId: r.resourceId, name: r.name, spec: r.spec, unit: r.unit, quantity: r.quantity, note: r.note, contractQty: r.contractQty, finalQty: r.finalQty, forecastQty: r.forecastQty }));
      const category = project?.packageName || initial.category;
      const r = await saveRequestAction(requestId, { projectId, title, neededDate, note, contractNo, category, area, items });
      if (!r.ok) return window.alert(r.error);
      if (submit) {
        const s = await submitRequestAction(r.id!);
        if (!s.ok) return window.alert(s.error);
      }
      router.push(`/mua-vat-tu/de-nghi/${r.id}`);
    });

  // ô nhập nằm trong ô bảng của mẫu, chữ Times như mẫu
  const cell = "w-full min-w-0 bg-sky-50/60 px-1 py-0.5 font-[inherit] text-[13px] outline-none focus:bg-sky-100";
  const head = "w-full min-w-0 border-b border-dotted border-slate-500 bg-sky-50/60 px-1 font-[inherit] text-[13px] font-bold outline-none focus:bg-sky-100 disabled:bg-transparent";
  const input = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
  const red = "text-red-600";

  return (
    <div className="space-y-3">
      <FormSheet>
        <FormLetterhead />
        <h1 className="mt-2 text-center text-[22px] font-bold">GIẤY ĐỀ XUẤT VẬT TƯ</h1>
        <p className="text-center text-[13px] font-bold italic">(Dùng cho công trình)</p>

        <table className="mt-2 w-full text-[13px] font-bold">
          <tbody>
            <tr>
              <td className="w-36 py-1 pl-8">Công trình :</td>
              <td className="py-1 pr-6">
                <select
                  className={head}
                  value={projName}
                  disabled={!!requestId}
                  onChange={async (e) => {
                    const name = e.target.value;
                    const ps = projects.filter((p) => p.name === name);
                    const ok = await changeProject(ps.length === 1 ? ps[0].id : "");
                    if (ok !== false) setProjName(name);
                  }}
                >
                  <option value="">— Chọn công trình —</option>
                  {names.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </td>
              <td className="w-[30%] py-1">
                <span className="flex items-center gap-1 whitespace-nowrap">
                  Khu vực thi công: <input className={head} value={area} onChange={(e) => setArea(e.target.value)} placeholder="VD: Block A" />
                </span>
              </td>
            </tr>
            <tr>
              <td className="py-1 pl-8">Số hợp đồng :</td>
              <td className="py-1 pr-6">
                <input className={head} value={contractNo} onChange={(e) => setContractNo(e.target.value)} placeholder="VD: 74/2026/HĐ/NNC-TN" />
              </td>
              <td className={`py-1 ${red}`}>
                Đợt số: &nbsp;{projectId ? batchNo : "…"} &nbsp;&nbsp; Ngày: {today}
              </td>
            </tr>
            <tr>
              <td className="py-1 pl-8">Hạng mục :</td>
              <td className="py-1 pr-6">
                {packages.length > 1 && !requestId ? (
                  <select className={head} value={projectId} onChange={(e) => changeProject(e.target.value)}>
                    <option value="">— Chọn hạng mục (gói thầu) —</option>
                    {packages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.packageName || "(không tên gói thầu)"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="block border-b border-dotted border-slate-500 px-1">{project?.packageName || initial.category || " "}</span>
                )}
              </td>
              <td className={`py-1 ${red}`}>
                <span className="flex items-center gap-1 whitespace-nowrap">
                  Ngày cần hàng : <input type="date" className={`${head} ${red}`} value={neededDate} onChange={(e) => setNeededDate(e.target.value)} />
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        {projectId && (
          <div className="mt-2 flex flex-wrap items-center gap-3 font-sans text-sm">
            <input className="w-72 rounded border border-slate-300 px-2 py-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lọc vật tư (không cần dấu)..." />
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} />
              Chỉ hiện vật tư đã nhập KL đặt hàng
            </label>
            <span className="text-slate-500">
              {filled.length} / {rows.length} vật tư có KL đặt hàng
            </span>
            <span className="flex-1" />
            <button type="button" onClick={addFree} className="text-sky-700 hover:underline">
              + Thêm vật tư ngoài DT-CP
            </button>
          </div>
        )}

        <ExcelGrid cols={[...GRID_COLS]} onPaste={pasteGrid}>
        <table className="tmn-grid mt-1 text-[13px]">
          <thead className="font-bold">
            <tr className="text-center">
              <th className="w-9">STT</th>
              <th className="min-w-48">Tên vật tư</th>
              <th className="min-w-32">Quy cách</th>
              <th className="w-14">ĐVT</th>
              <th className="w-24">Tổng khối lượng theo bảng DT-CP (TĐ1)</th>
              <th className="w-24">Tổng khối lượng hợp đồng</th>
              <th className="w-28">Tổng khối lượng dự kiến quyết toán (không bao gồm hao hụt)</th>
              <th className="w-24">Tổng khối lượng dự trù khi hoàn thành dự án</th>
              <th className="w-28">Khối lượng lũy kế đơn hàng mua đến đợt trước</th>
              <th className={`w-28 ${red}`}>Khối lượng đặt hàng đợt này (ngày {today})</th>
              <th className="w-28">Khối lượng lũy kế đơn hàng mua đến đợt này</th>
              <th className="min-w-32">Ghi chú</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const b = r.resourceId ? budgetById.get(r.resourceId) : undefined;
              const sameHere = b ? rows.filter((x) => x.resourceId === r.resourceId).reduce((s, x) => s + x.quantity, 0) : r.quantity;
              const prev = b ? b.requested : null;
              const cum = b ? b.requested + sameHere : r.quantity;
              const over = b ? cum - b.boqQty : 0;
              const has = r.quantity > 0;
              return (
                <tr key={r.key} className={has ? "bg-yellow-50" : ""}>
                  <td className="text-center">{i + 1}</td>
                  <td className={b ? "" : "p-0"} {...xcell(r.key, "name")}>{b ? r.name : <input className={cell} value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} placeholder="Tên vật tư (ngoài DT-CP)" />}</td>
                  <td className="p-0" {...xcell(r.key, "spec")}>
                    <input className={`${cell} text-center`} value={r.spec} onChange={(e) => set(r.key, { spec: e.target.value })} />
                  </td>
                  <td className={b ? "text-center" : "p-0"} {...xcell(r.key, "unit")}>{b ? r.unit : <input className={`${cell} text-center`} value={r.unit} onChange={(e) => set(r.key, { unit: e.target.value })} />}</td>
                  <td className="num">{b ? fq(b.boqQty) : <span className="text-[11px] text-amber-700">Ngoài DT-CP</span>}</td>
                  {(["contractQty", "finalQty", "forecastQty"] as const).map((f) => (
                    <td key={f} className="p-0" {...xcell(r.key, f)}>
                      <NumInput decimals qty allowEmpty allowFormula value={r[f]} onCommit={(v) => set(r.key, { [f]: v })} className={`${cell} text-right`} />
                    </td>
                  ))}
                  <td className="num">{prev ? fq(prev) : ""}</td>
                  <td className="p-0" {...xcell(r.key, "quantity")}>
                    <NumInput decimals qty allowFormula value={r.quantity || null} onCommit={(v) => set(r.key, { quantity: v ?? 0 })} onLive={(v) => set(r.key, { quantity: v })} className={`${cell} text-right font-bold ${red}`} />
                  </td>
                  <td className={`num ${over > 1e-9 ? "font-bold text-red-600" : "text-blue-700"}`}>
                    {has || prev ? fq(cum) : ""}
                    {over > 1e-9 && has && <span className="block text-[11px]">⚠ vượt DT-CP {fq(over)}</span>}
                  </td>
                  <td className="p-0" {...xcell(r.key, "note")}>
                    <input className={cell} value={r.note} onChange={(e) => set(r.key, { note: e.target.value })} />
                  </td>
                  <td className="text-center">
                    {!b && (
                      <button type="button" className="font-sans text-red-500 hover:text-red-700" title="Xoá dòng" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {(!projectId || loading || shown.length === 0) && (
              <tr>
                <td colSpan={13} className="py-3 text-center font-sans text-sm text-slate-500">
                  {!projectId
                    ? "👆 Chọn Công trình và Hạng mục — toàn bộ vật tư theo DT-CP của hạng mục sẽ hiện trong bảng này."
                    : loading
                      ? "Đang tải vật tư theo DT-CP..."
                      : rows.length === 0
                        ? "Hạng mục chưa có vật tư trong TH Vật Tư (chưa nhập BOQ / gán định mức) — dùng “+ Thêm vật tư ngoài DT-CP”."
                        : "Không có vật tư khớp bộ lọc."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </ExcelGrid>

        <FormApprovals
          cols={[
            { title: "Cán bộ đề xuất", state: "wait" },
            { title: "QLDA/CHT", state: "none" },
          ]}
        />
      </FormSheet>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="font-medium text-slate-700">Nội dung / đợt (hiện ở danh sách phiếu)</span>
            <input className={`${input} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Đợt 3 - thép, bê tông móng block B" />
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-700">Ghi chú gửi CHT</span>
            <input className={`${input} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
          <button type="button" disabled={pending || !projectId} onClick={() => save(true)} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50">
            Lưu & trình CHT duyệt
          </button>
          <button type="button" disabled={pending || !projectId} onClick={() => save(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
            Lưu nháp
          </button>
          <span className="text-xs text-slate-500">Chỉ lưu các dòng có KL đặt hàng đợt này.</span>
        </div>
      </div>
    </div>
  );
}
