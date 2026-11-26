// Trình giá thầu phụ — phần dùng chung client / server: giá đề xuất, thành tiền từng cột, tổng (Prelim, VAT), xếp NHÁNH A / B.

export const SUB_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "QSĐT đang lập", cls: "bg-slate-100 text-slate-700" },
  QS_CHECK: { label: "Chờ QSTT kiểm tra", cls: "bg-sky-100 text-sky-800" },
  SUBMITTED: { label: "Chờ Trưởng phòng duyệt", cls: "bg-amber-100 text-amber-800" },
  NEED_INFO: { label: "TP yêu cầu QSĐT bổ sung", cls: "bg-fuchsia-100 text-fuchsia-800" },
  PTG_PENDING: { label: "Chờ Phó Tổng phê duyệt", cls: "bg-orange-100 text-orange-800" },
  APPROVED: { label: "Đã duyệt", cls: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Không duyệt — trả về", cls: "bg-red-100 text-red-700" },
};
export const BRANCH_LABEL: Record<string, string> = {
  A: "Nhánh A · Trưởng phòng duyệt, Phó Tổng xem để nắm",
  B: "Nhánh B · Phó Tổng phê duyệt",
};
export const BRANCH_LIMIT = 1_000_000_000; // giá trị ≤ 1 tỷ → nhánh A

// vt / nc / tb = đơn giá chi tiết vật tư / nhân công / thiết bị (chế độ "giá chi tiết"); price luôn là đơn giá TỔNG dùng để tính
export type Bid = { qty: number | null; price: number | null; vt?: number | null; nc?: number | null; tb?: number | null };
export const PRICE_MODES = [
  { value: "TONG", label: "Giá tổng — 1 đơn giá" },
  { value: "CHITIET", label: "Giá chi tiết — vật tư, nhân công, thiết bị" },
] as const;
// tổng 3 thành phần (null nếu chưa nhập thành phần nào → dùng đơn giá tổng đã gõ)
export const compSum = (vt: number | null | undefined, nc: number | null | undefined, tb: number | null | undefined): number | null =>
  vt == null && nc == null && tb == null ? null : (vt ?? 0) + (nc ?? 0) + (tb ?? 0);
export type Bidder = { key: string; name: string };
// Điều khoản hợp đồng: CĐT / CƠ SỞ / nội dung từng thầu phụ báo (bids: C1, C2...) / ĐỀ XUẤT (trống = theo thầu phụ được chọn) / DUYỆT (TP / PTG; trống = theo đề xuất)
export type Term = { label: string; cdt: string; base: string; prop: string; appr: string; bids?: Record<string, string> };
export const DEFAULT_TERMS: Term[] = ["Tiến độ", "Tạm ứng", "Thanh toán", "Quyết toán"].map((label) => ({ label, cdt: "", base: "", prop: "", appr: "" }));
// ĐỀ XUẤT do QSĐT chọn / tự nhập (anh chốt 11/11/2026: không tự lấy theo thầu phụ vì phần mềm hay nhận diện sai)
export const termProp = (t: Term) => t.prop || "";
// các nội dung đọc được trong file cho 1 điều khoản (để QSĐT chọn nhanh)
export const termChoices = (t: Term) => [...new Set([t.prop, t.cdt, t.base, ...Object.values(t.bids ?? {})].map((x) => (x ?? "").trim()).filter(Boolean))];
// nội dung hay dùng (luôn có trong ô chọn, kể cả khi file không có điều khoản) — sửa danh sách tại đây
const nmKey = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
export const TERM_PRESETS: Record<string, string[]> = {
  "tien do": ["Theo tiến độ thi công của Bên A", "Theo tiến độ hợp đồng chính với CĐT", "Theo yêu cầu của Ban chỉ huy công trường"],
  "tam ung": ["Không tạm ứng", "Tạm ứng 10% giá trị hợp đồng", "Tạm ứng 15% giá trị hợp đồng", "Tạm ứng 20% giá trị hợp đồng", "Tạm ứng 30% giá trị hợp đồng"],
  "thanh toan": ["Thanh toán 80% giá trị khối lượng nghiệm thu hàng tháng", "Thanh toán 85% giá trị khối lượng nghiệm thu hàng tháng", "Thanh toán 90% giá trị khối lượng nghiệm thu hàng tháng", "Thanh toán 100% sau khi nghiệm thu hoàn thành"],
  "quyet toan": ["Quyết toán 95%, giữ lại 5% bảo hành 12 tháng", "Quyết toán 97%, giữ lại 3% bảo hành 12 tháng", "Quyết toán 100% (không giữ bảo hành)"],
};
export const termPresets = (t: Term) => TERM_PRESETS[Object.keys(TERM_PRESETS).find((k) => nmKey(t.label).includes(k)) ?? ""] ?? [];
// 4 điều khoản cố định; ghép dữ liệu đọc từ file theo tên (Tiến độ / Tạm ứng / Thanh toán / Quyết toán)
const nm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
export function fixedTerms(ts: Term[]): Term[] {
  return DEFAULT_TERMS.map((d) => ts.find((t) => nm(t.label).includes(nm(d.label))) ?? d).map((t, i) => ({ ...t, label: DEFAULT_TERMS[i].label }));
}

