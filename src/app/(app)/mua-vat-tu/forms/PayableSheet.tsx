import { fmtDate, fmtMoney, fmtQty } from "@/lib/proc";
import type { getPayableForm } from "@/lib/proc-forms";
import { FormApprovals, FormLetterhead, FormSheet } from "./FormBits";

type F = NonNullable<Awaited<ReturnType<typeof getPayableForm>>>;

// BẢNG KÊ CHI TIẾT CÔNG NỢ — các đợt công nợ của cùng NCC + dự án tính đến đợt này; đơn giá gồm VAT.
export default function PayableSheet({ f }: { f: F }) {
  const { p, groups } = f;
  const m = (n: number | null | undefined) => (n ? (n < 0 ? `(${fmtMoney(-n)})` : fmtMoney(n)) : "");
  const blue = "bg-[#8db4e2]";
  const yellow = "bg-yellow-300";
  const red = "text-red-600";
  const period = (a: Date, b: Date) => `Đợt ngày ${fmtDate(a)} đến ngày ${fmtDate(b)}`;
  const info: [string, React.ReactNode][] = [
    ["CÔNG TRÌNH", p.project.name],
    ["MÃ SỐ DỰ ÁN", p.project.packageName || p.project.name],
    ["HẠNG MỤC", p.title],
    ["NHÀ CUNG CẤP", p.supplier.name],
    ["ĐỢT THANH TOÁN", period(f.here.from, f.here.to)],
  ];
  const lastPay = p.payments[p.payments.length - 1];

  return (
    <FormSheet>
      <FormLetterhead />
      <h1 className="mt-2 text-center text-[26px] font-bold">BẢNG KÊ CHI TIẾT CÔNG NỢ</h1>
      <table className="mt-1 w-full text-[14px] font-bold">
        <tbody>
          {info.map(([k, v]) => (
            <tr key={k}>
              <td className="w-[1%] whitespace-nowrap py-0.5 pl-40 pr-2 align-top">{k}</td>
              <td className="border-b border-dotted border-slate-400 py-0.5">: {v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="tmn-grid mt-4 text-[13px]">
        <thead className={`font-bold ${blue}`}>
          <tr className="text-center">
            <th className="w-20">NGÀY THÁNG</th>
            <th>TÊN VẬT TƯ</th>
            <th className="w-12">ĐVT</th>
            <th className="w-20">SỐ LƯỢNG</th>
            <th className="w-20">ĐƠN GIÁ TRÌNH KÍ</th>
            <th className="w-24">THÀNH TIỀN TRÌNH KÍ</th>
            <th className="w-20">ĐƠN GIÁ CÔNG NỢ</th>
            <th className="w-28">THÀNH TIỀN CÔNG NỢ</th>
            <th className="w-28">GHI CHÚ</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            let lastDay = "";
            return (
              <Frag key={g.id}>
                <tr className={`font-bold ${blue}`}>
                  <td className="text-center">{g.code}</td>
                  <td colSpan={6}>: {period(g.from, g.to)}</td>
                  <td className="num">{m(g.total)}</td>
                  <td className="num">{g.isCurrent ? "" : g.paid ? `Đã TT ${fmtMoney(g.paid)}` : "Chưa TT"}</td>
                </tr>
                {g.lines.map((l) => {
                  const day = fmtDate(l.date);
                  const showDay = day !== lastDay;
                  lastDay = day;
                  const diff = l.signPrice !== null && Math.abs(l.price - l.signPrice) > 0.5;
                  return (
                    <tr key={l.id}>
                      <td className={`text-center ${red}`}>{showDay ? day : ""}</td>
                      <td className={red}>{l.name}</td>
                      <td className={`text-center ${red}`}>{l.unit}</td>
                      <td className="num">{fmtQty(l.qty)}</td>
                      <td className={`num ${red}`}>{m(l.signPrice)}</td>
                      <td className="num">{m(l.signAmount)}</td>
                      <td className={`num ${red} ${diff ? "font-bold" : ""}`} title={diff ? "Khác đơn giá trình kí" : undefined}>
                        {m(l.price)}
                      </td>
                      <td className="num">{m(l.amount)}</td>
                      <td>{l.note}</td>
                    </tr>
                  );
                })}
                {Math.abs(g.adjust) > 0.004 && (
                  <tr>
                    <td />
                    <td className={red}>Cân đối đủ hóa đơn</td>
                    <td />
                    <td className="num">1,00</td>
                    <td />
                    <td />
                    <td className={`num ${red}`}>{m(g.adjust)}</td>
                    <td className="num">{m(g.adjust)}</td>
                    <td />
                  </tr>
                )}
              </Frag>
            );
          })}
          {(
            [
              ["TỔNG GIÁ TRỊ MUA HÀNG (A)", f.A, fmtQty(f.qtyTotal)],
              ["TỔNG GIÁ TRỊ ĐÃ TẠM ỨNG / THANH TOÁN (B)", f.B, ""],
              ["Trừ tạm ứng ( C )", f.C, ""],
              ["TỔNG THANH TOÁN ĐỢT NÀY ( D )= A-B-C", f.D, ""],
            ] as const
          ).map(([label, v, qty]) => (
            <tr key={label} className={`font-bold ${yellow}`}>
              <td colSpan={3} className="py-1.5 text-center">
                {label}
              </td>
              <td className="num">{qty}</td>
              <td />
              <td />
              <td />
              <td className="num">{m(v)}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      {p.note && <p className="mt-1 text-[12px]">Ghi chú: {p.note}</p>}

      <FormApprovals
        cols={[
          { title: "Bộ phận vật tư", state: p.sentAt ? "done" : "wait", label: "Đã gửi kế toán", name: p.createdByName, at: p.sentAt },
          {
            title: "Phòng TCKT",
            state: p.status === "PAID" ? "done" : p.status === "SENT" || p.status === "PARTIAL" ? "wait" : "none",
            label: "Đã thanh toán",
            name: lastPay?.createdByName,
            at: lastPay?.paidDate,
          },
        ]}
      />
    </FormSheet>
  );
}

function Frag({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
