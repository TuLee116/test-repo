"use client";

import NumInput from "@/app/(app)/NumInput";

// Đơn giá CĐT lấy từ file BOQ (gói thầu đã có giá duyệt): hiện kèm thành tiền tính lại = KL × đơn giá và thành
// tiền ghi trong file để người dùng đối chiếu trước khi nhập. Dùng chung cho Nhập từ Excel / Cập nhật BOQ.

const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");

export type PricedRow = { qty: number; price: number | null; amount: number | null; isHeading: boolean };

// Lệch = thành tiền tính lại khác thành tiền trong file quá phần làm tròn (1đ hoặc 0,1%)
export function amountMismatch(r: PricedRow): boolean {
  if (r.isHeading || r.price == null || r.amount == null) return false;
  const calc = r.qty * r.price;
  return Math.abs(calc - r.amount) > Math.max(1, Math.abs(r.amount) * 0.001);
}

// 3 ô: đơn giá (sửa được) | thành tiền tính lại | thành tiền trong file (⚠ khi lệch)
export function PriceCells({ row, showAmount, onPrice, cellClass = "px-2 py-2" }: { row: PricedRow; showAmount: boolean; onPrice: (v: number | null) => void; cellClass?: string }) {
  if (row.isHeading) {
    return (
      <>
        <td className={cellClass} />
        <td className={cellClass} />
        {showAmount && <td className={`${cellClass} text-right text-slate-500`}>{row.amount != null ? fmt(row.amount) : ""}</td>}
      </>
    );
  }
  const bad = amountMismatch(row);
  return (
    <>
      <td className={`${cellClass} text-right`}>
        <NumInput
          value={row.price}
          allowEmpty
          decimals
          money
          placeholder="Nhập giá"
          onLive={(v) => onPrice(v)}
          onCommit={(v) => onPrice(v)}
          className={`w-28 rounded-md border px-1 py-0.5 text-right text-xs ${row.price == null ? "border-amber-300 bg-amber-50" : "border-slate-300"}`}
        />
      </td>
      <td className={`${cellClass} text-right ${bad ? "font-semibold text-red-700" : "text-slate-800"}`}>{row.price != null ? fmt(row.qty * row.price) : ""}</td>
      {showAmount && (
        <td className={`${cellClass} whitespace-nowrap text-right ${bad ? "bg-red-50 font-semibold text-red-700" : "text-slate-500"}`} title={bad ? "Khối lượng × đơn giá khác thành tiền trong file" : undefined}>
          {row.amount != null ? `${bad ? "⚠ " : ""}${fmt(row.amount)}` : ""}
        </td>
      )}
    </>
  );
}

// Dòng tổng đối chiếu: tổng thành tiền tính lại vs tổng trong file, số dòng lệch / chưa có đơn giá
export function PriceSummary({ rows, showAmount }: { rows: PricedRow[]; showAmount: boolean }) {
  const items = rows.filter((r) => !r.isHeading);
  const calc = items.reduce((s, r) => s + (r.price != null ? r.qty * r.price : 0), 0);
  const file = items.reduce((s, r) => s + (r.amount ?? 0), 0);
  const bad = items.filter(amountMismatch).length;
  const noPrice = items.filter((r) => r.price == null).length;
  const totalBad = showAmount && Math.abs(calc - file) > Math.max(1, Math.abs(file) * 0.001);
  return (
    <div className={`rounded-md px-3 py-2 text-xs ${bad || totalBad ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
      Đơn giá CĐT từ file — tổng thành tiền tính lại (KL × đơn giá): <b>{fmt(calc)}</b>
      {showAmount && (
        <>
          {" "}
          · tổng thành tiền trong file: <b>{fmt(file)}</b> {totalBad ? <>· chênh <b>{fmt(calc - file)}</b></> : "· khớp ✓"}
        </>
      )}
      {bad > 0 && <> · <b>{bad}</b> dòng lệch (tô đỏ ⚠)</>}
      {noPrice > 0 && <> · <b>{noPrice}</b> dòng chưa có đơn giá (ô vàng — nhập tay hoặc để trống)</>}
      <div className="mt-0.5 text-[11px] opacity-80">Đơn giá được lưu vào cột &quot;Báo Giá CĐT&quot; của BOQ. Thành tiền trong file chỉ để đối chiếu, không lưu.</div>
    </div>
  );
}