// HỢP ĐỒNG chưa có (không gắn DT-CP): ghi vào cdtContract
export const CONTRACT_STATES = ["Đang trình HĐ", "Đang báo giá"] as const;
export const isContractState = (s: string) => (CONTRACT_STATES as readonly string[]).includes(s.trim());
// kiểm tra thông tin đầu hồ sơ trước khi chuyển QSTT / trình (anh chốt 11/11/2026)
// Hình thức giao thầu: giao bao vật tư | giao bao thiết bị | nhân công thuần. Giao bao thiết bị → bổ sung tổng giá trị VẬT TƯ; nhân công thuần → bổ sung VẬT TƯ + THIẾT BỊ.
export const AWARD_FORMS = [
  { value: "VT", label: "Giao bao vật tư", need: [] as ("vt" | "tb")[] },
  { value: "TB", label: "Giao bao thiết bị", need: ["vt"] as ("vt" | "tb")[] },
  { value: "NC", label: "Nhân công thuần", need: ["vt", "tb"] as ("vt" | "tb")[] },
] as const;
export const awardNeed = (form: string) => AWARD_FORMS.find((f) => f.value === form)?.need ?? [];
export const PL_KINDS = [
  { value: "CONG_GOP", label: "PLHĐ cộng gộp — 1 cột khối lượng, đơn giá, thành tiền" },
  { value: "DIEU_CHINH", label: "PLHĐ điều chỉnh — theo hợp đồng gốc (KL hợp đồng, KL điều chỉnh, đơn giá HĐ, đơn giá điều chỉnh)" },
] as const;
// ô GIÁ TRỊ HĐ + PL ĐÃ KÝ: chỉ cần khi phụ lục CỘNG GỘP mà HĐ thầu phụ gốc gõ tay (chọn HĐTP trên hệ thống thì tự cộng HĐ gốc + các PL đã duyệt;
// PL điều chỉnh lấy theo cột Hợp đồng của bảng)
export const signedNeeded = (p: { proposalType?: string; plKind?: string; hdtpId?: string | null }) => p.proposalType === "PL" && p.plKind === "CONG_GOP" && !p.hdtpId;
export function headMissing(p: { area: string; projectName: string; siteId?: string | null; contractId: string | null; cdtContract: string; revision: number; branch: string; proposalType?: string; plKind?: string; awardForm?: string; vtValue?: number | null; tbValue?: number | null; hdtpId?: string | null; hdtpNo?: string; signedValue?: number | null }): string[] {
  const m: string[] = [];
  if (!p.area.trim()) m.push("Chưa chọn KHU VỰC");
  if (!p.projectName.trim() || (p.siteId !== undefined && !p.siteId)) m.push("Chưa chọn DỰ ÁN trong Danh mục dự án (gõ mã / tên để chọn; chưa có thì bấm “Đề nghị dự án mới”)");
  if (!p.cdtContract.trim()) m.push(p.contractId ? "Hợp đồng chưa có SỐ HỢP ĐỒNG — nhập số HĐ" : "Chưa chọn HỢP ĐỒNG (hoặc Đang trình HĐ / Đang báo giá)");
  if (!(p.revision >= 1)) m.push("Chưa chọn LẦN TRÌNH");
  if (p.branch !== "A" && p.branch !== "B") m.push("Chưa chọn NHÁNH (A / B)");
  if (p.proposalType !== undefined) {
    if (p.proposalType !== "HDTP" && p.proposalType !== "PL") m.push("Chưa chọn LOẠI ĐỀ XUẤT (HĐTP / Ký PL)");
    // phụ lục: phải chọn HỢP ĐỒNG THẦU PHỤ (hồ sơ HĐTP đã có số HĐ) rồi mới được trình tiếp phụ lục
    // phụ lục: chọn HĐTP đã có trên hệ thống HOẶC tự gõ số HĐ thầu phụ gốc (hệ thống đang cập nhật dần)
    if (p.proposalType === "PL" && !p.hdtpId && !(p.hdtpNo ?? "").trim()) m.push("Phụ lục: chưa chọn HỢP ĐỒNG THẦU PHỤ gốc (hoặc nhập số HĐ thầu phụ)");
    if (p.proposalType === "PL" && p.plKind !== "CONG_GOP" && p.plKind !== "DIEU_CHINH") m.push("Phụ lục: chưa chọn LOẠI PHỤ LỤC (cộng gộp / điều chỉnh)");
    // PL cộng gộp với HĐ thầu phụ gõ tay: hệ thống không có số HĐ + PL đã ký → bắt nhập (để tổng hợp có PLĐC = đã ký + phụ lục này)
    if (signedNeeded(p) && (p.signedValue == null || !Number.isFinite(Number(p.signedValue)))) m.push("Phụ lục cộng gộp: chưa nhập GIÁ TRỊ HĐ + PL ĐÃ KÝ (trước phụ lục này)");
  }
  if (p.awardForm !== undefined) {
    if (!AWARD_FORMS.some((f) => f.value === p.awardForm)) m.push("Chưa chọn HÌNH THỨC GIAO THẦU");
    const need = awardNeed(p.awardForm);
    if (need.includes("vt") && (p.vtValue == null || !Number.isFinite(Number(p.vtValue)))) m.push("Chưa nhập TỔNG GIÁ TRỊ VẬT TƯ (bắt buộc với hình thức giao thầu này)");
    if (need.includes("tb") && (p.tbValue == null || !Number.isFinite(Number(p.tbValue)))) m.push("Chưa nhập TỔNG GIÁ TRỊ THIẾT BỊ (bắt buộc với nhân công thuần)");
  }
  return m;
}
export const termAppr = (t: Term, _sel?: string) => t.appr || termProp(t); // eslint-disable-line @typescript-eslint/no-unused-vars
export type SubLineNums = {
  level: string;
  cdtQty: number | null;
  cdtPrice: number | null;
  baseQty: number | null;
  basePrice: number | null;
  bids: Record<string, Bid>;
  propQty: number | null;
  propPrice: number | null;
  tpPrice: number | null;
  tpOk: boolean;
};

