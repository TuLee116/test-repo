// Phần dùng chung KHÔNG phụ thuộc server (dùng được cả trong component client) của phân hệ Đệ trình giá đội:
// nhãn, hạng mục, phép tính đơn giá / thành tiền, kiểm tra thiếu dữ liệu.

// Hạng mục hồ sơ → vai trò Trưởng phòng duyệt
export const CATEGORIES = [
  { value: "KC", label: "Trưởng Phòng Đấu Thầu Cấp 1 (Kết Cấu)", role: "TP_KC" },
  { value: "HTPQ", label: "Trưởng Phòng Đấu Thầu Cấp 1 (Hoàn Thiện)", role: "TP_HTPQ" },
  { value: "HTKV", label: "Trưởng Phòng Đấu Thầu Cấp 2 (Hoàn Thiện)", role: "TP_HTKV" },
] as const;
export const categoryLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? "";
export const categoryRole = (c: string) => CATEGORIES.find((x) => x.value === c)?.role;

export const KIND_LABEL: Record<string, string> = {
  IN: "Đơn giá đội trình duyệt (trong HĐ)",
  OUT: "Đề xuất đơn giá ngoài HĐ, phụ lục",
};

export const PRICE_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "QSTT đang kiểm tra", cls: "bg-slate-100 text-slate-700" },
  SUBMITTED: { label: "Chờ Trưởng phòng duyệt", cls: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "TP đã duyệt", cls: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "TP không duyệt", cls: "bg-red-100 text-red-700" },
};

// ---- Phép tính trên 1 dòng ----
export type LineNums = {
  level: string;
  qty: number | null;
  basePrice: number | null;
  siteOpinion: string;
  sitePrice: number | null;
  ptOpinion: string;
  ptPrice: number | null;
  tpPrice: number | null;
  tpOk: boolean;
  // Thành tiền / tổng do người dùng đặt CÔNG THỨC (như Excel): khi `formulas` có khoá cột tương ứng thì dùng số đã tính lưu kèm
  formulas?: string | Record<string, string>;
  cdtAmount?: number | null;
  baseAmount?: number | null;
  siteAmount?: number | null;
  tpAmount?: number | null;
};

// Cột thành tiền được sửa bằng công thức: QSTT sửa 3 cột đầu, Trưởng phòng sửa cột duyệt
export const AMOUNT_COLS = ["cdtAmount", "baseAmount", "siteAmount", "apprAmount"] as const;
export const QS_AMOUNT_COLS = ["cdtAmount", "baseAmount", "siteAmount"];
export const TP_AMOUNT_COLS = ["apprAmount"];

export function hasFormula(l: { formulas?: string | Record<string, string> }, col: string): boolean {
  const f = l.formulas;
  if (!f) return false;
  if (typeof f !== "string") return !!f[col];
  try {
    return !!(JSON.parse(f) as Record<string, string>)[col];
  } catch {
    return false;
  }
}

const isAdjust = (s: string) => /đi[eềể]u ch[iỉ]nh|dieu chinh/i.test(s);

// Đơn giá công trình (BCH) đề xuất:
//  - mẫu trong HĐ: "Điều chỉnh" → đơn giá đề xuất lại; "Đồng ý" (hoặc trống) → giá cơ sở; dòng chỉ có giá đề xuất lại → giá đó
//  - mẫu ngoài HĐ: cột đơn giá của công trình
export function sitePriceOf(kind: string, l: LineNums): number | null {
  if (kind === "OUT") return l.sitePrice;
  if (l.sitePrice != null && (isAdjust(l.siteOpinion) || l.basePrice == null)) return l.sitePrice;
  return l.basePrice ?? l.sitePrice;
}

// Giá đề xuất trình Trưởng phòng = giá công trình (BCH). Mẫu ngoài HĐ: khối "GIÁ ĐỀ XUẤT CỦA P.ĐT-TT" CHÍNH LÀ giá Trưởng phòng
// duyệt (tpPrice) — mặc định bằng giá công trình, TP điều chỉnh sau (anh chốt 05/11/2026).
export function proposedPriceOf(kind: string, l: LineNums): number | null {
  return sitePriceOf(kind, l);
}

// Ý kiến tự động theo giá TP duyệt: Không đồng ý / Điều chỉnh (khác giá đề xuất) / Đồng ý
export function opinionOf(kind: string, l: LineNums): string {
  if (!l.tpOk) return "Không đồng ý";
  const p = proposedPriceOf(kind, l);
  return l.tpPrice != null && (p == null || Math.abs(l.tpPrice - p) > 0.5) ? "Điều chỉnh" : "Đồng ý";
}

// Đơn giá TP duyệt: TP sửa thì lấy giá TP, không thì theo giá đề xuất; dòng TP không đồng ý = 0
export function approvedPriceOf(kind: string, l: LineNums): number | null {
  if (!l.tpOk) return 0;
  return l.tpPrice ?? proposedPriceOf(kind, l);
}

export const amount = (qty: number | null, price: number | null) => (qty != null && price != null ? qty * price : null);

