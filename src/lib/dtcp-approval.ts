// Trạng thái duyệt DT-CP (dùng được cả ở client)
// QSĐT lập → trình QSTT → QSTT kiểm tra, CHỌN 1 trong 3 Trưởng phòng → Trưởng phòng duyệt (DT-CP CÓ HIỆU LỰC, đưa qua trình giá đội / thầu phụ)
// → QSTT gửi công trình (khoá). (Bước Phó Tổng cũ chỉ còn cho DT-CP đã trình trước đây ở trạng thái PTG.)
export const DTCP_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Đang lập", cls: "bg-slate-100 text-slate-700" },
  QSTT: { label: "Chờ QSTT kiểm tra", cls: "bg-amber-100 text-amber-800" },
  TP: { label: "Chờ Trưởng phòng duyệt", cls: "bg-sky-100 text-sky-800" },
  PTG: { label: "Chờ Phó Tổng duyệt", cls: "bg-violet-100 text-violet-800" },
  TPOK: { label: "TP đã duyệt — có hiệu lực, chờ QSTT gửi công trình", cls: "bg-lime-100 text-lime-800" },
  APPROVED: { label: "Đã duyệt & gửi công trình", cls: "bg-emerald-100 text-emerald-800" },
};
// DT-CP có hiệu lực (dùng được cho trình giá đội, thầu phụ): Trưởng phòng đã duyệt (kể cả đã gửi công trình)
export const dtcpEffective = (status: string) => status === "TPOK" || status === "APPROVED";

export const DTCP_TPS = [
  { key: "KC", perm: "TP_KC", label: "TP Kết cấu" },
  { key: "HTPQ", perm: "TP_HTPQ", label: "TP Hoàn thiện Phú Quốc" },
  { key: "HTKV", perm: "TP_HTKV", label: "TP Hoàn thiện KV khác" },
] as const;

export type TpMarks = Partial<Record<(typeof DTCP_TPS)[number]["key"], { by: string; at: string }>>;

export function parseTp(s: string | null | undefined): TpMarks {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

// việc của 1 người với DT-CP ở trạng thái này (theo quyền được tick, không tính quyền quản trị)
// QSĐT chọn QSTT khi trình (dtcpQsttId): chỉ QSTT đó thấy việc; DT-CP trình từ trước khi có lựa chọn (dtcpQsttId trống) thì QSTT nào cũng thấy
export function dtcpTodoOf(p: { dtcpStatus: string; dtcpTp: string; dtcpQsttId?: string; dtcpTpKey?: string }, perms: Set<string>, userId?: string): string | null {
  const mineQstt = perms.has("QSTT") && (!p.dtcpQsttId || p.dtcpQsttId === userId);
  if (p.dtcpStatus === "QSTT" && mineQstt) return "kiểm tra, chọn Trưởng phòng duyệt";
  if (p.dtcpStatus === "TPOK" && mineQstt) return "Trưởng phòng đã duyệt, gửi công trình";
  if (p.dtcpStatus === "TP") {
    const tp = parseTp(p.dtcpTp);
    if (p.dtcpTpKey) {
      const t = DTCP_TPS.find((x) => x.key === p.dtcpTpKey);
      if (t && perms.has(t.perm)) return "Trưởng phòng duyệt DT-CP";
    } else if (DTCP_TPS.some((t) => !tp[t.key] && perms.has(t.perm))) return "Trưởng phòng xem, đồng ý trình Phó Tổng";
  }
  if (p.dtcpStatus === "PTG" && perms.has("PTG")) return "chờ Phó Tổng duyệt";
  return null;
}