export const parseJson = <T,>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

// Khối lượng / đơn giá ĐỀ XUẤT DUYỆT (cột D): file / QSTT ghi; trống thì lấy theo thầu phụ được chọn
export const propQtyOf = (l: SubLineNums, sel: string) => l.propQty ?? l.bids[sel]?.qty ?? l.baseQty ?? l.cdtQty;
export const propPriceOf = (l: SubLineNums, sel: string) => l.propPrice ?? l.bids[sel]?.price ?? null;
// Đơn giá DUYỆT: dòng không đồng ý = 0; TP / PTG sửa thì lấy giá sửa; không thì theo đề xuất
export const apprPriceOf = (l: SubLineNums, sel: string) => (!l.tpOk ? 0 : (l.tpPrice ?? propPriceOf(l, sel)));
export const amt = (q: number | null | undefined, p: number | null | undefined) => (q != null && p != null ? q * p : null);

// ĐƠN GIÁ CƠ SỞ (B) của 1 dòng: người dùng tự sửa (baseManual) thì dùng giá đã nhập; không thì = đơn giá TĐ1 dòng DT-CP đã khớp (chưa khớp: giá cơ sở trong file); "-" = ngoài DT-CP
export const baseOfLine = (l: { lineKey: string; basePrice: number | null; baseManual?: boolean }, refBase1: number | null | undefined): number | null =>
  l.baseManual ? l.basePrice : l.lineKey === "-" ? null : (refBase1 ?? l.basePrice);

