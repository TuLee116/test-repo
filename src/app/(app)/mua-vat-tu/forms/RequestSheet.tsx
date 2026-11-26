import { fmtDate, fmtQty } from "@/lib/proc";
import type { getRequestForm } from "@/lib/proc-forms";
import { FormApprovals, FormLetterhead, FormSheet } from "./FormBits";

type F = NonNullable<Awaited<ReturnType<typeof getRequestForm>>>;

// GIẤY ĐỀ XUẤT VẬT TƯ (Dùng cho công trình) — theo mẫu Excel của BCH, duyệt trên app
export default function RequestSheet({ f }: { f: F }) {
  const { r, items } = f;
  const q = (n: number | null | undefined) => (n ? fmtQty(n) : "");
  const red = "text-red-600";

  return (
    <FormSheet>
      <FormLetterhead />
      <h1 className="mt-2 text-center text-[22px] font-bold">GIẤY ĐỀ XUẤT VẬT TƯ</h1>
      <p className="text-center text-[13px] font-bold italic">(Dùng cho công trình)</p>

      <table className="mt-2 w-full text-[13px] font-bold">
        <tbody>
          <tr>
            <td className="w-36 py-1 pl-8">Công trình :</td>
            <td className="py-1">
              {r.project.name}
            </td>
            <td className="w-[30%] py-1">Khu vực thi công: {r.area}</td>
          </tr>
          <tr>
            <td className="py-1 pl-8">Số hợp đồng :</td>
            <td className="py-1">{r.contractNo}</td>
            <td className={`py-1 ${red}`}>
              Đợt số: &nbsp;{f.batchNo} &nbsp;&nbsp; Ngày: {fmtDate(f.date)}
            </td>
          </tr>
          <tr>
            <td className="py-1 pl-8">Hạng mục :</td>
            <td className="py-1">{r.project.packageName || r.category || r.title}</td>
            <td className={`py-1 ${red}`}>Ngày cần hàng : {fmtDate(r.neededDate) || "……/……/……"}</td>
          </tr>
        </tbody>
      </table>

      <table className="tmn-grid mt-1 text-[13px]">
        <thead className="font-bold">
          <tr className="text-center">
            <th className="w-10">STT</th>
            <th>Tên vật tư</th>
            <th>Quy cách</th>
            <th className="w-14">ĐVT</th>
            <th className="w-24">Tổng khối lượng theo bảng DT-CP (TĐ1)</th>
            <th className="w-24">Tổng khối lượng hợp đồng</th>
            <th className="w-28">Tổng khối lượng dự kiến quyết toán (không bao gồm hao hụt)</th>
            <th className="w-24">Tổng khối lượng dự trù khi hoàn thành dự án</th>
            <th className="w-28">Khối lượng lũy kế đơn hàng mua đến đợt trước{f.prevDate && ` (ngày ${fmtDate(f.prevDate)})`}</th>
            <th className={`w-28 ${red}`}>Khối lượng đặt hàng đợt này (ngày {fmtDate(f.date)})</th>
            <th className="w-24">Khối lượng lũy kế đơn hàng mua đến đợt này</th>
            <th className="w-40">Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const over = it.dtcpQty != null && it.cumQty > it.dtcpQty + 1e-9;
            return (
              <tr key={it.id}>
                <td className="text-center">{i + 1}</td>
                <td className="text-center">{it.name}</td>
                <td className="whitespace-pre-line text-center">{it.spec}</td>
                <td className="text-center">{it.unit}</td>
                <td className="num">{it.dtcpQty == null ? <span className="text-amber-700">Ngoài DT-CP</span> : q(it.dtcpQty)}</td>
                <td className="num">{q(it.contractQty)}</td>
                <td className="num">{q(it.finalQty)}</td>
                <td className="num">{q(it.forecastQty)}</td>
                <td className="num">{q(it.prevQty)}</td>
                <td className={`num font-bold ${red}`}>{q(it.qty)}</td>
                <td className={`num ${over ? "font-bold text-red-600" : "text-blue-700"}`} title={over ? "Lũy kế vượt KL DT-CP" : undefined}>
                  {q(it.cumQty)}
                  {over && " ⚠"}
                </td>
                <td>{it.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <FormApprovals
        cols={[
          {
            title: "Cán bộ đề xuất",
            state: r.submittedAt ? "done" : "wait",
            label: "Đã trình",
            name: r.createdByName,
            at: r.submittedAt,
          },
          {
            title: "QLDA/CHT",
            state: r.approvedAt ? "done" : r.status === "SUBMITTED" ? "wait" : "none",
            name: r.approvedByName,
            at: r.approvedAt,
          },
        ]}
      />
    </FormSheet>
  );
}
