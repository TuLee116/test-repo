import { normalizeText } from "@/lib/text-normalize";
import { jaccard, tokenSet, type MatchCandidate } from "@/lib/boq-match";

// So khớp BOQ cũ (đã có trong dự án) với 1 file BOQ mới của CĐT, theo mô tả công việc - dùng khi CĐT
// sửa đổi BOQ và cần cập nhật mà KHÔNG mất mã định mức/phương án/giá đã gán cho các dòng BOQ cũ.
export type ExistingBoqRow = {
  id: string;
  rawDescription: string;
  rawUnit: string;
  stt: string;
  quantity: number;
  isHeading: boolean;
  workItemId: string | null;
  workItemCode: string | null;
  workItemName: string | null;
  hasSubData: boolean; // đã có đơn giá/tên thầu phụ nhập ở TH Thầu Phụ - cảnh báo khi xoá
};

export type NewBoqRow = {
  rowIndex: number;
  stt: string;
  desc: string;
  unit: string;
  qty: number;
  isHeading: boolean;
  matchedWorkItemId: string | null;
  matchedWorkItemName: string | null;
  matchedWorkItemUnit: string | null;
  matchType: string;
  candidates?: MatchCandidate[]; // mã gợi ý khi chưa tự khớp được (xem createMatcher)
  images?: string[]; // mã ảnh tạm lấy từ file Excel (api/import/parse)
  price?: number | null; // đơn giá CĐT trong file (khi chọn cột Đơn giá)
  amount?: number | null; // thành tiền trong file - chỉ để đối chiếu
  note?: string; // ghi chú trong file
};

// renamed = true: không khớp chữ y hệt, chỉ khớp GẦN ĐÚNG theo nội dung (CĐT đổi tên công việc nhưng
// vẫn là công việc đó) - UI tô đỏ để người dùng tự soát lại cho chắc, vì đây là suy đoán chứ không
// chắc chắn 100% như khớp chữ y hệt.
export type MatchedPair = { existing: ExistingBoqRow; next: NewBoqRow; renamed: boolean };

// Trùng chữ y hệt (sau chuẩn hoá) thì chắc chắn là 1 việc, không cần ngưỡng. Khớp gần đúng (đổi tên)
// thì cần độ giống nội dung đủ cao mới ghép, tránh ghép nhầm 2 công tác khác hẳn nhau.
const RENAME_THRESHOLD = 0.6;

export function diffBoq(existing: ExistingBoqRow[], incoming: NewBoqRow[]) {
  // ---- Bước 1: khớp CHÍNH XÁC theo mô tả đã chuẩn hoá (bỏ dấu/hoa thường/khoảng trắng) ----
  // Trùng mô tả nhiều lần (dòng lặp) thì khớp theo đúng thứ tự xuất hiện (hàng đợi theo từng khoá).
  const queueByKey = new Map<string, ExistingBoqRow[]>();
  for (const it of existing) {
    const key = normalizeText(it.rawDescription);
    const q = queueByKey.get(key);
    if (q) q.push(it);
    else queueByKey.set(key, [it]);
  }
  const matched: MatchedPair[] = [];
  const created: NewBoqRow[] = [];
  for (const row of incoming) {
    const key = normalizeText(row.desc);
    const hit = queueByKey.get(key)?.shift();
    if (hit) matched.push({ existing: hit, next: row, renamed: false });
    else created.push(row);
  }
  const removedCandidates = [...queueByKey.values()].flat();

  // ---- Bước 2: khớp GẦN ĐÚNG cho các dòng còn lại - CĐT đổi tên/viết lại mô tả nhưng vẫn là công
  // tác đó (không áp dụng cho đầu mục lớn: tên đầu mục ngắn, dễ trùng giả). Tính độ giống của MỌI cặp
  // (dòng mới, dòng cũ còn lại), ghép từ cặp giống nhau nhất trở xuống, mỗi dòng chỉ ghép 1 lần.
  const createdWork = created.map((r, i) => ({ r, i })).filter((x) => !x.r.isHeading);
  const removedWork = removedCandidates.map((r, i) => ({ r, i })).filter((x) => !x.r.isHeading);
  const candidates: { ci: number; ri: number; score: number }[] = [];
  for (const c of createdWork) {
    const ct = tokenSet(normalizeText(c.r.desc));
    for (const rm of removedWork) {
      const score = jaccard(ct, tokenSet(normalizeText(rm.r.rawDescription)));
      if (score >= RENAME_THRESHOLD) candidates.push({ ci: c.i, ri: rm.i, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedCreated = new Set<number>();
  const usedRemoved = new Set<number>();
  for (const cand of candidates) {
    if (usedCreated.has(cand.ci) || usedRemoved.has(cand.ri)) continue;
    usedCreated.add(cand.ci);
    usedRemoved.add(cand.ri);
    matched.push({ existing: removedCandidates[cand.ri], next: created[cand.ci], renamed: true });
  }

  return {
    matched,
    created: created.filter((_, i) => !usedCreated.has(i)),
    removedCandidates: removedCandidates.filter((_, i) => !usedRemoved.has(i)),
  };
}