// Dòng chi phí thêm dưới TỔNG CỘNG (người dùng thêm 1, 2, 3... dòng tuỳ ý): thành tiền theo từng cột A, B, C1.., D
// rates: ô ĐƠN GIÁ người dùng gõ theo cột — số tiền hoặc % ("25%" = 25% của TỔNG CỘNG cột); có rates thì thành tiền = kết quả (vals chỉ là bản chốt lúc lưu)
export type ExtraRow = { id: string; stt: string; label: string; vals: Record<string, number | null>; rates?: Record<string, string> };
export const parseExtras = (s: string | null | undefined): ExtraRow[] => {
  const v = parseJson<unknown>(s || "[]", []);
  return Array.isArray(v) ? (v as ExtraRow[]).filter((x) => x && typeof x.id === "string").map((x) => ({ id: x.id, stt: String(x.stt ?? ""), label: String(x.label ?? ""), vals: x.vals && typeof x.vals === "object" ? x.vals : {}, rates: x.rates && typeof x.rates === "object" ? Object.fromEntries(Object.entries(x.rates).map(([k, t]) => [k, String(t ?? "")])) : undefined })) : [];
};
// tổng các dòng thêm của 1 cột (cột "R" = duyệt dùng chung số của cột "D")
// thành tiền 1 dòng thêm ở cột col: có ô đơn giá (rates) thì tính theo đó (số hoặc %/công thức × TỔNG CỘNG cột), không thì số đã nhập ở thành tiền
// PLHĐ điều chỉnh: mỗi khối A / B / D có thêm cột theo HỢP ĐỒNG gốc (AH / BH / H). Ô đơn giá nhập % hoặc công thức (=TT*...) ở cột A / B / D thì cột hợp đồng cũng tính theo % / công thức đó trên TỔNG CỘNG của chính cột hợp đồng
const HD_BASE: Record<string, string> = { AH: "A", BH: "B", H: "D" };
export const extraAmt = (r: ExtraRow, col: string, sum?: number): number => {
  const k = col === "R" ? "D" : col;
  let raw = r.rates?.[k];
  if ((raw == null || raw.trim() === "") && HD_BASE[k]) {
    const b = (r.rates?.[HD_BASE[k]] ?? "").trim();
    if (b.endsWith("%") || b.startsWith("=")) raw = b;
  }
  if (sum !== undefined && raw != null && raw.trim() !== "") return evalVat(raw, sum).v; // không biết TỔNG CỘNG (phía server) thì dùng số đã chốt (vals)
  return Number(r.vals[k]) || 0;
};
export const extraSum = (rows: ExtraRow[], col: string, sum?: number) => rows.reduce((t, r) => t + extraAmt(r, col, sum), 0);

