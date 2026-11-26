import { fmtDate, fmtMoney, fmtQty } from "@/lib/proc";
import type { getOrderForm, OrderFormRow } from "@/lib/proc-forms";
import { FormApprovals, FormLetterhead, FormSheet } from "./FormBits";

type F = NonNullable<Awaited<ReturnType<typeof getOrderForm>>>;

// BẢNG TỔNG HỢP VẬT TƯ - TRÌNH KÍ ĐƠN HÀNG — sau khi kế toán VT chọn NCC, trình PTGĐ thường trực duyệt trên app.
// Đơn giá trình ký và mọi thành tiền đều GỒM VAT (đơn giá NCC chưa VAT × (1 + VAT%)).
export default function OrderSheet({ f }: { f: F }) {
  const { o, groups } = f;
  const q = (n: number | null | undefined) => (n ? fmtQty(n) : "");
  const m = (n: number | null | undefined) => (n ? fmtMoney(n) : "");
  const tt = (qty: number | null | undefined, price: number | null) => (qty && price ? qty * price : 0);
  const amounts = (r: OrderFormRow) => ({
    dtcp: r.dtcpAmount ?? 0,
    dtcpQ: tt(r.dtcpQty, r.price),
    finalQ: tt(r.finalQty, r.price),
    prev: r.prevAmount,
    now: tt(r.qty, r.price),
    cum: r.prevAmount + tt(r.qty, r.price),
  });
  const sum = (rows: OrderFormRow[]) =>
    rows.reduce(
      (s, r) => {
        const a = amounts(r);
        return { dtcp: s.dtcp + a.dtcp, dtcpQ: s.dtcpQ + a.dtcpQ, finalQ: s.finalQ + a.finalQ, prev: s.prev + a.prev, now: s.now + a.now, cum: s.cum + a.cum };
      },
      { dtcp: 0, dtcpQ: 0, finalQ: 0, prev: 0, now: 0, cum: 0 },
    );
  const all = sum(groups.flatMap((g) => g.rows));
  const yellow = "bg-yellow-300";
  const red = "text-red-600";
  const roman = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "K"];
  const submitted = !!o.submittedAt && o.status !== "QUOTING" && o.status !== "DRAFT";

  return (
    <FormSheet>
      <FormLetterhead />
      <h1 className="mt-2 text-center text-[20px] font-bold">BẢNG TỔNG HỢP VẬT TƯ - TRÌNH KÍ ĐƠN HÀNG</h1>
      <div className="mt-1 flex flex-wrap items-start gap-x-8 text-[13px] font-bold">
        <div className="flex-1 pl-[20%]">
          <p>
            Công trình: {o.project.name}
          </p>
          <p>Hạng mục : {groups.map((g) => g.name).join("; ")}</p>
        </div>
        <p>
          Đợt đặt hàng : Ngày {fmtDate(f.date)} <span className="font-normal">({o.code})</span>
        </p>
      </div>

      <table className="tmn-grid mt-1 text-[11px]">
        <thead className={`font-bold ${yellow}`}>
          <tr className="text-center">
            <th rowSpan={2} className="w-7">STT</th>
            <th rowSpan={2} className="w-14">Kí hiệu DTCP</th>
            <th rowSpan={2} className="w-16">NCC</th>
            <th rowSpan={2}>Tên vật tư</th>
            <th rowSpan={2} className="w-10">ĐVT</th>
            <th rowSpan={2} className="w-20">Tổng giá trị vật tư theo bảng dự trù DT-CP</th>
            <th rowSpan={2} className="w-16">Đơn giá theo DTCP</th>
            <th rowSpan={2} className="w-16">Đơn giá trình ký</th>
            <th colSpan={2}>Tổng khối lượng theo DTCP</th>
            <th colSpan={2}>Tổng KL dự kiến quyết toán (không bao gồm hao hụt)</th>
            <th colSpan={2}>Lũy kế đơn hàng trước</th>
            <th colSpan={2} className={red}>Khối lượng đặt hàng ngày {fmtDate(f.date)}</th>
            <th colSpan={2}>Lũy kế đơn hàng mua đến đợt này</th>
            <th rowSpan={2} className="w-16">Hình thức thanh toán</th>
            <th rowSpan={2} className="w-28">Ghi chú: Lí do vượt KL; chênh lệch đơn giá,..</th>
          </tr>
          <tr className="text-center">
            {[false, false, false, true, false].map((c, i) => (
              <Pair key={i} red={c} />
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g, gi) => {
            const s = sum(g.rows);
            return (
              <Frag key={g.name}>
                <tr className={`font-bold ${yellow}`}>
                  <td className="text-center">{roman[gi] ?? gi + 1}</td>
                  <td />
                  <td />
                  <td className="uppercase">{g.name}</td>
                  <td />
                  <td className="num">{m(s.dtcp)}</td>
                  <td />
                  <td />
                  <td />
                  <td className="num">{m(s.dtcpQ)}</td>
                  <td />
                  <td className={`num ${red}`}>{m(s.finalQ)}</td>
                  <td />
                  <td className={`num ${red}`}>{m(s.prev)}</td>
                  <td />
                  <td className={`num ${red}`}>{m(s.now)}</td>
                  <td />
                  <td className={`num ${red}`}>{m(s.cum)}</td>
                  <td />
                  <td />
                </tr>
                {g.rows.map((r, i) => {
                  const a = amounts(r);
                  return (
                    <tr key={r.id}>
                      <td className="text-center">{i + 1}</td>
                      <td className="text-center">{r.code}</td>
                      <td className="text-center">{r.supplier || <span className="text-amber-700">chưa chọn</span>}</td>
                      <td>
                        {r.name}
                        {r.spec && <span className="block text-[10px] italic">{r.spec}</span>}
                      </td>
                      <td className="text-center">{r.unit}</td>
                      <td className="num">{m(a.dtcp)}</td>
                      <td className="num">{m(r.dtcpPrice)}</td>
                      <td className="num">{m(r.price)}</td>
                      <td className="num">{q(r.dtcpQty)}</td>
                      <td className="num">{m(a.dtcpQ)}</td>
                      <td className="num">{q(r.finalQty)}</td>
                      <td className="num">{m(a.finalQ)}</td>
                      <td className="num">{q(r.prevQty)}</td>
                      <td className="num">{m(a.prev)}</td>
                      <td className={`num ${red}`}>{q(r.qty)}</td>
                      <td className={`num ${red}`}>{m(a.now)}</td>
                      <td className="num">{q(r.prevQty + r.qty)}</td>
                      <td className="num">{m(a.cum)}</td>
                      <td className="text-center">{r.payTerms}</td>
                      <td className={r.notes.some((n) => n.startsWith("Vượt") || n.startsWith("Đơn giá cao")) ? "font-bold text-red-600" : ""}>{r.notes.join("; ")}</td>
                    </tr>
                  );
                })}
              </Frag>
            );
          })}
          <tr className="bg-slate-200 font-bold">
            <td colSpan={5} className="py-2 text-center">
              Tổng giá trị ( bao gồm vat )
            </td>
            <td className="num">{m(all.dtcp)}</td>
            <td />
            <td />
            <td />
            <td className="num">{m(all.dtcpQ)}</td>
            <td />
            <td className="num">{m(all.finalQ)}</td>
            <td />
            <td className="num">{m(all.prev)}</td>
            <td />
            <td className="num">{m(all.now)}</td>
            <td />
            <td className="num">{m(all.cum)}</td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[11px]">Tổng giá trị bao gồm VAT, vận chuyển đến chân công trình.</p>
      {o.note && <p className="text-[11px]">Ghi chú: {o.note}</p>}

      <FormApprovals
        cols={[
          { title: "Cán bộ đặt hàng", state: "done", label: "Đã lập", name: o.createdByName, at: o.createdAt },
          {
            title: "Bộ phận vật tư (KT vật tư)",
            state: submitted ? "done" : o.status === "QUOTING" ? "wait" : "none",
            label: "Đã trình",
            name: o.submittedByName,
            at: o.submittedAt,
          },
          {
            title: "PTGĐ thường trực",
            state: o.approvedAt ? "done" : o.status === "PENDING" ? "wait" : "none",
            name: o.approvedByName,
            at: o.approvedAt,
          },
        ]}
      />
    </FormSheet>
  );
}

function Pair({ red }: { red: boolean }) {
  return (
    <>
      <th className={`w-12 ${red ? "text-red-600" : ""}`}>KL</th>
      <th className={`w-20 ${red ? "text-red-600" : ""}`}>Thành tiền</th>
    </>
  );
}

function Frag({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