// Thành tiền 1 dòng công việc: ô có công thức thì lấy số đã tính, không thì KL × đơn giá
export const siteAmountOf = (kind: string, l: LineNums): number | null => (hasFormula(l, "siteAmount") ? (l.siteAmount ?? null) : amount(l.qty, sitePriceOf(kind, l)));
export const apprAmountOf = (kind: string, l: LineNums): number | null => (l.tpOk && hasFormula(l, "apprAmount") ? (l.tpAmount ?? null) : amount(l.qty, approvedPriceOf(kind, l)));
export const cdtAmountOf = (l: LineNums & { cdtPrice?: number | null }): number | null => (hasFormula(l, "cdtAmount") ? (l.cdtAmount ?? null) : amount(l.qty, l.cdtPrice ?? null));

// Dòng TỔNG CỘNG đã lưu ({cdt, base, site, appr}); hồ sơ cũ chưa lưu thì trả null → cộng lại từ các dòng
export function savedTotals(json: string | null | undefined): Partial<Record<"cdt" | "base" | "site" | "appr", number>> {
  try {
    const o = JSON.parse(json || "{}") as Record<string, unknown>;
    const out: Partial<Record<"cdt" | "base" | "site" | "appr", number>> = {};
    for (const k of ["cdt", "base", "site", "appr"] as const) if (typeof o[k] === "number") out[k] = o[k] as number;
    return out;
  } catch {
    return {};
  }
}

// DÒNG CHA (đầu mục chia nhỏ): dòng công tác mà dòng công tác ngay sau nó là dòng CON của nó —
// STT con dạng "2.1.1" (bắt đầu bằng STT cha + "."), ký hiệu không phải số ("*", "-", "+", "•", "a)", "a." ...), hoặc để TRỐNG STT.
// Dòng cha chỉ là tiêu đề nhóm: KHÔNG bắt nhập ĐVT / khối lượng / đơn giá (giá nằm ở các dòng con).
const isChildStt = (child: string, parent: string) => {
  const c = child.trim();
  const p = parent.trim().replace(/\.$/, "");
  if (!c) return true; // dòng con chưa đánh STT (Vvd "Công chính", "Công phụ" QSTT tách thêm dưới 1.1)
  if (p && c.startsWith(`${p}.`) && c.length > p.length + 1) return true;
  return !/^\d/.test(c) && !/^[IVXLC]+\.?$/i.test(c) && !/^[A-Z]\.?$/.test(c);
};
export function parentLineIdx(lines: { level: string; stt: string }[]): Set<number> {
  const out = new Set<number>();
  lines.forEach((l, i) => {
    if (l.level !== "ITEM" || !l.stt.trim() || !/^\d/.test(l.stt.trim())) return;
    let j = i + 1;
    while (j < lines.length && lines[j].level === "NOTE") j++;
    const n = lines[j];
    if (n && n.level === "ITEM" && isChildStt(n.stt, l.stt)) out.add(i);
  });
  return out;
}

// Kiểm tra hồ sơ trước khi trình: thiếu gì thì QSTT phải bổ sung (sửa ngay trên app)
export function missingOf(
  sub: { kind: string; projectName: string; itemName: string; batch: string },
  lines: (LineNums & { content: string; unit: string; stt: string })[],
): string[] {
  const out: string[] = [];
  if (!sub.projectName) out.push("Thiếu tên CÔNG TRÌNH");
  if (!sub.itemName) out.push("Thiếu HẠNG MỤC");
  if (!sub.batch) out.push("Thiếu ĐỢT");
  const parents = parentLineIdx(lines);
  lines.forEach((l, i) => {
    if (l.level !== "ITEM" || parents.has(i)) return;
    const name = `Dòng ${l.stt || "?"} "${(l.content || "").slice(0, 40)}"`;
    const miss: string[] = [];
    if (!l.content) miss.push("nội dung");
    if (!l.unit) miss.push("ĐVT");
    if (l.qty == null) miss.push("khối lượng");
    if (!sitePriceOf(sub.kind, l)) miss.push("đơn giá đề xuất");
    if (miss.length) out.push(`${name}: thiếu ${miss.join(", ")}`);
  });
  return out;
}

// Tên file PDF hồ sơ giá đội khi xuất / đính kèm mail: "<Số hợp đồng> Giá Đội <ngày trình>.pdf" (số quản lý GD26-xxxx giữ nguyên trong phần mềm).
// Ngày trình = ngày QSTT trình Trưởng phòng (chưa trình thì lấy ngày duyệt / ngày tạo). Ký tự không được phép trong tên file đổi thành "-".
export function pricePdfName(s: { contractNo: string; code: string; submittedAt: Date | null; reviewedAt?: Date | null; createdAt: Date }): string {
  const d = s.submittedAt ?? s.reviewedAt ?? s.createdAt;
  const date = d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
  const no = (s.contractNo || "").trim() || s.code;
  return `${no} Giá Đội ${date}.pdf`.replace(/[\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
}