// ---- THUẾ BỔ SUNG (khi có 2 loại thuế, VD 8% cho nhân công + 10% cho vật tư): mỗi dòng có tên + giá trị theo cột (A, B, C1.., D).
// Giá trị = số, hoặc công thức bắt đầu "=" dùng TT (tổng cộng trước thuế của cột đó): VD =TT*15%*8% ; hỗ trợ + - * / ^ ( ) và %.
export type VatRow = { id: string; label: string; vals: Record<string, string> };
export const parseVatRows = (s: string | null | undefined): VatRow[] => {
  const v = parseJson<unknown>(s || "[]", []);
  return Array.isArray(v)
    ? (v as VatRow[])
        .filter((x) => x && typeof x.id === "string")
        .map((x) => ({ id: x.id, label: String(x.label ?? ""), vals: x.vals && typeof x.vals === "object" ? Object.fromEntries(Object.entries(x.vals).map(([k, t]) => [k, String(t ?? "")])) : {} }))
    : [];
};
export function evalVat(raw: string | number | null | undefined, tt: number): { v: number; err?: string } {
  if (raw == null || String(raw).trim() === "") return { v: 0 };
  const src = String(raw).trim();
  if (!src.startsWith("=")) {
    // "25%" = 25% của cột (TT)
    if (/^-?[\d.,\s]+%$/.test(src)) {
      const pn = Number(src.slice(0, -1).replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
      return Number.isFinite(pn) ? { v: (tt * pn) / 100 } : { v: 0, err: "Không phải số" };
    }
    const n = Number(src.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    return Number.isFinite(n) ? { v: n } : { v: 0, err: "Không phải số" };
  }
  const e = src.slice(1).toUpperCase().replace(/\s+/g, "");
  let i = 0;
  const fail = (m: string): never => {
    throw new Error(m);
  };
  const primary = (): number => {
    if (e[i] === "(") {
      i++;
      const v = expr();
      if (e[i] !== ")") fail("Thiếu dấu )");
      i++;
      return v;
    }
    if (e.startsWith("TT", i)) {
      i += 2;
      return tt;
    }
    const m = /^\d+([.,]\d+)?/.exec(e.slice(i));
    if (!m) return fail("Sai công thức");
    i += m[0].length;
    return Number(m[0].replace(",", "."));
  };
  const unary = (): number => {
    if (e[i] === "-") {
      i++;
      return -unary();
    }
    if (e[i] === "+") {
      i++;
      return unary();
    }
    let v = primary();
    while (e[i] === "%") {
      i++;
      v /= 100;
    }
    return v;
  };
  const power = (): number => {
    const b = unary();
    if (e[i] === "^") {
      i++;
      return Math.pow(b, power());
    }
    return b;
  };
  const term = (): number => {
    let v = power();
    while (e[i] === "*" || e[i] === "/") {
      const op = e[i++];
      const r = power();
      v = op === "*" ? v * r : r === 0 ? fail("Chia cho 0") : v / r;
    }
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (e[i] === "+" || e[i] === "-") {
      const op = e[i++];
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = expr();
    if (i < e.length) fail("Sai công thức");
    return Number.isFinite(v) ? { v } : { v: 0, err: "Sai công thức" };
  } catch (x) {
    return { v: 0, err: (x as Error).message };
  }
}

// Dòng nào KHÔNG tính chi phí quản lý: dòng công việc đánh dấu noMgmt, hoặc nằm dưới đầu mục (GROUP / SUB) đánh dấu noMgmt (cùng phạm vi với tổng đầu mục).
// `lines` phải đủ MỌI dòng theo thứ tự trên bảng (kể cả đầu mục)
export const noMgmtFlags = (lines: { level: string; noMgmt?: boolean }[]): boolean[] => {
  const out = lines.map(() => false);
  lines.forEach((l, i) => {
    if (!l.noMgmt) return;
    if (l.level === "ITEM") {
      out[i] = true;
      return;
    }
    if (l.level === "REF") return;
    for (let j = i + 1; j < lines.length; j++) {
      const lj = lines[j];
      if (lj.level === "SUB" || (l.level === "GROUP" && lj.level === "GROUP") || (l.level === "SP" && !isPartLevel(lj.level))) break;
      if (lj.level === "ITEM") out[j] = true;
    }
  });
  return out;
};

// ---- NỘI THẤT (anh chốt 21/11/2026): 1 SẢN PHẨM (VD bàn) cần nhiều thầu phụ (khung, mặt đá, kính...) ----
// Dòng SẢN PHẨM (level "SP") = đầu mục của các dòng PHẦN VIỆC liền bên dưới; mỗi hồ sơ trình 1 phần việc của 1 thầu phụ:
// dòng phần việc đang trình = "ITEM" (tính tiền, duyệt, vào sổ giá như thường); phần việc KHÁC = "REF" (chỉ tham khảo:
// không cộng tổng, không duyệt, không vào sổ giá). Dòng sản phẩm cộng ĐỦ các phần việc (kể cả phần việc đã duyệt ở hồ sơ khác)
// để so với giá CĐT của cả sản phẩm.
export const isPartLevel = (lv: string) => lv === "ITEM" || lv === "REF";
// chỉ số các dòng phần việc của dòng sản phẩm i (các dòng ITEM / REF liền bên dưới)
export function spChildren(lines: { level: string }[], i: number): number[] {
  const out: number[] = [];
  for (let j = i + 1; j < lines.length && isPartLevel(lines[j].level); j++) out.push(j);
  return out;
}
// khoá nhận 1 phần việc của 1 sản phẩm giữa các hồ sơ: mã SP (không có thì tên SP) + tên phần việc, bỏ dấu / hoa thường / khoảng trắng
const ntNorm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const ntProductKey = (sp: { code: string; content: string }) => ntNorm(sp.code) || `#${ntNorm(sp.content)}`;
export const ntPartKey = (productKey: string, partName: string) => `${productKey}|${ntNorm(partName)}`;
// sản phẩm (dòng SP gần nhất phía trên) của từng dòng phần việc; dòng không thuộc sản phẩm nào = -1
export function spOwnerOf(lines: { level: string }[]): number[] {
  let cur = -1;
  return lines.map((l, i) => {
    if (l.level === "SP") {
      cur = i;
      return -1;
    }
    if (!isPartLevel(l.level)) cur = -1;
    return cur;
  });
}
// giá phần việc đã duyệt ở hồ sơ nội thất khác (cùng hợp đồng / dự án) — dùng cho dòng REF và dòng "phần việc khác" chỉ có ở hồ sơ khác
export type NtAppr = { code: string; proposalId: string; sub: string; name: string; unit: string; qty: number | null; price: number | null };
export type ColTotals = { sum: number; extra: number; prelim: number; beforeVat: number; vat: number; vat2: number; afterVat: number };
// TỔNG CỘNG → + dòng chi phí thêm + Prelim (% của TỔNG CỘNG) = trước VAT → + VAT (+ các dòng thuế bổ sung của cột `col`) = sau VAT
// noPrelim = tổng thành tiền các dòng KHÔNG tính chi phí quản lý (Prelim) — Prelim chỉ tính trên (TỔNG CỘNG − noPrelim)
export function totalsOf(sum: number, prelimPct: number, vatPct: number, extra = 0, vatRows: VatRow[] = [], col = "D", noPrelim = 0): ColTotals {
  const prelim = ((sum - noPrelim) * (prelimPct || 0)) / 100;
  const beforeVat = sum + extra + prelim;
  const vat = (beforeVat * (vatPct || 0)) / 100;
  const vat2 = vatRows.reduce((t, r) => t + evalVat(r.vals[col], beforeVat).v, 0);
  return { sum, extra, prelim, beforeVat, vat, vat2, afterVat: beforeVat + vat + vat2 };
}

// ---- CÔNG THỨC Ở CÁC DÒNG TỪ TỔNG CỘNG TRỞ XUỐNG (anh yêu cầu 21/11/2026: làm tròn ROUND / ROUNDUP / ROUNDDOWN như Excel) ----
// Cùng cách tính với totalsOf nhưng từng dòng (TỔNG CỘNG, chi phí thêm, PRELIM, TRƯỚC VAT, VAT, thuế bổ sung, SAU VAT) có thể bị
// thay bằng số tính từ công thức người dùng gõ (ov trả số) → các dòng bên dưới tính tiếp theo số đó.
// Mã dòng giống ô trên bảng: v:sum, v:x:<id chi phí thêm>, v:prelim, v:beforeVat, v:vat, v:t:<id thuế bổ sung>, v:afterVat
export type ChainArgs = { sum: number; noPrelim: number; prelimPct: number; vatPct: number; extras: ExtraRow[]; extraCol: string; vatRows: VatRow[]; vatCol: string };
export type ChainTotals = ColTotals & { x: Record<string, number>; t: Record<string, number> };
export function chainTotals(a: ChainArgs, ov: (row: string) => number | undefined = () => undefined): ChainTotals {
  const sum = ov("v:sum") ?? a.sum;
  const x: Record<string, number> = {};
  for (const r of a.extras) x[r.id] = ov(`v:x:${r.id}`) ?? extraAmt(r, a.extraCol, sum);
  const extra = Object.values(x).reduce((s, v) => s + v, 0);
  const prelim = ov("v:prelim") ?? ((sum - a.noPrelim) * (a.prelimPct || 0)) / 100;
  const beforeVat = ov("v:beforeVat") ?? sum + extra + prelim;
  const vat = ov("v:vat") ?? (beforeVat * (a.vatPct || 0)) / 100;
  const t: Record<string, number> = {};
  for (const r of a.vatRows) t[r.id] = ov(`v:t:${r.id}`) ?? evalVat(r.vals[a.vatCol], beforeVat).v;
  const vat2 = Object.values(t).reduce((s, v) => s + v, 0);
  const afterVat = ov("v:afterVat") ?? beforeVat + vat + vat2;
  return { sum, extra, prelim, beforeVat, vat, vat2, afterVat, x, t };
}
// khoá công thức: "<dòng>|<tổng cột>" — cột duyệt R dùng chung công thức của cột đề xuất D (như % Prelim / VAT)
export const totFxKey = (row: string, tk: string) => `${row}|${tk === "R" ? "D" : tk}`;
export const totFxTk = (key: string) => key.slice(key.lastIndexOf("|") + 1);
export const totFxRow = (key: string) => key.slice(0, key.lastIndexOf("|"));
// các dòng gõ được công thức (CHÊNH LỆCH so với CĐT cũng được; TỶ LỆ, vật tư / thiết bị thì không)
export const isTotFxRow = (row: string) => ["v:sum", "v:prelim", "v:beforeVat", "v:vat", "v:afterVat", "v:diff"].includes(row) || row.startsWith("v:x:") || row.startsWith("v:t:");
// số tổng đã lưu của các cột có công thức (lưu lúc bấm Lưu / Trình / Duyệt) — phía máy chủ (danh sách, tổng hợp, Excel) dùng thay số tự cộng
export type SavedTot = ColTotals & { x?: Record<string, number>; t?: Record<string, number>; diff?: number };
const TOT_NUM = ["sum", "extra", "prelim", "beforeVat", "vat", "vat2", "afterVat"] as const;
const numMap = (o: unknown): Record<string, number> | undefined =>
  o && typeof o === "object" ? Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([, v]) => typeof v === "number" && Number.isFinite(v)) as [string, number][]) : undefined;
export function cleanSavedTot(o: unknown): SavedTot | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (!TOT_NUM.every((k) => typeof r[k] === "number" && Number.isFinite(r[k]))) return null;
  const out = Object.fromEntries(TOT_NUM.map((k) => [k, r[k] as number])) as unknown as SavedTot;
  const x = numMap(r.x);
  const t = numMap(r.t);
  if (x) out.x = x;
  if (t) out.t = t;
  if (typeof r.diff === "number" && Number.isFinite(r.diff)) out.diff = r.diff;
  return out;
}
export function parseSavedTotals(s: string | null | undefined): Record<string, SavedTot> {
  const o = parseJson<unknown>(s || "{}", {});
  if (!o || typeof o !== "object") return {};
  const out: Record<string, SavedTot> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const t = cleanSavedTot(v);
    if (t) out[k] = t;
  }
  return out;
}
// tổng 1 cột: có số đã lưu theo công thức thì dùng số đó
export const withSaved = <T extends ColTotals>(t: T, s: SavedTot | undefined): T => (s ? { ...t, ...Object.fromEntries(TOT_NUM.map((k) => [k, s[k]])) } : t);

