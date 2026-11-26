import { colLetter } from "@/lib/grid-formula";

// Vị trí các dòng của sheet DT-CP trên giao diện VÀ trong file Excel xuất ra (dùng chung để số dòng khớp nhau, công thức gõ
// trên phần mềm chép sang Excel là chạy đúng). Cột: A STT · B Nội dung · C Đơn vị · D Thành tiền · E % so với DT · F.. cột bổ sung · cuối Ghi chú.
export const DTCP_HEAD_ROW = 13; // dòng tiêu đề cột (STT, Nội dung...) trong file Excel
export const DTCP_AMOUNT_COL = 3; // chỉ số cột D (0-based)
export const dtcpExtraColIndex = (i: number) => 5 + i; // cột bổ sung thứ i (0-based) → chỉ số cột (F = 5)
export const dtcpExtraColLetter = (i: number) => colLetter(dtcpExtraColIndex(i));

export type DtcpLayout = {
  secRow: Record<"A" | "B", number>;
  vatRow: number;
  beforeVatRow: number;
  rowOf: Map<string, number>; // id dòng → số dòng Excel (1-based)
};

export function dtcpLayout(rows: { id: string; section: "A" | "B" }[]): DtcpLayout {
  let r = DTCP_HEAD_ROW + 1;
  const rowOf = new Map<string, number>();
  const secRow = { A: 0, B: 0 };
  secRow.A = r++;
  for (const x of rows) if (x.section === "A") rowOf.set(x.id, r++);
  const vatRow = r++;
  const beforeVatRow = r++;
  secRow.B = r++;
  for (const x of rows) if (x.section === "B") rowOf.set(x.id, r++);
  return { secRow, vatRow, beforeVatRow, rowOf };
}
