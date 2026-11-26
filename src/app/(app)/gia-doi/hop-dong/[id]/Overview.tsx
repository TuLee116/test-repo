import Link from "next/link";
import { LIGHT, type Khoan, type Overview as Ov } from "@/lib/hd-overview";
import AcceptanceEditor from "./AcceptanceEditor";

// Tab TỔNG QUAN QUẢN LÝ của 1 hợp đồng (mặc định khi bấm vào hợp đồng) — xem src/lib/hd-overview.ts
const fm = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("vi-VN"));
const pc = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${(Math.round(n * 100 * 10 ** d) / 10 ** d).toLocaleString("vi-VN")}%`);

function Card({ label, value, sub, tone = "" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone || "text-slate-900"}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function Bar({ k, done }: { k: Khoan; done: number | null }) {
  if (k.pct == null) return null;
  return (
    <div className="relative mt-1 h-1.5 w-full max-w-[220px] rounded-full bg-slate-100">
      <div className={`absolute inset-y-0 left-0 rounded-full ${LIGHT[k.light].bar}`} style={{ width: `${Math.min(100, k.pct * 100)}%` }} />
      {done != null && <div className="absolute -top-1 h-3.5 w-0.5 bg-slate-700" style={{ left: `${Math.min(100, done * 100)}%` }} title={`Hoàn thành ${pc(done)}`} />}
    </div>
  );
}

export default function Overview({ ov, canEdit }: { ov: Ov; canEdit: boolean }) {
  const done = ov.done.pct;
  const plan = ov.profitPlan;
  const fc = ov.profitForecast;
  const rev = ov.revenue.eff;
  const worse = plan != null && fc != null && fc < plan - 1;
  const th = "px-2 py-1.5 text-right font-medium";
  const td = "px-2 py-1.5 text-right tabular-nums align-top";
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card label="Doanh thu (HĐ + PL đã duyệt)" value={fm(rev)} sub={ov.revenue.plPending ? `PL đang trình +${fm(ov.revenue.plPending)}` : ov.revenue.pl ? `trong đó PL +${fm(ov.revenue.pl)}` : undefined} />
        <Card label="Chi phí theo DT-CP" value={fm(ov.costEff)} sub="HĐ + PL đã duyệt" />
        <Card label="Dự kiến quyết toán" value={fm(ov.forecast)} sub={ov.forecast != null && ov.costEff != null && ov.forecast > ov.costEff ? `vượt DT-CP ${fm(ov.forecast - ov.costEff)}` : "chưa vượt DT-CP"} tone={ov.forecast != null && ov.costEff != null && ov.forecast > ov.costEff ? "text-red-700" : ""} />
        <Card label="Lãi dự kiến" value={fc == null ? "—" : `${fm(fc)} · ${rev ? pc(fc / rev) : "—"}`} sub={plan == null ? undefined : `Kế hoạch ${fm(plan)} · ${rev ? pc(plan / rev) : "—"}`} tone={worse ? "text-red-700" : "text-emerald-700"} />
        <Card label="Hoàn thành (nghiệm thu CĐT)" value={pc(done)} sub={ov.acceptances.length ? `lũy kế ${fm(ov.done.total)}` : "chưa nhập nghiệm thu"} />
      </div>

      <section className="rounded-lg border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-4 py-2 font-semibold text-slate-800">Theo khoản chi phí (đồng, sau VAT)</h3>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="w-[22%] px-2 py-1.5 text-left font-medium">Khoản</th>
                <th className={th}>Giá trị theo DT-CP</th>
                <th className={`${th} w-[9%]`}>PL đang trình</th>
                <th className={th}>Đã duyệt / Lũy kế đơn hàng</th>
                <th className={th}>Đã nhận hàng / nghiệm thu</th>
                <th className={`${th} w-[10%]`}>Đã thanh toán</th>
                <th className={th}>Dự kiến quyết toán</th>
                <th className={`${th} w-[10%]`}>Chênh lệch</th>
                <th className="w-[12%] px-2 py-1.5 text-left font-medium">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {ov.rows.map((k) => (
                <tr key={k.key} className={`border-t border-slate-100 ${k.sub ? "bg-slate-50/40" : ""}`}>
                  <td className={`px-2 py-1.5 align-top ${k.sub ? "pl-6 text-slate-600" : "font-medium text-slate-800"}`}>
                    {k.label}
                    {k.src === "TH" && <span className="ml-1 text-[11px] text-amber-700" title="Không đọc được dòng này ở sheet DT-CP — cộng từ sheet TH (có thể là số trước VAT)">(theo TH)</span>}
                    <Bar k={k} done={done} />
                    {k.pct != null && <span className="block text-[11px] text-slate-500">Đã duyệt {pc(k.pct, 0)}{done != null ? ` · làm ${pc(done, 0)}` : ""}</span>}
                    {(k.docs > 0 || k.waiting > 0) && <span className="block text-[11px] text-slate-400">{k.docs} hồ sơ đã duyệt{k.waiting ? ` · ${k.waiting} đang trình` : ""}</span>}
                    {k.note && <span className={`block text-[11px] ${k.note.startsWith("Đã duyệt đi trước") ? "text-amber-700" : "text-slate-400"}`}>{k.note}</span>}
                  </td>
                  <td className={td}>{fm(k.dtcp)}</td>
                  <td className={td}>{k.plPending ? `+${fm(k.plPending)}` : ""}</td>
                  <td className={td}>{k.approved == null ? <span className="text-slate-400">chưa có dữ liệu</span> : fm(k.approved)}</td>
                  <td className={td}>{k.received == null ? "" : fm(k.received)}</td>
                  <td className={td}>{k.paid == null ? "" : fm(k.paid)}</td>
                  <td className={td}>{fm(k.forecast)}</td>
                  <td className={`${td} ${k.diff != null && k.diff < -0.5 ? "text-red-700" : k.diff ? "text-emerald-700" : ""}`}>{k.diff == null || Math.abs(k.diff) < 0.5 ? (k.diff == null ? "—" : "0") : `${k.diff > 0 ? "+" : "−"}${fm(Math.abs(k.diff))}`}</td>
                  <td className="px-2 py-1.5 align-top">{k.key !== "KHAC" && <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] ring-1 ${LIGHT[k.light].cls}`}>{LIGHT[k.light].label}</span>}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td className="px-2 py-1.5">Tổng chi phí</td>
                <td className={td}>{fm(ov.costEff)}</td>
                <td className={td} />
                <td className={td} />
                <td className={td} />
                <td className={td} />
                <td className={td}>{fm(ov.forecast)}</td>
                <td className={`${td} ${ov.forecast != null && ov.costEff != null && ov.forecast > ov.costEff + 0.5 ? "text-red-700" : ""}`}>{ov.forecast != null && ov.costEff != null ? (ov.forecast > ov.costEff + 0.5 ? `−${fm(ov.forecast - ov.costEff)}` : "0") : "—"}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          <span>Vạch đen trên thanh = % hoàn thành. Thanh vượt xa vạch = đã duyệt đi trước tiến độ.</span>
          <span>Vàng: đã duyệt ≥ 90% giá trị theo DT-CP.</span>
          <span>Đỏ: đã duyệt vượt giá trị theo DT-CP (có / chưa có phụ lục đang trình).</span>
          <span>Thi công giao khoán = Thầu phụ + Tổ đội: chuyển việc qua lại giữa thầu phụ và tổ đội thì xét chung.</span>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-4 py-2 font-semibold text-slate-800">Phụ lục</h3>
        {ov.appendices.length ? (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Phụ lục</th>
                <th className={th}>Doanh thu</th>
                <th className={th}>Chi phí theo DT-CP</th>
                <th className="px-2 py-1.5 text-left font-medium">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {ov.appendices.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">
                    <Link href={`/gia-doi/hop-dong/${a.id}`} className="text-sky-700 hover:underline">{a.appendixNo}</Link>
                  </td>
                  <td className={td}>{fm(a.revenue)}</td>
                  <td className={td}>{fm(a.cost)}</td>
                  <td className="px-2 py-1.5">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] ring-1 ${a.approved ? LIGHT.OK.cls : LIGHT.WARN.cls}`}>{a.approved ? "Đã duyệt · vào giá trị theo DT-CP" : "Đang trình (chưa có thời điểm đã duyệt)"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-3 text-sm text-slate-500">Chưa có phụ lục. Phụ lục nhập ở “Nhập DT-CP Excel” (chọn hợp đồng gốc), có thời điểm đã duyệt thì cộng vào giá trị theo DT-CP.</p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-4 py-2 font-semibold text-slate-800">Nghiệm thu với CĐT</h3>
        <div className="p-3">
          <AcceptanceEditor contractId={ov.id} rows={ov.acceptances} revenue={rev} canEdit={canEdit} />
        </div>
      </section>
    </div>
  );
}