// Xếp nhánh: A khi đạt MỘT trong hai — (1) mọi dòng có đơn giá cơ sở và đơn giá đề xuất ≤ giá cơ sở TĐ1, (2) giá trị đề xuất ≤ 1 tỷ
export function branchOf(items: { content: string; prop: number | null; base: number | null }[], value: number): { branch: "A" | "B"; reason: string } {
  const noBase = items.filter((i) => i.base == null);
  const over = items.filter((i) => i.base != null && i.prop != null && i.prop > i.base + 0.5);
  const priceOk = !noBase.length && !over.length;
  const valueOk = value <= BRANCH_LIMIT;
  const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");
  if (priceOk) return { branch: "A", reason: "Mọi đơn giá đề xuất ≤ đơn giá cơ sở TĐ1" };
  if (valueOk) return { branch: "A", reason: `Giá trị đề xuất ${fmt(value)} đ ≤ 1 tỷ (có ${noBase.length ? `${noBase.length} đơn giá mới` : ""}${noBase.length && over.length ? ", " : ""}${over.length ? `${over.length} dòng vượt giá cơ sở` : ""})` };
  return {
    branch: "B",
    reason: `Giá trị đề xuất ${fmt(value)} đ > 1 tỷ và có ${[noBase.length && `${noBase.length} đơn giá mới (ngoài DT-CP)`, over.length && `${over.length} dòng vượt đơn giá cơ sở`].filter(Boolean).join(", ")}`,
  };
}

// Việc cần làm của người dùng với 1 hồ sơ thầu phụ (theo vai trò ĐƯỢC GÁN)
// QSĐT THEO DÕI hồ sơ mình đã trình (vẫn nằm trong "Việc của tôi" dù chưa tới lượt mình làm):
// A = đã gửi QSTT · B = QSTT đã trình Trưởng phòng / Phó Tổng · C = đã duyệt, chờ QSTT lên HĐ & gửi thầu phụ
export type SubTrack = "A" | "B" | "C" | "";
export const SUB_TODO_DT_WAIT_MAIL = "Đã duyệt — chưa gửi mail cho thầu phụ (QSTT chưa gửi)";
export const SUB_TRACK_LABEL: Record<Exclude<SubTrack, "">, string> = {
  A: "A. Đề xuất đã gửi QSTT",
  B: "B. QSTT đã trình Trưởng phòng, Phó Tổng",
  C: "C. Hồ sơ đã duyệt — chờ QSTT gửi HĐ cho thầu phụ",
};
export function subTrackOf(
  p: { status: string; hdNo: string; superseded: boolean; createdById?: string | null; mailSentAt?: Date | null },
  r: { dt?: boolean; uid?: string },
): SubTrack {
  if (!r.dt || !r.uid || p.createdById !== r.uid || p.superseded) return "";
  if (p.status === "QS_CHECK") return "A";
  if (p.status === "SUBMITTED" || p.status === "PTG_PENDING") return "B";
  if (p.status === "APPROVED" && (!p.hdNo || !p.mailSentAt)) return "C";
  return "";
}

export function subTodoOf(
  p: { status: string; branch: string; category: string; ptgAt: Date | null; hdNo: string; superseded: boolean; createdById?: string; mailSentAt?: Date | null },
  r: { qs: boolean; ptg: boolean; cats: string[]; dt?: boolean; uid?: string },
): string {
  // hồ sơ ai TẠO thì việc lập / bổ sung chỉ hiện ở "việc của tôi" của người đó
  const mine = !r.uid || !p.createdById || p.createdById === r.uid;
  if (p.status === "SUBMITTED" && r.cats.includes(p.category)) return "Trưởng phòng duyệt";
  if (p.status === "PTG_PENDING" && r.ptg) return "Phó Tổng phê duyệt";
  if (p.status === "APPROVED" && p.branch === "A" && !p.ptgAt && r.ptg) return "Phó Tổng xem để nắm";
  if (r.qs && p.status === "QS_CHECK") return "Kiểm tra & trình Trưởng phòng";
  if ((r.dt || r.qs) && p.status === "NEED_INFO" && mine) return "Bổ sung hồ sơ theo yêu cầu Trưởng phòng";
  if (r.dt && p.status === "DRAFT" && mine) return "Lập hồ sơ, chuyển QSTT kiểm tra";
  if ((r.dt || r.qs) && p.status === "REJECTED" && !p.superseded && mine) return "Bổ sung, sửa & trình lại";
  if (r.qs && p.status === "APPROVED" && !p.hdNo) return "Lên HĐ/PLHĐ gửi thầu phụ";
  // đã duyệt mà chưa gửi mail cho thầu phụ → nhắc người tạo hồ sơ (QSTT soạn & gửi; QSĐT nắm để đôn đốc)
  if (p.status === "APPROVED" && !p.mailSentAt && !p.superseded && mine) {
    if (r.qs) return "Soạn & gửi mail kết quả cho thầu phụ";
    if (r.dt) return SUB_TODO_DT_WAIT_MAIL;
  }
  return "";
}
