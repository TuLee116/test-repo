"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import NumInput from "../../../NumInput";
import ExcelGrid, { xcell, type GridPaste, type XlGridApi, type GridNote } from "../../../ExcelGrid";
import { useUndo, useXlFormulas } from "../../../xl/useXl";
import { useCellNotes } from "../../../xl/useCellNotes";
import { colLetter } from "@/lib/grid-formula";
import { balanceParens, evalGrid, forEval, numRaw, toDisplay, toStable, type XlLayout } from "@/lib/xl-formula";
import { parsePastedNumber } from "@/lib/parse-number";
import { FormLetterhead, FormSheet } from "../../../mua-vat-tu/forms/FormBits";
import { CATEGORIES, categoryLabel } from "@/lib/gia-doi-calc";
import { normText, similarity } from "@/lib/hop-dong-calc";
import type { NtContext, SubChain } from "@/lib/thau-phu";
import { amt, apprPriceOf, isPartLevel, noMgmtFlags, spChildren, AWARD_FORMS, awardNeed, baseOfLine, PL_KINDS, signedNeeded, PRICE_MODES, compSum, BRANCH_LABEL, CONTRACT_STATES, chainTotals, extraAmt, evalVat, fixedTerms, isContractState, isTotFxRow, propPriceOf, propQtyOf, termAppr, termChoices, termPresets, termProp, totFxKey, totFxRow, totFxTk, type Bid, type ChainArgs, type ChainTotals, type SavedTot, type Bidder, type ExtraRow, type VatRow, type Term } from "@/lib/thau-phu-calc";
import BidderCols from "./BidderCols";
import ScopeTable from "./ScopeTable";
import SubImageCell from "./SubImageCell";
import { adjustApprovedSubAction, saveSubHeadInfoAction, handSubToQsttAction, qsdtUpdateInfoAction, uploadSubScopeAction, saveSubScopeAction, tpRequestInfoAction, ptgDecideSubAction, rematchSubAction, rereadSubFileAction, saveSubDraftAction, setSubContractAction, setSubLineMatchAction, submitSubAction, tpDecideSubAction, tpSaveSubAction, type SubFin, type SubHead, type SubLineInput, type SubTpLine, type TotFxInput } from "@/lib/thau-phu-actions";
import { confirmNear } from "@/app/(app)/confirm-near";
import SitePicker from "@/app/(app)/du-an/SitePicker";
import type { SiteOpt } from "@/lib/project-site-calc";
import { useTaskWorkspace } from "@/app/(app)/TaskWorkspace";

// Hồ sơ "BẢNG ĐỀ XUẤT KÝ HỢP ĐỒNG THẦU PHỤ" theo mẫu file: CĐT (A) · cơ sở (B) · các thầu phụ (C1, C2...) · ĐỀ XUẤT DUYỆT (D)
// + KIỂM SOÁT THEO DT-CP (dòng TH Thầu Phụ, đơn giá cơ sở TĐ1, giá đã duyệt) + khối DUYỆT (Trưởng phòng / Phó Tổng).
//  mode "qs": QSTT kiểm tra, chọn thầu phụ, sửa đề xuất, khớp DT-CP, trình · "tp" Trưởng phòng · "ptg" Phó Tổng (nhánh B) · "view"

// ô giá của 1 thầu phụ trong bids: q = khối lượng, p = đơn giá tổng, v / n / t = đơn giá vật tư / nhân công / thiết bị (giá chi tiết)
const BID_F = { q: "qty", p: "price", v: "vt", n: "nc", t: "tb" } as const;
export type SubSheetLine = SubLineInput & {
  level: string;
  stt: string;
  workName: string;
  code: string;
  origin: string; // MEP: nhãn hiệu - xuất xứ
  noMgmt: boolean; // KHÔNG tính chi phí quản lý (Prelim) cho dòng này (đầu mục: cả nhóm)
  cdtVt: number | null; // MEP: giá chi tiết vật tư / nhân công của khối CĐT
  cdtNc: number | null;
  cdtKh: number | null; // MEP TẠM: % thuê vật tư của khối CĐT
  dims: string;
  material: string; // NỘI THẤT: mô tả vật liệu, dài / rộng / cao (mm)
  dimL: string;
  dimW: string;
  dimH: string;
  cdtQty: number | null;
  cdtPrice: number | null;
  baseQty: number | null;
  basePrice: number | null;
  baseVt: number | null; // giá chi tiết của khối cơ sở (basePrice = tổng)
  baseNc: number | null;
  baseTb: number | null;
  bids: Record<string, Bid>;
  tpPrice: number | null;
  tpOk: boolean;
  tpNote: string;
  added?: boolean; // dòng thêm trên phần mềm (không có trong file gốc) — nền xanh nhạt
  formulas: Record<string, string>; // công thức kiểu Excel các ô số (src/lib/xl-formula.ts)
  propVt: number | null; // giá chi tiết: đơn giá vật tư / nhân công / thiết bị của khối đề xuất (propPrice = tổng)
  propNc: number | null;
  propTb: number | null;
  hdQty: number | null; // PLHĐ điều chỉnh: KL theo hợp đồng gốc (trống = hạng mục mới của phụ lục)
  hdPrice: number | null; // PLHĐ điều chỉnh: đơn giá theo hợp đồng gốc
  cdtHdQty: number | null; // PLHĐ điều chỉnh: khối CĐT theo hợp đồng (cdtQty / cdtPrice = điều chỉnh)
  cdtHdPrice: number | null;
  baseHdQty: number | null; // PLHĐ điều chỉnh: khối cơ sở theo hợp đồng (baseQty / basePrice = điều chỉnh)
  baseHdPrice: number | null;
  baseManual: boolean; // người dùng tự sửa ĐƠN GIÁ CƠ SỞ (B) → không lấy theo DT-CP tự khớp nữa
  baseNote: string; // ghi chú khối cơ sở người dùng nhập (trống = phần mềm tự ghi Đã khớp / Chưa khớp)
};
export type SubRefLite = { key: string; name: string; unit: string; qty: number | null; prevQty: number; base1: number | null; price: number | null; approved: { crew: string; price: number; date: string }[] };

const fm = (n: number | null | undefined) => (n ? Math.round(n).toLocaleString("vi-VN") : "");
const NT_EMPTY: NtContext = { refAppr: {}, extra: {} };
const fq = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("vi-VN", { maximumFractionDigits: 3 }));

export default function SubSheet({
  id,
  notes: initNotes = [],
  mode,
  adjust = false,
  head: initHead,
  lines: initLines,
  bidders,
  ntImages = {},
  nt: ntCtx = NT_EMPTY,
  contracts,
  sites,
  areas,
  contractId,
  refs,
  revision,
  category: initCat,
  branch,
  branchReason,
  reviewNote,
  canSubmit,
  canHandOff,
  chain,
  hdtpOptions,
  scope = [],
  needInfo = "",
  returnSlot = null,
  headEdit = false,
  dtcpPanel = null,
}: {
  dtcpPanel?: React.ReactNode; // nút "Xem DT-CP" — ngăn bên phải hiện bảng TH Thầu Phụ của DT-CP để dò, đối chiếu
  headEdit?: boolean; // Trưởng phòng (đang chờ duyệt) / Quản trị (mọi lúc): sửa được các trường thông tin đầu hồ sơ (không ảnh hưởng giá duyệt)
  returnSlot?: React.ReactNode; // nút "Trả lại QSĐT" (server action) do trang truyền vào, đặt ở thanh nút dưới đáy của QSTT
  needInfo?: string; // nội dung Trưởng phòng yêu cầu QSĐT bổ sung (khác rỗng = hồ sơ đang chờ QSĐT bổ sung)
  scope?: string[][]; // sheet PHẠM VI CÔNG VIỆC đọc từ file lúc nhập (chỉ xem)
  id: string;
  notes?: GridNote[]; // ghi chú ô (tam giác đỏ)
  mode: "qs" | "tp" | "ptg" | "view";
  adjust?: boolean; // điều chỉnh giá sau khi đã duyệt
  head: SubHead;
  lines: SubSheetLine[];
  bidders: Bidder[];
  ntImages?: Record<string, string[]>; // NỘI THẤT: ảnh từng dòng (mã ảnh) — lấy theo trang (không giữ trong state) để thêm / xoá ảnh không mất phần đang sửa
  nt?: NtContext; // NỘI THẤT: giá các phần việc đã duyệt ở hồ sơ khác (dòng tham khảo + phần việc chỉ có ở hồ sơ khác)
  contracts: { id: string; label: string; name: string; siteId: string | null; area: string; contractNo: string }[];
  sites: SiteOpt[]; // DANH MỤC DỰ ÁN
  areas: string[];
  contractId: string | null;
  refs: SubRefLite[];
  revision: number;
  category: string;
  branch: string;
  branchReason: string;
  reviewNote: string;
  canSubmit: boolean; // chỉ QSTT trình Trưởng phòng; QSĐT lập / sửa hồ sơ
  canHandOff: boolean; // hồ sơ đang ở bước QSĐT lập → hiện nút "Chuyển QSTT kiểm tra"
  chain: SubChain | null; // phụ lục: HĐ thầu phụ gốc + các phụ lục đã duyệt trước (lũy kế)
  hdtpOptions: { id: string; label: string }[]; // các HĐ thầu phụ (đã có số HĐ) để chọn khi trình phụ lục
}) {
  const router = useRouter();
  const cellNotes = useCellNotes("TPH", id, initNotes);
  const [pending, start] = useTransition();
  // điều khoản luôn 4 dòng cố định (Tiến độ / Tạm ứng / Thanh toán / Quyết toán), chỉ 2 cột ĐỀ XUẤT | DUYỆT
  const [head, setHead] = useState<SubHead>(() => ({ ...initHead, terms: fixedTerms(initHead.terms), extras: initHead.extras ?? [], vatRows: initHead.vatRows ?? [] }));
  // ô HỢP ĐỒNG: id hợp đồng (DT-CP) | "@khac" số HĐ chưa có DT-CP trên phần mềm | "@0" / "@1" = Đang trình HĐ / Đang báo giá
  const [hdSel, setHdSel] = useState(() =>
    contractId ? contractId : isContractState(initHead.cdtContract) ? `@${CONTRACT_STATES.indexOf(initHead.cdtContract.trim() as (typeof CONTRACT_STATES)[number])}` : initHead.cdtContract.trim() ? "@khac" : "",
  );
  const [lines, setLines] = useState(initLines);
  // HẠNG MỤC CÔNG VIỆC trùng NỘI DUNG CÔNG VIỆC ở mọi dòng có hạng mục (VD QSĐT chọn cùng 1 cột Excel cho cả hai lúc nhập) → chỉ hiện cột
  // NỘI DUNG: cột hạng mục ẩn kiểu Excel (địa chỉ ô giữ nguyên). Xét 1 lần lúc mở hồ sơ; khi lưu, hạng mục chép theo nội dung để luôn trùng.
  const [oneName] = useState(() => initLines.some((l) => l.workName.trim()) && initLines.every((l) => !l.workName.trim() || normText(l.workName) === normText(l.content)));
  const [forceD, setForceD] = useState(false); // ép hiện khối ĐỀ XUẤT DUYỆT (D) dù trùng giá 1 thầu phụ
  // phụ lục: QSĐT chọn HĐTP gốc có sẵn hoặc tự gõ số HĐ (hệ thống đang cập nhật dần)
  const [hdtpTyped, setHdtpTyped] = useState(() => !initHead.hdtpId && !!(initHead.hdtpNo ?? "").trim());
  const [category, setCategory] = useState(initCat);
  const [note, setNote] = useState(reviewNote);
  const [reply, setReply] = useState(""); // QSĐT ghi đã bổ sung gì khi Cập nhật theo yêu cầu Trưởng phòng
  // Bổ sung theo yêu cầu TP: QSĐT bấm "Bổ sung hồ sơ" rồi chọn mục A / B / C; mục chưa chọn thì khoá (chỉ xem)
  // mục C: bảng phạm vi công việc (QSĐT sửa nội dung, thêm / xoá dòng, cột; lưu khi bấm Lưu / Lưu nháp / Cập nhật / Chuyển / Trình)
  const [scopeRows, setScopeRows] = useState<string[][]>(scope);
  const [scopeDirty, setScopeDirty] = useState(false);
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    setScopeRows(scope);
    setScopeDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  const [part, setPart] = useState<"" | "A" | "B" | "C">("");
  const [pickPart, setPickPart] = useState(false);
  const lockA = !!needInfo && part !== "A";
  const lockB = !!needInfo && part !== "B";
  const choosePart = (p: "A" | "B" | "C") => {
    setPart(p);
    setPickPart(false);
    setTimeout(() => document.getElementById(`sub-part-${p}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const [dirty, setDirty] = useState(false);
  const ws = useTaskWorkspace();
  const qs = mode === "qs";
  const rv = mode === "tp" || mode === "ptg";
  // he = được sửa thông tin đầu hồ sơ: QSĐT / QSTT (lưu cùng bảng) hoặc Trưởng phòng / Quản trị (lưu riêng bằng saveSubHeadInfoAction)
  const he = qs || headEdit;
  const [cid, setCid] = useState(contractId); // hợp đồng đang chọn trên đầu hồ sơ (Trưởng phòng / Quản trị đổi thì lưu khi bấm Lưu thông tin)
  const [headDirty, setHeadDirty] = useState(false);
  const sel = head.selectedBidder;
  // ĐỀ XUẤT DUYỆT TRÙNG GIÁ 1 THẦU PHỤ → bỏ khối D cho gọn, ghi chú + tô nổi cột thầu phụ được duyệt; Trưởng phòng / Phó Tổng sửa giá chỉ còn 2 cột hẹp (đơn giá duyệt, thành tiền duyệt).
  // PLHĐ điều chỉnh, duyệt nhiều thầu phụ, hoặc dòng có giá / KL đề xuất khác thầu phụ → vẫn hiện khối D.
  // tên thầu phụ được đề xuất duyệt (thầu phụ chọn trong danh sách báo giá, không có thì tên ghi ở đầu hồ sơ); bỏ cặp ngoặc trống "()" thừa
  const dName = (bidders.find((b) => b.key === sel)?.name || head.subName || "").replace(/\s*\(\s*\)\s*$/, "").trim();
  const awards = (head.awards ?? []).filter((a) => a.pct > 0);
  const multiAward = awards.length > 1;
  const sameNum = (a: number | null | undefined, b: number | null | undefined) => a == null || (b != null && Math.abs(a - b) < 0.5);
  const plAdj = head.proposalType === "PL" && head.plKind === "DIEU_CHINH";
  const selBid = bidders.some((b) => b.key === sel);
  // thầu phụ được chọn KHÔNG có số liệu báo giá (giá nằm ở khối D) → cột thầu phụ trống: ẩn đi, khối D mang tên thầu phụ
  const bidEmpty = !multiAward && selBid && lines.every((l) => l.level !== "ITEM" || (l.bids[sel]?.qty == null && l.bids[sel]?.price == null));
  const sameD = !multiAward && selBid && !bidEmpty && lines.every((l) => l.level !== "ITEM" || (sameNum(l.propPrice, l.bids[sel]?.price) && sameNum(l.propQty, l.bids[sel]?.qty)));
  // NỘI THẤT: cột Mã SP · Hạng mục · Hình ảnh · Mô tả vật liệu · Dài / Rộng / Cao · ĐVT (không có cột hạng mục riêng); dòng SP = sản phẩm,
  // dòng REF = phần việc khác (không trình lần này) — có dòng REF thì luôn hiện khối Đề xuất (D) để thấy giá dự kiến / đã duyệt của phần việc đó
  const ntm = !!head.isNt;
  const hasRef = ntm && lines.some((l) => l.level === "REF");
  const hideD = sameD && !forceD && !plAdj && !hasRef;
  // PLHĐ điều chỉnh: khối D còn cần (cột Hợp đồng / Điều chỉnh / Phụ lục) nên thay vào đó GỘP cột thầu phụ được duyệt vào khối D (ẩn cột thầu phụ đó, địa chỉ ô giữ nguyên như cột ẩn trong Excel)
  const hideBid = !forceD && ((sameD && plAdj) || bidEmpty);
  const canMerge = sameD || bidEmpty; // có nút gộp / tách
  const miniD = false; // (bỏ khối 2 cột DUYỆT riêng — Trưởng phòng / Phó Tổng sửa thẳng trên cột thầu phụ được duyệt)
  // khối D bị ẩn: cột thầu phụ được duyệt ĐÓNG VAI khối D (% Prelim / VAT, chi phí thêm, thuế bổ sung, tổng duyệt)
  const dCol = hideD ? sel : null;
  const apprCol = hideD && !qs ? sel : null; // Trưởng phòng / Phó Tổng sửa trực tiếp đơn giá duyệt trên cột này (lưu vào giá duyệt, không đổi giá thầu phụ báo)
  const pk = (c: string) => (c === dCol ? "D" : c); // khoá % / thuế / chi phí thêm theo cột
  const tkOf = (c: string) => (c === "D" || c === dCol ? (qs ? "D" : "R") : c); // tổng hiện ở cột c
  const blockKeys = ["A", "B", ...bidders.map((b) => b.key), ...(hideD ? [] : ["D"])];
  // PLHĐ điều chỉnh: khối CĐT, cơ sở, đề xuất đều 7 cột — KL (hợp đồng | điều chỉnh), đơn giá (hợp đồng | điều chỉnh), thành tiền (hợp đồng | điều chỉnh | phụ lục)
  const showHd = head.proposalType === "PL" && head.plKind === "DIEU_CHINH";
  // ÁP DỤNG CHUNG 1 KHỐI LƯỢNG (KL CĐT = cơ sở = thầu phụ = đề xuất): bảng chỉ 1 cột KL sau ĐVT, sửa ô đó là đổi KL mọi khối
  const oneQ = !!head.oneQty && !showHd;
  // giá chi tiết: khối thầu phụ + đề xuất có thêm 3 cột con vật tư | nhân công | thiết bị (đơn giá tổng = cộng 3 thành phần; thành phần = 0 vẫn hợp lệ)
  const showCt = head.priceMode === "CHITIET";
  const mep = !!head.isMep; // thầu phụ MEP: thêm cột NHÃN HIỆU - XUẤT XỨ (MÃ SP đổi tên thành MÃ HIỆU SẢN PHẨM)
  // giá chi tiết: MEP không có thiết bị (2 cột vật tư | nhân công), CĐT của MEP cũng có vật tư | nhân công
  const mepT = mep && !!head.mepTemp; // MEP TẠM: cột "thiết bị" thành % THUÊ VẬT TƯ (khấu hao): đơn giá = vật tư × % + nhân công
  const noTb = mep && !mepT; // MEP thường: không có thiết bị
  const nComp = noTb ? 2 : 3;
  // các cột đầu bảng (trước khối CĐT): thường STT | Hạng mục | Nội dung | Mã SP | ĐVT; MEP thêm Nhãn hiệu; NỘI THẤT theo mẫu nội thất
  const leadCols = ntm ? ["stt", "code", "content", "img", "material", "dimL", "dimW", "dimH", "unit"] : ["stt", "workName", "content", "code", ...(mep ? ["origin", "unit"] : ["unit"])];
  const padN = leadCols.length - 3; // số cột đầu sau cột nội dung (dòng đầu mục / dòng tổng để trống)
  // giá 1 phần việc khác (REF): đã duyệt ở hồ sơ khác thì theo giá duyệt, không thì giá dự kiến QSĐT nhập ở khối đề xuất
  const refQP = (l: SubSheetLine): [number | null, number | null] => {
    const a = ntCtx.refAppr[l.id];
    return a ? [a.qty ?? propQtyOf(l, sel), a.price] : [propQtyOf(l, sel), propPriceOf(l, sel)];
  };
  // đơn giá tổng từ thành phần: thường = vật tư + nhân công + thiết bị; MEP TẠM = vật tư × % thuê + nhân công
  const cs = (vt: number | null | undefined, nc: number | null | undefined, tb: number | null | undefined) => (mepT ? (vt == null && nc == null ? null : (vt ?? 0) * ((tb ?? 100) / 100) + (nc ?? 0)) : compSum(vt, nc, tb));
  const baseC = useMemo(() => (showCt ? (noTb ? ["baseVt", "baseNc"] : ["baseVt", "baseNc", "baseTb"]) : []), [showCt, noTb]); // cột giá chi tiết của khối cơ sở
  const propC = useMemo(() => (showCt ? (noTb ? ["propVt", "propNc"] : ["propVt", "propNc", "propTb"]) : []), [showCt, noTb]); // và của khối đề xuất
  const cdtComp = mep && showCt && !showHd; // khối CĐT có thêm 2 cột vật tư | nhân công
  const hasComp = (c: string) => showCt && (c !== "A" || cdtComp) && !(c === "D" && hideD); // khối giá c có các cột đơn giá chi tiết
  const refMap = useMemo(() => new Map(refs.map((r) => [r.key, r])), [refs]);
  // ---- CHỌN KHỚP DT-CP bằng tay: xem dòng DT-CP Thầu Phụ gần giống (kèm đơn giá) rồi bấm chọn. QSĐT / QSTT lưu khi bấm Lưu; Trưởng phòng / Phó Tổng lưu ngay ----
  const [matchRow, setMatchRow] = useState<string | null>(null);
  const [matchQ, setMatchQ] = useState("");
  const candidatesOf = (l: SubSheetLine) => {
    const q = normText(matchQ);
    const unit = normText(l.unit);
    return refs
      .map((r) => ({ r, score: q ? (normText(r.name).includes(q) ? 1 : 0) : Math.max(similarity(l.content, r.name), similarity(`${l.workName} ${l.content}`, r.name)) + (unit && normText(r.unit) === unit ? 0.15 : 0) }))
      .filter((x) => x.score > (q ? 0 : 0.12))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  };
  const pickMatch = (l: SubSheetLine, key: string) => {
    if (!rv) {
      setL(l.id, { lineKey: key });
      setMatchRow(null);
      return;
    }
    start(async () => {
      const r = await setSubLineMatchAction(id, l.id, key);
      if (!r.ok) return window.alert(r.error);
      setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, lineKey: key } : x)));
      setMatchRow(null);
    });
  };
  // ĐƠN GIÁ CƠ SỞ (B) = đơn giá TĐ1 của dòng TH Thầu Phụ đã khớp; chưa khớp thì giá cơ sở trong file; "-" = ngoài DT-CP (đơn giá mới)
  const baseOf = (l: SubSheetLine) => baseOfLine(l, refMap.get(l.lineKey)?.base1);
  const setH = (p: Partial<SubHead>) => {
    setHead((h) => ({ ...h, ...p }));
    setDirty(true);
    setHeadDirty(true);
  };
  const setL = (lid: string, p: Partial<SubSheetLine>) => {
    setLines((ls) => ls.map((l) => (l.id === lid ? { ...l, ...p } : l)));
    setDirty(true);
  };

  // KL chung → ghi cùng 1 số vào KL chủ đầu tư, cơ sở, mọi thầu phụ (và đề xuất nếu đang có số)
  const shareQtyPatch = (l: SubSheetLine, v: number | null): Partial<SubSheetLine> => ({
    cdtQty: v,
    baseQty: v,
    propQty: l.propQty != null ? v : null,
    bids: Object.fromEntries([...new Set([...Object.keys(l.bids), ...bidders.map((b) => b.key)])].map((k) => [k, { ...(l.bids[k] ?? { qty: null, price: null }), qty: v }])),
  });
  // bật / tắt CHUNG 1 KHỐI LƯỢNG trên hồ sơ: bật thì lấy KL chủ đầu tư (trống thì cơ sở / thầu phụ) ghi chung cho mọi khối
  const toggleOneQty = (on: boolean) => {
    if (!on) return setH({ oneQty: false });
    const qOf = (l: SubSheetLine) => l.cdtQty ?? l.baseQty ?? l.bids[sel]?.qty ?? Object.values(l.bids).find((b) => b?.qty != null)?.qty ?? null;
    const near = (a: number | null | undefined, b: number | null) => a == null || (b != null && Math.abs(a - b) < 1e-6);
    const diff = lines.filter((l) => l.level === "ITEM" && (!near(l.cdtQty, qOf(l)) || !near(l.baseQty, qOf(l)) || Object.values(l.bids).some((b) => !near(b?.qty, qOf(l)))));
    if (diff.length && !window.confirm(`${diff.length} dòng có khối lượng khác nhau giữa chủ đầu tư / cơ sở / thầu phụ (VD dòng ${diff[0].stt || "?"} "${diff[0].content.slice(0, 40)}").\nLấy khối lượng CHỦ ĐẦU TƯ (trống thì cơ sở / thầu phụ) làm khối lượng chung cho tất cả?`)) return;
    setLines((ls) => ls.map((l) => (l.level === "ITEM" ? { ...l, ...shareQtyPatch(l, qOf(l)) } : l)));
    setH({ oneQty: true });
  };
  const skipFlags = useMemo(() => noMgmtFlags(lines), [lines]); // dòng không tính chi phí quản lý (kể cả dòng nằm dưới đầu mục được đánh dấu)
  // ---- thành tiền + tổng từng cột (A, B, C1.., D, Duyệt) ----
  // THÀNH TIỀN TỔNG DUYỆT (duyệt nhiều thầu phụ): Σ (% khối lượng × KL × đơn giá) của các thầu phụ được duyệt
  const sAmt = (l: SubSheetLine) => awards.reduce((t, a) => t + (a.pct / 100) * (amt(l.bids[a.key]?.qty ?? null, l.bids[a.key]?.price ?? null) ?? 0), 0);
  const cols: string[] = ["A", "B", ...bidders.map((b) => b.key), "D", "R", "H", "AH", "BH", ...(multiAward ? ["S"] : [])];
  // calc0 = số tự cộng (chưa áp công thức người dùng gõ ở các dòng tổng); `calc` (bên dưới) = số cuối cùng hiện trên bảng
  const calc0 = useMemo(() => {
    const qp =(l: SubSheetLine, c: string): [number | null, number | null] =>
      c === "A" ? [l.cdtQty, l.cdtPrice] : c === "B" ? [l.baseQty, baseOf(l)] : c === "D" ? [propQtyOf(l, sel), propPriceOf(l, sel)] : c === "R" ? [propQtyOf(l, sel), apprPriceOf(l, sel)] : c === "H" ? [l.hdQty, l.hdPrice] : c === "AH" ? [l.cdtHdQty, l.cdtHdPrice] : c === "BH" ? [l.baseHdQty, l.baseHdPrice] : [l.bids[c]?.qty ?? null, l.bids[c]?.price ?? null];
    const amtOf = (l: SubSheetLine, c: string) => (c === "S" ? sAmt(l) : (amt(...qp(l, c)) ?? 0));
    const sums: Record<string, number> = {};
    const exempt: Record<string, number> = {}; // phần KHÔNG tính chi phí quản lý (Prelim)
    const skip = noMgmtFlags(lines);
    const group: (Record<string, number> | null)[] = lines.map(() => null);
    for (const c of cols) {
      sums[c] = 0;
      exempt[c] = 0;
    }
    lines.forEach((l, i) => {
      if (l.level === "ITEM")
        for (const c of cols) {
          const a = amtOf(l, c);
          sums[c] += a;
          if (skip[i]) exempt[c] += a;
        }
      else if (l.level !== "REF") {
        // REF (phần việc khác, nội thất) không cộng vào tổng nào; dòng SP (sản phẩm) = tổng các phần việc trình lần này của nó
        const g: Record<string, number> = {};
        for (const c of cols) g[c] = 0;
        for (let j = i + 1; j < lines.length; j++) {
          const lj = lines[j];
          if (lj.level === "SUB" || (l.level === "GROUP" && lj.level === "GROUP") || (l.level === "SP" && !isPartLevel(lj.level))) break; // cấp 1 gồm cả các cấp 2 bên dưới
          if (lj.level === "ITEM") for (const c of cols) g[c] += amtOf(lj, c);
        }
        group[i] = g;
      }
    });
    const pct = (rec: Record<string, number>, c: string) => rec[c === "R" || c === "H" || c === "S" ? "D" : c === "AH" ? "A" : c === "BH" ? "B" : c] ?? 0;
    // TỔNG CỘNG → + dòng chi phí thêm (extras) + Prelim = trước VAT → + VAT = sau VAT
    const args: Record<string, ChainArgs> = Object.fromEntries(
      cols.map((c) => [c, { sum: sums[c], noPrelim: exempt[c], prelimPct: pct(head.prelim, c), vatPct: pct(head.vat, c), extras: head.extras ?? [], extraCol: c === "S" ? "D" : c, vatRows: head.vatRows ?? [], vatCol: c === "R" || c === "H" || c === "S" ? "D" : c === "AH" ? "A" : c === "BH" ? "B" : c }]),
    );
    const totals: Record<string, ChainTotals> = Object.fromEntries(cols.map((c) => [c, chainTotals(args[c])]));
    return { qp, group, totals, exempt, args };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, head.prelim, head.vat, head.extras, head.vatRows, sel, refMap, bidders]);

  // công thức + số tổng của các dòng từ TỔNG CỘNG trở xuống gửi kèm khi lưu (totPayload ở dưới, cập nhật sau mỗi lần vẽ)
  const totRef = useRef<() => TotFxInput>(() => ({}));
  // gửi MỌI ô sửa được của dòng (QSĐT / QSTT sửa được toàn bộ bảng)
  // ô đơn giá (rates) của dòng chi phí thêm → chốt thành tiền (vals) theo TỔNG CỘNG hiện tại của cột; Trưởng phòng / Phó Tổng chỉ chốt cột D (theo cột Duyệt)
  const resolveExtras = (): ExtraRow[] =>
    (head.extras ?? []).map((x) => {
      const vals = { ...x.vals };
      for (const [k, raw] of Object.entries(x.rates ?? {})) {
        if (!raw.trim() || (rv && k !== "D")) continue;
        vals[k] = Math.round(extraAmt(x, k, calc0.totals[k === "D" && rv ? "R" : k]?.sum ?? 0));
        // cột theo hợp đồng gốc (PLHĐ điều chỉnh) tính theo cùng % / công thức: chốt luôn để phía server có số
        const hk = k === "A" ? "AH" : k === "B" ? "BH" : k === "D" ? "H" : "";
        if (hk && showHd && !(x.rates?.[hk] ?? "").trim()) vals[hk] = Math.round(extraAmt(x, hk, calc0.totals[hk]?.sum ?? 0));
      }
      return { ...x, vals };
    });
  const finPayload = (): SubFin => ({ prelimD: head.prelim.D ?? null, vatD: head.vat.D ?? null, extras: resolveExtras(), vatRows: head.vatRows ?? [], vtValue: head.vtValue ?? null, tbValue: head.tbValue ?? null, otherValue: head.otherValue ?? null, ...totRef.current() });
  // người dùng được nhập ô đơn giá / thành tiền các dòng dưới TỔNG CỘNG của cột c: QSĐT / QSTT mọi cột; Trưởng phòng / Phó Tổng cột Đề xuất (D)
  const canC = (c: string) => qs || (rv && (c === "D" || (!!dCol && c === dCol)));
  const payload = (over?: Partial<SubHead>): [SubHead, SubLineInput[]] => [
    { ...head, extras: resolveExtras(), ...totRef.current(), ...over },
    lines.map((l) => ({
      id: l.id, stt: l.stt, content: l.content, unit: l.unit, propQty: l.propQty, propPrice: l.propPrice, lineKey: l.lineKey, qsNote: l.qsNote, note: l.note, formulas: l.formulas,
      level: l.level, noMgmt: l.noMgmt, workName: oneName && l.workName.trim() ? l.content : l.workName, code: l.code, // cột hạng mục đang ẩn vì trùng nội dung → giữ trùng
      ...(mep ? { origin: l.origin, cdtVt: l.cdtVt, cdtNc: l.cdtNc, cdtKh: l.cdtKh } : {}),
      ...(ntm ? { material: l.material, dimL: l.dimL, dimW: l.dimW, dimH: l.dimH } : {}),
      dims: l.dims, baseVt: l.baseVt, baseNc: l.baseNc, baseTb: l.baseTb, propVt: l.propVt, propNc: l.propNc, propTb: l.propTb, hdQty: l.hdQty, hdPrice: l.hdPrice, cdtHdQty: l.cdtHdQty, cdtHdPrice: l.cdtHdPrice, baseHdQty: l.baseHdQty, baseHdPrice: l.baseHdPrice, cdtQty: l.cdtQty, cdtPrice: l.cdtPrice, baseQty: l.baseQty, basePrice: l.basePrice, baseManual: l.baseManual, baseNote: l.baseNote, bids: l.bids,
    })),
  ];
  const tpLines = (): SubTpLine[] => lines.filter((l) => l.level === "ITEM").map((l) => ({ id: l.id, tpPrice: l.tpPrice, tpOk: l.tpOk, tpNote: l.tpNote, formulas: l.formulas }));
  const scopeEdit = (qs && (!needInfo || part === "C")) || rv; // Trưởng phòng / Phó Tổng sửa trực tiếp được
  // lưu mục C nếu đã sửa; false = lỗi (đã báo)
  // Trưởng phòng / Quản trị: lưu thông tin đầu hồ sơ đã sửa (trước mọi thao tác lưu / duyệt khác); false = lỗi (đã báo)
  const saveHeadInfo = async () => {
    if (qs || !headEdit || !headDirty) return true;
    const r = await saveSubHeadInfoAction(id, head, cid ?? null);
    if (!r.ok) {
      window.alert(r.error);
      return false;
    }
    if (r.info) window.alert(r.info);
    setHeadDirty(false);
    return true;
  };
  const saveScope = async () => {
    if (!(await saveHeadInfo())) return false;
    if (!scopeDirty) return true;
    const r = await saveSubScopeAction(id, scopeRows);
    if (!r.ok) {
      window.alert(r.error);
      return false;
    }
    setScopeDirty(false);
    return true;
  };
  const done = (r: { ok: boolean; error?: string; info?: string }) => {
    if (!r.ok) return void window.alert(r.error);
    if (r.info) window.alert(r.info);
    setDirty(false);
    router.refresh();
  };
  // hoàn thành tác vụ (chuyển QSTT / trình / duyệt / phê duyệt): trong cửa sổ làm việc thì về màn hình chính kèm thông báo
  const finish = (r: { ok: boolean; error?: string; info?: string }, msg: string) => {
    if (!r.ok) return void window.alert(r.error);
    if (r.info) window.alert(r.info);
    setDirty(false);
    if (ws) ws.done(msg);
    else router.refresh();
  };
  // cửa sổ làm việc toàn màn hình: báo thay đổi chưa lưu + cách lưu nháp khi bấm "Về màn hình chính"
  const saveDraft = async () => {
    if (adjust) {
      window.alert("Hồ sơ đã duyệt không có bản nháp — bấm \"Lưu điều chỉnh\" để ghi giá mới (hoặc thoát để bỏ thay đổi).");
      return false;
    }
    if (!(await saveHeadInfo())) return false;
    const r = qs ? await saveSubDraftAction(id, ...payload()) : rv ? await tpSaveSubAction(id, note, tpLines(), head.terms.map((t) => t.appr), finPayload()) : { ok: true as const };
    if (!r.ok) {
      window.alert(r.error);
      return false;
    }
    setDirty(false);
    return true;
  };
  useEffect(() => {
    ws?.setGuard({ dirty, save: saveDraft });
  });
  useEffect(() => () => ws?.setGuard(null), [ws]);
  // đổi HỢP ĐỒNG: lưu đầu hồ sơ (kèm thay đổi) rồi gắn / bỏ hợp đồng (DT-CP) → tự khớp TH Thầu Phụ
  const changeContract = (cid: string, patch: Partial<SubHead>) =>
    start(async () => {
      const [h, ls] = payload();
      const r1 = await saveSubDraftAction(id, { ...h, ...patch }, ls);
      if (!r1.ok) return window.alert(r1.error);
      done(await setSubContractAction(id, cid || null));
    });
  const pickHd = (v: string) => {
    setHdSel(v);
    const c = contracts.find((x) => x.id === v);
    if (c) {
      const patch = { projectName: c.name, area: c.area || head.area, cdtContract: c.contractNo, ...(c.siteId ? { siteId: c.siteId } : {}) };
      setH(patch);
      if (!qs) return setCid(c.id); // Trưởng phòng / Quản trị: lưu khi bấm Lưu thông tin
      return changeContract(c.id, patch);
    }
    const patch = { cdtContract: v === "@khac" ? (isContractState(head.cdtContract) || cid ? "" : head.cdtContract) : v.startsWith("@") ? CONTRACT_STATES[Number(v.slice(1))] : "" };
    setH(patch);
    if (!qs) return setCid(null);
    if (contractId) changeContract("", patch);
  };

  // thêm / xoá dòng đề xuất (lưu khi bấm Lưu nháp / Chuyển / Trình)
  const blankLine = (): SubSheetLine => ({
    id: `new:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    level: "ITEM", stt: "", workName: "", content: "", code: "", origin: "", noMgmt: false, cdtVt: null, cdtNc: null, cdtKh: null, unit: "", dims: "", material: "", dimL: "", dimW: "", dimH: "", cdtQty: null, cdtPrice: null, baseQty: null, basePrice: null, baseVt: null, baseNc: null, baseTb: null, bids: {},
    propQty: null, propPrice: null, note: "", lineKey: "", qsNote: "", tpPrice: null, tpOk: true, tpNote: "", added: true, formulas: {}, baseManual: false, baseNote: "", propVt: null, propNc: null, propTb: null, hdQty: null, hdPrice: null, cdtHdQty: null, cdtHdPrice: null, baseHdQty: null, baseHdPrice: null,
  });
  // THUẾ BỔ SUNG (khi có 2 loại thuế, VD 8% nhân công + 10% vật tư): thêm dòng ngay dưới dòng VAT; ô nhập số hoặc công thức dùng TT = tổng cộng trước thuế của cột
  const addVatAfter = (afterId: string | null) => {
    const row: VatRow = { id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: "", vals: {} };
    setHead((h) => {
      const ex = h.vatRows ?? [];
      const at = afterId == null ? 0 : ex.findIndex((x) => x.id === afterId) + 1;
      return { ...h, vatRows: [...ex.slice(0, at), row, ...ex.slice(at)] };
    });
    setDirty(true);
  };
  const setVatRow = (vid: string, p: Partial<VatRow>) => {
    setHead((h) => ({ ...h, vatRows: (h.vatRows ?? []).map((x) => (x.id === vid ? { ...x, ...p } : x)) }));
    setDirty(true);
  };
  const setVatVal = (vid: string, col: string, v: string) => {
    setHead((h) => ({ ...h, vatRows: (h.vatRows ?? []).map((x) => (x.id === vid ? { ...x, vals: { ...x.vals, [col]: v } } : x)) }));
    setDirty(true);
  };
  const removeVat = (x: VatRow) => {
    if ((x.label || Object.values(x.vals).some((v) => v)) && !window.confirm(`Xoá dòng thuế "${x.label || "(chưa đặt tên)"}"?\n(Bấm Lưu nháp mới lưu.)`)) return;
    setHead((h) => ({ ...h, vatRows: (h.vatRows ?? []).filter((y) => y.id !== x.id) }));
    setDirty(true);
  };
  // dòng chi phí thêm dưới TỔNG CỘNG: thêm 1, 2, 3... dòng tuỳ ý (afterId = null → thêm ngay dưới TỔNG CỘNG)
  const addExtraAfter = (afterId: string | null) => {
    const row: ExtraRow = { id: `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, stt: "", label: "", vals: {} };
    setHead((h) => {
      const ex = h.extras ?? [];
      const at = afterId == null ? 0 : ex.findIndex((x) => x.id === afterId) + 1;
      return { ...h, extras: [...ex.slice(0, at), row, ...ex.slice(at)] };
    });
    setDirty(true);
  };
  const setExtra = (xid: string, p: Partial<ExtraRow>) => {
    setHead((h) => ({ ...h, extras: (h.extras ?? []).map((x) => (x.id === xid ? { ...x, ...p } : x)) }));
    setDirty(true);
  };
  const setExtraRate = (xid: string, col: string, v: string) => {
    setHead((h) => ({ ...h, extras: (h.extras ?? []).map((x) => (x.id === xid ? { ...x, rates: { ...(x.rates ?? {}), [col]: v } } : x)) }));
    setDirty(true);
  };
  const setExtraVal = (xid: string, col: string, v: number | null) => {
    setHead((h) => ({ ...h, extras: (h.extras ?? []).map((x) => (x.id === xid ? { ...x, vals: { ...x.vals, [col]: v } } : x)) }));
    setDirty(true);
  };
  const removeExtra = (x: ExtraRow) => {
    if ((x.label || Object.values(x.vals).some((v) => v)) && !window.confirm(`Xoá dòng "${x.label || "(chưa đặt tên)"}"?\n(Bấm Lưu nháp mới lưu.)`)) return;
    setHead((h) => ({ ...h, extras: (h.extras ?? []).filter((y) => y.id !== x.id) }));
    setDirty(true);
  };
  const addLineAfter = (idx: number) => {
    setLines((ls) => [...ls.slice(0, idx + 1), blankLine(), ...ls.slice(idx + 1)]);
    setDirty(true);
  };
  const removeLine = (l: SubSheetLine) => {
    if ((l.content || l.propQty != null) && !window.confirm(`Xoá dòng ${l.stt ? `${l.stt} ` : ""}"${l.content.slice(0, 60) || "(trống)"}" khỏi hồ sơ?\n(Bấm Lưu nháp mới lưu; chưa lưu thì tải lại trang là lấy lại được.)`)) return;
    setLines((ls) => ls.filter((x) => x.id !== l.id));
    setDirty(true);
  };
  // CHUỘT PHẢI (như Excel): chèn count dòng trống phía trên / phía dưới dòng anchor
  const insertLines = (anchor: string, where: "above" | "below", count: number) => {
    setLines((ls) => {
      const i = ls.findIndex((x) => x.id === anchor);
      if (i < 0) return ls;
      const at = where === "above" ? i : i + 1;
      return [...ls.slice(0, at), ...Array.from({ length: Math.max(1, count) }, blankLine), ...ls.slice(at)];
    });
    setDirty(true);
  };
  // CHUỘT PHẢI "Xoá dòng": xoá các dòng đang chọn (như menu ▾: dòng đầu mục không xoá thẳng — đổi thành dòng công tác trước rồi mới xoá)
  const removeLines = (rowIds: string[]) => {
    const picked = lines.filter((l) => rowIds.includes(l.id));
    if (!picked.length) return;
    // dòng do người dùng TỰ THÊM (added) thì xoá được kể cả khi đã đặt thành đầu mục
    const items = picked.filter((l) => (l.level !== "GROUP" && l.level !== "SUB") || l.added); // dòng công tác, sản phẩm / phần việc nội thất
    const heads = picked.length - items.length;
    if (!items.length) return window.alert("Dòng đầu mục không xoá trực tiếp được — bấm nút ▾ ở ô STT, đặt cấp thành \"Dòng công tác\" rồi mới xoá.");
    if (items.length === 1 && !heads) return removeLine(items[0]);
    const note = heads ? `\n(Bỏ qua ${heads} dòng đầu mục — đầu mục không xoá trực tiếp.)` : "";
    if (!window.confirm(`Xoá ${items.length} dòng khỏi hồ sơ?${note}\n(Bấm Lưu nháp mới lưu; chưa lưu thì tải lại trang là lấy lại được.)`)) return;
    const ids = new Set(items.map((l) => l.id));
    setLines((ls) => ls.filter((x) => !ids.has(x.id)));
    setDirty(true);
  };
  // phân cấp dòng: SUB = đầu mục cấp 1 (I, II...), GROUP = đầu mục cấp 2 (A, B...), ITEM = dòng công tác. Đầu mục không tính tiền riêng, chỉ hiện tổng các dòng bên dưới
  const LEVELS: { v: string; t: string; label: string; tip: string }[] = [
    { v: "SUB", t: "Ⅰ", label: "Đầu mục cấp 1 (I, II…)", tip: "Tổng gồm cả các đầu mục cấp 2 bên dưới" },
    { v: "GROUP", t: "Ａ", label: "Đầu mục cấp 2 (A, B…)", tip: "Đầu mục thuộc cấp 1" },
    ...(ntm
      ? [
          { v: "SP", t: "▣", label: "Sản phẩm (gồm các phần việc bên dưới)", tip: "VD Bàn làm việc: các dòng bên dưới là phần việc (khung, mặt đá, kính...). Dòng sản phẩm cộng đủ các phần việc để so với giá CĐT" },
          { v: "ITEM", t: "✔", label: "Phần việc trình lần này", tip: "Dòng công tác trình duyệt ở hồ sơ này (tính tiền, duyệt, vào sổ giá)" },
          { v: "REF", t: "○", label: "Phần việc khác — không trình lần này", tip: "Chỉ để tham khảo giá trị cả sản phẩm: không cộng tổng, không duyệt. Đã duyệt ở hồ sơ khác thì tự lấy giá duyệt; chưa thì nhập giá dự kiến ở khối đề xuất" },
        ]
      : [{ v: "ITEM", t: "─", label: "Dòng công tác", tip: "Dòng công tác bình thường (có khối lượng, đơn giá)" }]),
  ];
  // nút ▾ hiện khi rê chuột vào ô STT → bấm để sổ danh sách chức năng của dòng (menu cố định theo màn hình nên không bị bảng che)
  const [rowMenu, setRowMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const rowTools = (l: SubSheetLine, idx: number) => {
    if (!qs) return false;
    const open = rowMenu?.id === l.id;
    const act = (fn: () => void) => () => {
      setRowMenu(null);
      fn();
    };
    const item = "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-100";
    return (
      <span className={`absolute right-0 top-0 z-20 ${open ? "flex" : "hidden group-hover:flex"}`}>
        <button
          type="button"
          title="Chức năng của dòng: thêm dòng, đặt cấp đầu mục, xoá"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setRowMenu(open ? null : { id: l.id, x: r.left, y: r.bottom + 2 });
          }}
          className="rounded bg-white px-1.5 py-0.5 text-[12px] font-bold leading-none text-slate-700 shadow ring-1 ring-slate-400 hover:bg-amber-100"
        >
          ▾
        </button>
        {open && rowMenu && createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setRowMenu(null)} />
            <div className="fixed z-[75] w-60 rounded-md bg-white py-1 text-[13px] font-normal text-slate-800 shadow-xl ring-1 ring-slate-300" style={{ left: Math.max(4, Math.min(rowMenu.x, window.innerWidth - 248)), top: Math.max(4, Math.min(rowMenu.y, window.innerHeight - 230)) }}>
              <button type="button" className={`${item} text-emerald-700`} onClick={act(() => addLineAfter(idx))}>
                <b className="w-4 text-center">＋</b> Thêm dòng mới bên dưới
              </button>
              <button type="button" title="Chi phí quản lý (Prelim) chỉ tính trên phần còn lại, không tính trên dòng này (đầu mục: cả các dòng bên dưới)" className={`${item} ${l.noMgmt ? "bg-orange-100 font-semibold" : ""}`} onClick={act(() => setL(l.id, { noMgmt: !l.noMgmt }))}>
                <b className="w-4 text-center text-orange-700">{l.noMgmt ? "☑" : "☐"}</b> Không tính chi phí quản lý{l.level !== "ITEM" ? " (cả nhóm)" : ""}
              </button>
              <div className="my-1 border-t border-slate-200 px-3 pt-1 text-[11px] font-semibold uppercase text-slate-400">Đặt cấp dòng này</div>
              {LEVELS.map((o) => (
                <button key={o.v} type="button" title={o.tip} className={`${item} ${l.level === o.v ? "bg-amber-100 font-semibold" : ""}`} onClick={act(() => l.level !== o.v && setL(l.id, { level: o.v }))}>
                  <b className="w-4 text-center text-amber-700">{o.t}</b> {o.label}
                  {l.level === o.v && <span className="ml-auto text-emerald-700">✓</span>}
                </button>
              ))}
              {((l.level !== "GROUP" && l.level !== "SUB") || l.added) && (
                <>
                  <div className="my-1 border-t border-slate-200" />
                  <button type="button" className={`${item} text-red-600 hover:bg-red-50`} onClick={act(() => removeLine(l))}>
                    <b className="w-4 text-center">✕</b> Xoá dòng này
                  </button>
                </>
              )}
            </div>
          </>,
          document.body,
        )}
      </span>
    );
  };

  // dán vùng từ Excel
  const pasteGrid = (cells: GridPaste[]) => {
    setLines((ls) =>
      ls.map((l) => {
        const cs = cells.filter((c) => c.row === l.id);
        if (!cs.length) return l;
        let p = { ...l, formulas: { ...l.formulas } } as SubSheetLine;
        for (const c of cs) {
          if (!canEdit(l, c.col)) continue; // ô không sửa được (thành tiền, dòng đầu mục...) → bỏ qua
          if (isNumCol(c.col)) p = { ...p, ...numPatch(p, c.col, c.num) }; // dán số đè lên ô có công thức → bỏ công thức
          else p = { ...p, [c.col]: c.text } as SubSheetLine;
        }
        return p;
      }),
    );
    setDirty(true);
  };

  // ---- Công thức kiểu Excel + Ctrl+Z (src/lib/xl-formula.ts, ../../../xl/useXl.ts, ExcelGrid prop xl) ----
  // Chữ cột A, B, C... = thứ tự cột của bảng; số dòng = thứ tự dòng (1, 2, 3...)
  const xlCols = useMemo(
    () => [
      ...leadCols, ...(oneQ ? ["cdtQty"] : []),
      ...(showHd ? ["cdtHdQty", "cdtQty", "cdtHdPrice", "cdtPrice", "cdtHdAmount", "cdtAmount", "cdtPlAmount"] : ["cdtQty", ...(cdtComp ? ["cdtVt", "cdtNc", ...(mepT ? ["cdtKh"] : [])] : []), "cdtPrice", "cdtAmount"]),
      ...(showHd ? ["baseHdQty", "baseQty", "baseHdPrice", ...baseC, "basePrice", "baseHdAmount", "baseAmount", "basePlAmount"] : ["baseQty", ...baseC, "basePrice", "baseAmount"]), "baseNote",
      ...bidders.flatMap((b) => (showCt ? [`bq:${b.key}`, `bv:${b.key}`, `bn:${b.key}`, ...(noTb ? [] : [`bt:${b.key}`]), `bp:${b.key}`, `ba:${b.key}`] : [`bq:${b.key}`, `bp:${b.key}`, `ba:${b.key}`])),
      // khối ĐỀ XUẤT (D): QSĐT/QSTT nhập giá trình; Trưởng phòng / Phó Tổng SỬA TRỰC TIẾP trên giá trình (lưu tpPrice), không có cột Duyệt riêng
      ...(showHd ? ["hdQty", "propQty", "hdPrice", ...propC, qs ? "propPrice" : "tpPrice", "hdAmount", qs ? "propAmount" : "apprAmount", "plAmount"] : hideD ? [] : ["propQty", ...propC, qs ? "propPrice" : "tpPrice", qs ? "propAmount" : "apprAmount"]), ...(multiAward ? ["sTotal"] : []), "note", "qsNote", "tpNote",
    ]
      .map((k) => (apprCol && k === `bp:${apprCol}` ? "tpPrice" : apprCol && k === `ba:${apprCol}` ? "apprAmount" : k)) // cột thầu phụ được duyệt = ô giá duyệt / thành tiền duyệt
      .filter((k, i, arr) => !oneQ || !(k === "baseQty" || k === "propQty" || k.startsWith("bq:") || (k === "cdtQty" && arr.indexOf(k) !== i))), // dùng chung 1 KL: chỉ 1 cột KL
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bidders, qs, showHd, showCt, mep, ntm, cdtComp, baseC, propC, hideD, multiAward, apprCol, oneQ],
  );
  const valueOf = useCallback(
    (l: SubSheetLine, col: string, i: number): number | string | null => {
      // phần việc khác (REF, nội thất): KL / đơn giá đọc được, ô thành tiền rỗng để các tổng (SUBTOTAL) không cộng
      if (l.level === "REF" && (/Amount$/.test(col) || col.startsWith("ba:") || col === "sTotal")) return null;
      const item = isPartLevel(l.level);
      const g = item ? null : calc0.group[i];
      if (col.startsWith("bv:")) return item ? (l.bids[col.slice(3)]?.vt ?? null) : null;
      if (col.startsWith("bn:")) return item ? (l.bids[col.slice(3)]?.nc ?? null) : null;
      if (col.startsWith("bt:")) return item ? (l.bids[col.slice(3)]?.tb ?? null) : null;
      if (col.startsWith("bq:")) return item ? (l.bids[col.slice(3)]?.qty ?? null) : null;
      if (col.startsWith("bp:")) return item ? (l.bids[col.slice(3)]?.price ?? null) : null;
      if (col.startsWith("ba:")) return item ? amt(l.bids[col.slice(3)]?.qty ?? null, l.bids[col.slice(3)]?.price ?? null) : (g?.[col.slice(3)] ?? null);
      switch (col) {
        case "sTotal":
          return item ? sAmt(l) : (g?.S ?? null);
        case "cdtAmount":
          return item ? amt(l.cdtQty, l.cdtPrice) : (g?.A ?? null);
        case "basePrice":
          return item ? baseOf(l) : null;
        case "baseAmount":
          return item ? amt(l.baseQty, baseOf(l)) : (g?.B ?? null);
        case "propQty":
          return item ? propQtyOf(l, sel) : null;
        case "propPrice":
          return item ? propPriceOf(l, sel) : null;
        case "propAmount":
          return item ? amt(propQtyOf(l, sel), propPriceOf(l, sel)) : (g?.D ?? null);
        case "tpPrice":
          return item ? apprPriceOf(l, sel) : null;
        case "apprAmount":
          return item ? amt(propQtyOf(l, sel), apprPriceOf(l, sel)) : (g?.R ?? null);
        case "tpOk":
          return item ? (l.tpOk ? "✓" : "✕") : "";
        case "cdtHdAmount":
          return item ? amt(l.cdtHdQty, l.cdtHdPrice) : (g?.AH ?? null);
        case "cdtPlAmount":
          return item ? (amt(l.cdtQty, l.cdtPrice) ?? 0) - (amt(l.cdtHdQty, l.cdtHdPrice) ?? 0) : g ? (g.A ?? 0) - (g.AH ?? 0) : null;
        case "baseHdAmount":
          return item ? amt(l.baseHdQty, l.baseHdPrice) : (g?.BH ?? null);
        case "basePlAmount":
          return item ? (amt(l.baseQty, baseOf(l)) ?? 0) - (amt(l.baseHdQty, l.baseHdPrice) ?? 0) : g ? (g.B ?? 0) - (g.BH ?? 0) : null;
        case "hdAmount":
          return item ? amt(l.hdQty, l.hdPrice) : (g?.H ?? null);
        case "plAmount":
          return item ? (amt(propQtyOf(l, sel), qs ? propPriceOf(l, sel) : apprPriceOf(l, sel)) ?? 0) - (amt(l.hdQty, l.hdPrice) ?? 0) : g ? (g[qs ? "D" : "R"] ?? 0) - (g.H ?? 0) : null;
        case "baseNote":
          return l.baseNote;
        default: {
          const v = (l as unknown as Record<string, unknown>)[col];
          return typeof v === "number" || typeof v === "string" ? v : null;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calc0, sel, refMap],
  );
  const hist = useUndo(
    useMemo(() => ({ head, lines }), [head, lines]),
    useCallback((s: { head: SubHead; lines: SubSheetLine[] }) => {
      setHead(s.head);
      setLines(s.lines);
      setDirty(true);
    }, []),
  );
  // ô số nằm trong bids (giá từng thầu phụ) / ô cơ sở: đọc giá trị đang lưu + ghi kết quả công thức vào đúng chỗ
  const xlRead = useCallback((l: SubSheetLine, col: string): unknown => {
    const m = col.match(/^b([qpvnt]):(.+)$/);
    if (m) return l.bids[m[2]]?.[BID_F[m[1] as keyof typeof BID_F]];
    return (l as unknown as Record<string, unknown>)[col];
  }, []);
  const xlApply = useCallback((l: SubSheetLine, patch: Record<string, number | null>): SubSheetLine => {
    let n = { ...l };
    for (const [col, v] of Object.entries(patch)) {
      const m = col.match(/^b([qpvnt]):(.+)$/);
      if (m) {
        const k = m[2];
        const f = BID_F[m[1] as keyof typeof BID_F];
        const cur: Bid = { qty: n.bids[k]?.qty ?? null, price: n.bids[k]?.price ?? null, vt: n.bids[k]?.vt ?? null, nc: n.bids[k]?.nc ?? null, tb: n.bids[k]?.tb ?? null };
        cur[f] = v;
        if (f === "vt" || f === "nc" || f === "tb") {
          const s = cs(cur.vt, cur.nc, cur.tb);
          if (s != null) cur.price = s;
        }
        n = { ...n, bids: { ...n.bids, [k]: cur } };
      } else {
        n = { ...n, [col]: v, ...(col === "basePrice" ? { baseManual: true } : {}) } as SubSheetLine;
        if (col === "propVt" || col === "propNc" || col === "propTb") {
          const s = cs(n.propVt, n.propNc, n.propTb);
          if (s != null) n = { ...n, propPrice: s };
        }
        if (oneQ && col === "cdtQty") n = { ...n, ...shareQtyPatch(n, v) };
        if (col === "cdtVt" || col === "cdtNc" || col === "cdtKh") {
          const s = cs(n.cdtVt, n.cdtNc, n.cdtKh);
          if (s != null) n = { ...n, cdtPrice: s };
        }
        if (col === "baseVt" || col === "baseNc" || col === "baseTb") {
          const s = cs(n.baseVt, n.baseNc, n.baseTb);
          if (s != null) n = { ...n, basePrice: s, baseManual: true };
        }
      }
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mepT, oneQ]);
  const xf = useXlFormulas({ lines, setLines, cols: xlCols, valueOf, silent: hist.silent, read: xlRead, apply: xlApply });
  // cột số (nhập được số / công thức) và cột chữ — QSĐT / QSTT sửa được TOÀN BỘ ô của dòng, kể cả khối CĐT, cơ sở (DT-CP), từng thầu phụ
  const QS_NUM = ["cdtVt", "cdtNc", "cdtKh", "baseVt", "baseNc", "baseTb", "propVt", "propNc", "propTb", "hdQty", "hdPrice", "cdtHdQty", "cdtHdPrice", "baseHdQty", "baseHdPrice", "cdtQty", "cdtPrice", "baseQty", "basePrice", "propQty", "propPrice"];
  // các cột nhập được (theo thứ tự trên bảng) — để di chuyển / dán vùng / chọn ô như Excel
  const gridCols = useMemo(
    () => [...leadCols.filter((k) => k !== "img"), ...(oneQ ? ["cdtQty"] : []), ...(showHd ? ["cdtHdQty", "cdtQty", "cdtHdPrice", "cdtPrice", "baseHdQty", "baseQty", "baseHdPrice", ...baseC, "basePrice"] : ["cdtQty", ...(cdtComp ? ["cdtVt", "cdtNc", ...(mepT ? ["cdtKh"] : [])] : []), "cdtPrice", "baseQty", ...baseC, "basePrice"]), "baseNote", ...bidders.flatMap((b) => (showCt ? [`bq:${b.key}`, `bv:${b.key}`, `bn:${b.key}`, ...(noTb ? [] : [`bt:${b.key}`]), `bp:${b.key}`] : [`bq:${b.key}`, `bp:${b.key}`])), ...(showHd ? ["hdQty", "propQty", "hdPrice", ...propC, "propPrice"] : hideD ? [] : ["propQty", ...propC, "propPrice"]), "note", "qsNote"].filter((k, i, arr) => !oneQ || !(k === "baseQty" || k === "propQty" || k.startsWith("bq:") || (k === "cdtQty" && arr.indexOf(k) !== i))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bidders, showHd, showCt, mep, ntm, cdtComp, baseC, propC, hideD, oneQ],
  );
  const isNumCol = (col: string) => QS_NUM.includes(col) || col === "tpPrice" || /^b[qpvnt]:/.test(col);
  const numPatch = (l: SubSheetLine, col: string, v: number | null): Partial<SubSheetLine> => {
    // dùng chung 1 KL: sửa ô KL = đổi KL chủ đầu tư, cơ sở, mọi thầu phụ (và đề xuất nếu đang có số)
    if (oneQ && col === "cdtQty") return { ...shareQtyPatch(l, v), formulas: xf.clearFormula(l, col) };
    const bm = col.match(/^b([qpvnt]):(.+)$/);
    if (bm) {
      const k = bm[2];
      const f = BID_F[bm[1] as keyof typeof BID_F];
      const cur: Bid = { qty: l.bids[k]?.qty ?? null, price: l.bids[k]?.price ?? null, vt: l.bids[k]?.vt ?? null, nc: l.bids[k]?.nc ?? null, tb: l.bids[k]?.tb ?? null };
      const formulas = { ...l.formulas };
      delete formulas[col];
      if (f === "vt" || f === "nc" || f === "tb") {
        // giá chi tiết: đơn giá tổng = vật tư + nhân công + thiết bị (thành phần 0 vẫn hợp lệ)
        cur[f] = v;
        const s = cs(cur.vt, cur.nc, cur.tb);
        if (s != null) {
          cur.price = s;
          delete formulas[`bp:${k}`];
        }
      } else if (f === "price") {
        // gõ thẳng đơn giá tổng → bỏ phần chi tiết
        cur.price = v;
        cur.vt = null;
        cur.nc = null;
        cur.tb = null;
      } else cur.qty = v;
      return { bids: { ...l.bids, [k]: cur }, formulas };
    }
    if (col === "baseVt" || col === "baseNc" || col === "baseTb") {
      const nx = { ...l, [col]: v };
      const s = cs(nx.baseVt, nx.baseNc, nx.baseTb);
      const formulas = { ...l.formulas };
      delete formulas[col];
      if (s != null) delete formulas.basePrice;
      return { [col]: v, ...(s != null ? { basePrice: s, baseManual: true } : {}), formulas } as Partial<SubSheetLine>;
    }
    if (col === "cdtVt" || col === "cdtNc" || col === "cdtKh") {
      const nx = { ...l, [col]: v };
      const s = cs(nx.cdtVt, nx.cdtNc, nx.cdtKh);
      const formulas = { ...l.formulas };
      delete formulas[col];
      if (s != null) delete formulas.cdtPrice;
      return { [col]: v, ...(s != null ? { cdtPrice: s } : {}), formulas } as Partial<SubSheetLine>;
    }
    if (col === "propVt" || col === "propNc" || col === "propTb") {
      const nx = { ...l, [col]: v };
      const s = cs(nx.propVt, nx.propNc, nx.propTb);
      const formulas = { ...l.formulas };
      delete formulas[col];
      if (s != null) delete formulas.propPrice;
      return { [col]: v, ...(s != null ? { propPrice: s } : {}), formulas } as Partial<SubSheetLine>;
    }
    const formulas = xf.clearFormula(l, col);
    if (col === "propPrice") return { propPrice: v, propVt: null, propNc: null, propTb: null, formulas };
    if (col === "cdtPrice") return { cdtPrice: v, cdtVt: null, cdtNc: null, cdtKh: null, formulas };
    // sửa ĐƠN GIÁ CƠ SỞ: dùng giá đã nhập thay giá DT-CP tự khớp; xoá trống = quay về giá DT-CP
    if (col === "basePrice") return { basePrice: v, baseManual: v != null, baseVt: null, baseNc: null, baseTb: null, formulas };
    return { [col]: v, formulas } as Partial<SubSheetLine>;
  };
  const NT_TXT = ["material", "dimL", "dimW", "dimH"];
  const canEdit = (l: SubSheetLine, col: string) => {
    if (rv) return ["tpPrice", "tpNote"].includes(col) && l.level === "ITEM";
    if (!qs) return false;
    if (["stt", "workName", "content"].includes(col)) return true; // đầu mục (A, I...) cũng sửa được
    // dòng SẢN PHẨM (nội thất): thông tin sản phẩm + giá CĐT của cả sản phẩm (để so với tổng các phần việc)
    if (l.level === "SP") return ["code", "unit", "qsNote", "cdtQty", "cdtPrice", ...NT_TXT].includes(col);
    if (!isPartLevel(l.level)) return false;
    return ["code", "origin", "unit", "baseNote", "note", "qsNote", ...NT_TXT].includes(col) || QS_NUM.includes(col) || /^b[qpvnt]:/.test(col);
  };
  // ---- CÁC DÒNG TỔNG DƯỚI BẢNG (TỔNG CỘNG, chi phí thêm, PRELIM, VAT, thuế bổ sung, SAU VAT, vật tư / thiết bị, chênh lệch, tỷ lệ) cũng là ô như Excel:
  // có địa chỉ (dòng nối tiếp sau dòng cuối của bảng), bấm vào xem công thức + tô viền các ô tham chiếu, F2 hiện lại ----
  const blocks = [...blockKeys, ...(multiAward ? ["S"] : [])];
  const amtKey = (c: string) => (c === "S" ? "sTotal" : c === apprCol ? "apprAmount" : c === "A" ? "cdtAmount" : c === "B" ? "baseAmount" : c === "D" ? (qs ? "propAmount" : "apprAmount") : `ba:${c}`);
  const rateKey = (c: string) => (c === "S" ? (qs ? "propPrice" : "tpPrice") : c === apprCol ? "tpPrice" : c === "A" ? "cdtPrice" : c === "B" ? "basePrice" : c === "D" ? (qs ? "propPrice" : "tpPrice") : `bp:${c}`);
  const hdKey = (c: string) => (c === "A" ? "cdtHdAmount" : c === "B" ? "baseHdAmount" : "hdAmount");
  const plKey = (c: string) => (c === "A" ? "cdtPlAmount" : c === "B" ? "basePlAmount" : "plAmount");
  // khoá ô cho FragTd / FragTotal của dòng ảo `row` ở khối `c`
  const vx = (row: string, c: string) => ({ row, rate: rateKey(c), amt: amtKey(c), hd: hdKey(c), pl: plKey(c) });
  const vNum = (n: unknown) => Number(n) || 0;
  const vIds = useMemo(
    () => [
      "v:sum",
      ...(head.extras ?? []).map((x) => `v:x:${x.id}`),
      "v:prelim",
      "v:beforeVat",
      "v:vat",
      ...(head.vatRows ?? []).map((x) => `v:t:${x.id}`),
      "v:afterVat",
      ...((Number(head.vtValue) || 0) > 0 ? ["v:vt"] : []),
      ...((Number(head.tbValue) || 0) > 0 ? ["v:tb"] : []),
      ...((Number(head.otherValue) || 0) > 0 ? ["v:other"] : []),
      "v:diff",
      "v:ratio",
    ],
    [head.extras, head.vatRows, head.vtValue, head.tbValue, head.otherValue],
  );
  // khối 7 cột chỉ áp cho CĐT (A), cơ sở (B), đề xuất (D) khi là PLHĐ điều chỉnh
  const wideCol = (c: string) => showHd && (c === "A" || c === "B" || c === "D");
  // cột theo HỢP ĐỒNG gốc tương ứng của khối A / B / D (PLHĐ điều chỉnh)
  const hdKeyOf = (c: string) => (c === "A" ? "AH" : c === "B" ? "BH" : "H");
  const vAddr = (id: string, col: string) => {
    const r = vIds.indexOf(id);
    const c = xlCols.indexOf(col);
    return r < 0 || c < 0 ? "" : `${colLetter(c)}${lines.length + r + 1}`;
  };
  const vBlockOf = (col: string) => blocks.find((c) => amtKey(c) === col || rateKey(c) === col || (wideCol(c) && (hdKey(c) === col || plKey(c) === col)));
  // tiền công thức của dòng ảo: trả "" nếu ô không có công thức
  const virtRaw = (id: string, col: string): string => {
    const c = vBlockOf(col);
    if (!c) return "";
    // PLHĐ điều chỉnh: TT PHỤ LỤC = TT điều chỉnh − TT hợp đồng (ở mọi dòng tổng)
    if (wideCol(c) && col === plKey(c)) return id === "v:ratio" ? "" : `=${vAddr(id, amtKey(c))}-${vAddr(id, hdKey(c))}`;
    const isHd = wideCol(c) && col === hdKey(c); // TT HỢP ĐỒNG: cùng cách tính, theo cột hợp đồng
    const amK = isHd ? hdKey(c) : amtKey(c);
    const isAmt = amK === col;
    const am = (rid: string) => vAddr(rid, amK);
    const rt = (rid: string) => vAddr(rid, rateKey(c));
    const sumA = am("v:sum");
    const tk = isHd ? hdKeyOf(c) : tkOf(c);
    const exempt = Math.round(calc0.exempt[tk] ?? 0);
    const exs = (head.extras ?? []).map((x) => am(`v:x:${x.id}`));
    const vts = (head.vatRows ?? []).map((x) => am(`v:t:${x.id}`));
    const rawOf = (s: string | undefined, ttAddr: string) => {
      const t = (s ?? "").trim();
      if (!t) return "";
      if (t.startsWith("=")) return `=${t.slice(1).replace(/\bTT\b/gi, ttAddr)}`;
      if (t.endsWith("%")) return `=${ttAddr}*${t}`;
      return t;
    };
    const ck = c === "S" || c === dCol ? "D" : c; // cột S (tổng duyệt) dùng % / thuế / chi phí thêm của cột D
    const pct = (rec: Record<string, number>) => (rec[ck] != null ? String(rec[ck]) : "");
    if (id === "v:sum") return isAmt && lines.length ? `=SUBTOTAL(9;${xf.addr(lines[0].id, col)}:${xf.addr(lines[lines.length - 1].id, col)})` : "";
    if (id === "v:prelim") return isAmt ? `=${exempt > 0 ? `(${sumA}-${exempt})` : sumA}*${rt("v:prelim")}/100` : pct(head.prelim);
    if (id === "v:beforeVat") return isAmt ? `=${[sumA, ...(exs.length ? [`SUBTOTAL(9;${exs[0]}:${exs[exs.length - 1]})`] : []), am("v:prelim")].join("+")}` : "";
    if (id === "v:vat") return isAmt ? `=${am("v:beforeVat")}*${rt("v:vat")}/100` : pct(head.vat);
    if (id === "v:afterVat") return isAmt ? `=${[am("v:beforeVat"), am("v:vat"), ...(vts.length ? [`SUBTOTAL(9;${vts[0]}:${vts[vts.length - 1]})`] : [])].join("+")}` : "";
    if (id === "v:vt" || id === "v:tb" || id === "v:other") return isAmt && c !== "A" ? String(vNum(id === "v:vt" ? head.vtValue : id === "v:tb" ? head.tbValue : head.otherValue)) : "";
    if (id === "v:diff") {
      if (!isAmt || c === "A") return "";
      return `=${vAddr("v:afterVat", isHd ? hdKey("A") : amtKey("A"))}-${am("v:afterVat")}${["v:vt", "v:tb", "v:other"].filter((k) => vIds.includes(k)).map((k) => `-${am(k)}`).join("")}`;
    }
    if (id === "v:ratio") {
      if (!isAmt || c === "A") return "";
      const a = vAddr("v:afterVat", amtKey("A"));
      return `=IF(${a}=0;0;${am("v:diff")}/${a})`;
    }
    if (id.startsWith("v:x:")) {
      const x = (head.extras ?? []).find((e) => `v:x:${e.id}` === id);
      if (!x) return "";
      if (!isAmt) return (x.rates?.[ck] ?? "").trim();
      if (isHd) return rawOf(x.rates?.[hdKeyOf(c)] || (hdInherited(x, c) ? x.rates?.[ck] : ""), sumA) || (x.vals[hdKeyOf(c)] != null ? String(x.vals[hdKeyOf(c)]) : "");
      return rawOf(x.rates?.[ck], sumA) || (x.vals[ck] != null ? String(x.vals[ck]) : "");
    }
    if (id.startsWith("v:t:")) {
      const x = (head.vatRows ?? []).find((e) => `v:t:${e.id}` === id);
      if (!x) return "";
      if (!isAmt) return (x.vals[ck] ?? "").trim();
      return rawOf(x.vals[ck], am("v:beforeVat"));
    }
    return "";
  };
  // giá trị hiện của ô dòng ảo (để Ctrl+C ra số)
  const virtText = (id: string, col: string): string => {
    const tk = calc.colTk.get(col);
    if (!tk) return virtRaw(id, col); // ô % / đơn giá
    if (id === "v:ratio") return "";
    const v = vValue(calc.totals, calc.diff, id, tk);
    return v == null ? "" : Math.round(v).toLocaleString("vi-VN");
  };
  // giá trị ô thành tiền của dòng tổng `id` ở tổng cột `tk`
  const vValue = (tot: Record<string, ChainTotals>, diff: Record<string, number>, id: string, tk: string): number | null => {
    const t = tot[tk];
    if (!t) return null;
    switch (id) {
      case "v:sum":
        return t.sum;
      case "v:prelim":
        return t.prelim;
      case "v:beforeVat":
        return t.beforeVat;
      case "v:vat":
        return t.vat;
      case "v:afterVat":
        return t.afterVat;
      case "v:vt":
        return tk === "A" ? null : vNum(head.vtValue);
      case "v:tb":
        return tk === "A" ? null : vNum(head.tbValue);
      case "v:other":
        return tk === "A" ? null : vNum(head.otherValue);
      case "v:diff":
        return tk === "A" || !tot.A ? null : (diff[tk] ?? tot.A.afterVat - t.afterVat - (vNum(head.vtValue) + vNum(head.tbValue) + vNum(head.otherValue)));
    }
    if (id.startsWith("v:x:")) return t.x[id.slice(4)] ?? null;
    if (id.startsWith("v:t:")) return t.t[id.slice(4)] ?? null;
    return null;
  };
  // CÔNG THỨC TỰ TÍNH của các ô thành tiền (không ai sửa tay) viết ra dạng Excel để QSĐT / QSTT / Trưởng phòng bấm vào là kiểm tra được:
  // dòng công việc = KL × đơn giá, dòng đầu mục = SUBTOTAL(9; các dòng con) — ExcelGrid tô viền các ô được tham chiếu
  const isAmtCol = (col: string) => /Amount$/.test(col) || col.startsWith("ba:") || col === "sTotal";
  const autoFormula = (l: SubSheetLine, col: string): string => {
    if (!isAmtCol(col)) return "";
    const i = lines.findIndex((x) => x.id === l.id);
    if (i < 0) return "";
    const A = (idx: number, c: string) => xf.addr(lines[idx].id, c);
    if (l.level === "REF") return ""; // phần việc khác (nội thất): không tính thành tiền vào tổng
    if (l.level !== "ITEM") {
      let last = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const lj = lines[j];
        if (lj.level === "SUB" || (l.level === "GROUP" && lj.level === "GROUP") || (l.level === "SP" && !isPartLevel(lj.level))) break; // cấp 1 gồm cả các cấp 2 bên dưới
        last = j;
      }
      return last > i ? `=SUBTOTAL(9;${A(i + 1, col)}:${A(last, col)})` : "";
    }
    const qk = (q: string) => (oneQ && (q === "baseQty" || q === "propQty" || q.startsWith("bq:")) ? "cdtQty" : q); // dùng chung 1 KL
    const mul = (q0: string, p: string) => {
      const q = qk(q0);
      return xlCols.includes(q) && xlCols.includes(p) ? `=${A(i, q)}*${A(i, p)}` : "";
    };
    const sub = (a: string, b: string) => (xlCols.includes(a) && xlCols.includes(b) ? `=${A(i, a)}-${A(i, b)}` : "");
    // KL / đơn giá đề xuất: đúng cột đang cho ra số (KL đề xuất trống thì lấy KL thầu phụ được chọn / cơ sở / CĐT; đơn giá duyệt = giá TP sửa hoặc giá đề xuất)
    const dQty = l.propQty != null ? "propQty" : l.bids[sel]?.qty != null ? `bq:${sel}` : l.baseQty != null ? "baseQty" : "cdtQty";
    const dPrice = l.propPrice != null ? "propPrice" : `bp:${sel}`;
    switch (col) {
      case "cdtAmount": return mul("cdtQty", "cdtPrice");
      case "cdtHdAmount": return mul("cdtHdQty", "cdtHdPrice");
      case "cdtPlAmount": return sub("cdtAmount", "cdtHdAmount");
      case "baseAmount": return mul("baseQty", "basePrice");
      case "baseHdAmount": return mul("baseHdQty", "baseHdPrice");
      case "basePlAmount": return sub("baseAmount", "baseHdAmount");
      case "hdAmount": return mul("hdQty", "hdPrice");
      case "propAmount": return mul(dQty, dPrice);
      case "apprAmount": return !l.tpOk ? "" : mul(dQty, apprCol || l.tpPrice != null ? "tpPrice" : dPrice);
      case "plAmount": return sub(qs ? "propAmount" : "apprAmount", "hdAmount");
      case "sTotal": return awards.map((a) => `${a.pct}%*${A(i, `bq:${a.key}`)}*${A(i, `bp:${a.key}`)}`).join("+").replace(/^/, "=");
      default: return col.startsWith("ba:") ? mul(`bq:${col.slice(3)}`, `bp:${col.slice(3)}`) : "";
    }
  };

  // ---- CÔNG THỨC Ở CÁC DÒNG TỪ TỔNG CỘNG TRỞ XUỐNG (anh yêu cầu 21/11/2026 — để làm tròn như Excel: ROUND / ROUNDUP / ROUNDDOWN...) ----
  // Ô THÀNH TIỀN của dòng TỔNG CỘNG, chi phí thêm, PRELIM, TRƯỚC VAT, VAT, thuế bổ sung, SAU VAT, CHÊNH LỆCH gõ "=" như Excel, tham chiếu
  // được mọi ô (kể cả ô dòng tổng khác), VD =ROUND(M121*6%;0). Dòng bên dưới tự tính tiếp theo số đó; xoá trống = về lại số tự tính.
  // head.totalFormulas: khoá "<dòng>|<tổng cột>" (A, B, C1.., D, H, AH, BH, S — cột duyệt R dùng chung công thức của D, như % Prelim / VAT);
  // công thức lưu dạng ổn định [[mãDòng|cột]] (thêm / xoá dòng không lệch), cột theo màn hình QSĐT / QSTT (cột đề xuất) —
  // Trưởng phòng / Phó Tổng xem cột duyệt (apprAmount / tpPrice) nên đổi qua lại khi hiện / lưu.
  const vLay: XlLayout = useMemo(() => ({ rows: [...lines.map((l) => l.id), ...vIds], cols: xlCols }), [lines, vIds, xlCols]);
  const canonCol = (k: string) => (qs ? k : k === "apprAmount" ? (apprCol ? `ba:${apprCol}` : "propAmount") : k === "tpPrice" ? (apprCol ? `bp:${apprCol}` : "propPrice") : k);
  const viewCol = (k: string) => {
    if (qs) return hideD && k === "propAmount" ? `ba:${sel}` : hideD && k === "propPrice" ? `bp:${sel}` : k;
    if (k === "propAmount" || (apprCol && k === `ba:${apprCol}`)) return "apprAmount";
    if (k === "propPrice" || (apprCol && k === `bp:${apprCol}`)) return "tpPrice";
    return k;
  };
  const mapCols = (stable: string, fn: (k: string) => string) => stable.replace(/\[\[([^|\]]+)\|(\$?)([^\]]+)\]\]/g, (_m, r: string, d: string, c: string) => `[[${r}|${d}${fn(c)}]]`);
  // ô thành tiền của dòng tổng trên màn hình: cột → khối (A, B, C1.., D, S) + tổng cột
  const totBlock = new Map<string, string>();
  for (const c of blocks) {
    totBlock.set(amtKey(c), c);
    if (wideCol(c)) {
      totBlock.set(hdKey(c), c);
      totBlock.set(plKey(c), c);
    }
  }
  const shapeKey = [qs, hideD, sel, apprCol, showHd, blocks.join(",")].join("|");
  const calc = useMemo(() => {
    const colTk = new Map<string, string>();
    const plCol = new Map<string, [string, string]>(); // ô TT phụ lục (PLHĐ điều chỉnh) = điều chỉnh − hợp đồng
    const plTk = new Map<string, string>(); // ô TT phụ lục → khoá công thức riêng "PL:<tổng cột>" (gõ đè được, VD làm tròn — chỉ đổi số cột phụ lục)
    for (const c of blocks) {
      colTk.set(amtKey(c), c === "S" ? "S" : tkOf(c));
      if (wideCol(c)) {
        colTk.set(hdKey(c), hdKeyOf(c));
        plCol.set(plKey(c), [tkOf(c), hdKeyOf(c)]);
        plTk.set(plKey(c), `PL:${tkOf(c) === "R" ? "D" : tkOf(c)}`);
      }
    }
    const fx = head.totalFormulas ?? {};
    const fxErr: Record<string, string> = {}; // "<dòng>|<cột màn hình>" → mã lỗi (#REF!, #CIRC!...)
    const plv: Record<string, number> = {}; // "<dòng>|<cột phụ lục>" → số theo công thức gõ ở ô phụ lục
    const live = [...[...colTk], ...[...plTk]].flatMap(([col, tk]) => vIds.filter((row) => isTotFxRow(row) && (fx[totFxKey(row, tk)] ?? "").trim().startsWith("=")).map((row) => ({ row, col, tk, key: `${row}|${tk}` })));
    if (!live.length) return { ...calc0, diff: {} as Record<string, number>, fxErr, colTk, plTk, plv };
    const L = lines.length;
    const rowIdx = new Map(vLay.rows.map((id, i) => [id, i]));
    const colIdx = new Map(xlCols.map((k, i) => [k, i]));
    // ô của dòng công việc / đầu mục: công thức đang có (đầu mục = SUBTOTAL để SUBTOTAL ở dòng TỔNG CỘNG không cộng 2 lần), không thì số
    const lineRaw = (r: number, col: string) => {
      const l = lines[r];
      const f = xf.formulaOf(l, col);
      if (f) return forEval(f);
      if (l.level !== "ITEM") {
        const af = autoFormula(l, col);
        if (af) return forEval(af);
      }
      const v = valueOf(l, col, r);
      return typeof v === "number" ? numRaw(v) : (v ?? "");
    };
    const tks = [...new Set(colTk.values())];
    let cur: Record<string, ChainTotals> = calc0.totals;
    let diff: Record<string, number> = {};
    let ov: Record<string, number> = {};
    let errs: Record<string, string> = {};
    let moving = new Set<string>();
    // tính lặp: công thức dòng trên (VD PRELIM làm tròn) đổi số → dòng dưới (TRƯỚC VAT, VAT...) tính lại → công thức dòng dưới đọc số mới
    for (let it = 0; it < 12; it++) {
      const curT = cur;
      const curD = diff;
      const ev = evalGrid(vLay, (r, c) => {
        const col = xlCols[c];
        if (!col) return "";
        if (r < L) return lineRaw(r, col);
        const row = vIds[r - L];
        if (!row) return "";
        const tk = colTk.get(col);
        if (tk) {
          const f = isTotFxRow(row) ? fx[totFxKey(row, tk)] : undefined;
          if (f && f.trim().startsWith("=")) return forEval(toDisplay(mapCols(f, viewCol), vLay));
          if (row === "v:ratio") {
            const a = curT.A?.afterVat ?? 0;
            const d = vValue(curT, curD, "v:diff", tk);
            return a && d != null ? numRaw(d / a) : "";
          }
          return numRaw(vValue(curT, curD, row, tk));
        }
        const pl = plCol.get(col);
        if (pl) {
          const pf = isTotFxRow(row) ? fx[totFxKey(row, plTk.get(col) ?? "")] : undefined;
          if (pf && pf.trim().startsWith("=")) return forEval(toDisplay(mapCols(pf, viewCol), vLay));
          const a = vValue(curT, curD, row, pl[0]);
          const b = vValue(curT, curD, row, pl[1]);
          return a == null && b == null ? "" : numRaw((a ?? 0) - (b ?? 0));
        }
        const s = virtRaw(row, col); // ô % Prelim / VAT, ô đơn giá dòng chi phí thêm / thuế bổ sung
        return s.startsWith("=") ? "" : s;
      });
      const nov: Record<string, number> = {};
      const nerr: Record<string, string> = {};
      for (const x of live) {
        const v = ev.valueOf(rowIdx.get(x.row) ?? -1, colIdx.get(x.col) ?? -1);
        if (typeof v === "number" && Number.isFinite(v)) nov[x.key] = v;
        else if (v === null || v === "") nov[x.key] = 0;
        else nerr[`${x.row}|${x.col}`] = typeof v === "string" && v.startsWith("#") ? v : "#VALUE!";
      }
      const next: Record<string, ChainTotals> = { ...calc0.totals };
      for (const tk of tks) next[tk] = chainTotals(calc0.args[tk], (row) => nov[`${row}|${tk}`]);
      const nd: Record<string, number> = {};
      for (const tk of tks) if (nov[`v:diff|${tk}`] != null) nd[tk] = nov[`v:diff|${tk}`];
      moving = new Set(live.filter((x) => Math.abs((nov[x.key] ?? 0) - (ov[x.key] ?? 0)) > 1e-9 || (x.key in nov) !== (x.key in ov)).map((x) => x.key));
      cur = next;
      diff = nd;
      ov = nov;
      errs = nerr;
      if (!moving.size) break;
    }
    // công thức vòng tròn (VD PRELIM tham chiếu SAU VAT) không ra số ổn định → báo lỗi #CIRC!
    for (const x of live) if (moving.has(x.key)) errs[`${x.row}|${x.col}`] = "#CIRC!";
    for (const x of live) if (x.tk.startsWith("PL:") && ov[x.key] != null) plv[`${x.row}|${x.col}`] = ov[x.key];
    return { ...calc0, totals: cur, diff, fxErr: errs, colTk, plTk, plv };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calc0, head.totalFormulas, vLay, valueOf, shapeKey, head.vtValue, head.tbValue, head.otherValue, head.prelim, head.vat, head.extras, head.vatRows, xf.formulaOf]);
  // số ô TT PHỤ LỤC ở dòng tổng: có công thức gõ ở ô phụ lục thì lấy số theo công thức, không thì điều chỉnh − hợp đồng
  const plValue = (row: string, c: string, auto: number) => calc.plv[`${row}|${plKey(c)}`] ?? auto;
  // CHÊNH LỆCH so với CĐT của tổng cột tk (có công thức thì lấy số theo công thức)
  const diffOf = (tk: string) => vValue(calc.totals, calc.diff, "v:diff", tk) ?? 0;
  // công thức đang lưu của ô thành tiền dòng tổng, dạng địa chỉ đang hiện (K5...); "" = ô tự tính
  const totFxText = (row: string, col: string) => {
    const tk = calc.colTk.get(col) ?? calc.plTk.get(col);
    const f = tk && isTotFxRow(row) ? head.totalFormulas?.[totFxKey(row, tk)] : undefined;
    return f && f.trim().startsWith("=") ? toDisplay(mapCols(f, viewCol), vLay) : "";
  };
  // ghi công thức ("=..." ) vào ô thành tiền dòng tổng; chuỗi khác "=" = xoá công thức (về lại số tự tính)
  const setTotFx = (row: string, col: string, text: string) => {
    const tk = calc.colTk.get(col) ?? calc.plTk.get(col);
    if (!tk || !isTotFxRow(row) || (row === "v:diff" && tk === "A")) return; // cột CĐT không có chênh lệch
    const key = totFxKey(row, tk);
    const t = text.trim();
    const lay = vLay;
    setHead((h) => {
      const fx = { ...(h.totalFormulas ?? {}) };
      if (t.startsWith("=")) fx[key] = mapCols(toStable(balanceParens(t), lay), canonCol);
      else if (key in fx) delete fx[key];
      else return h;
      return { ...h, totalFormulas: fx };
    });
    setDirty(true);
  };
  // ô thành tiền dòng chi phí thêm đang nhập tay (không có % / công thức ở ô đơn giá): trả khoá vals để ghi số; null = ô tính theo đơn giá
  const extraManualKey = (row: string, col: string): string | null => {
    if (!row.startsWith("v:x:")) return null;
    const x = (head.extras ?? []).find((e) => `v:x:${e.id}` === row);
    const c = totBlock.get(col);
    if (!x || !c || c === "S") return null; // cột tổng duyệt nhiều thầu phụ: số gõ vào thành công thức (không ghi đè số của cột D)
    if (col === amtKey(c)) return (x.rates?.[pk(c)] ?? "").trim() ? null : pk(c);
    if (wideCol(c) && col === hdKey(c)) return hdInherited(x, c) || (x.rates?.[hdKeyOf(c)] ?? "").trim() ? null : hdKeyOf(c);
    return null;
  };
  // gõ / dán vào ô thành tiền dòng tổng: "=..." công thức · số (dòng chi phí thêm nhập tay → ghi số như cũ, dòng khác → công thức =số) · "" xoá
  const typeTot = (row: string, col: string, text: string) => {
    const t = text.trim();
    if (t.startsWith("=")) return setTotFx(row, col, t);
    const n = t === "" ? null : parsePastedNumber(t);
    const mk = extraManualKey(row, col);
    if (mk) {
      setTotFx(row, col, "");
      setExtraVal(row.slice(4), mk, n);
      return;
    }
    setTotFx(row, col, n == null ? "" : `=${numRaw(n)}`);
  };
  // ô THÀNH TIỀN ở các dòng tổng: sửa được thì ô nhập có công thức kiểu Excel (bấm vào hiện công thức đang dùng để sửa, VD bọc ROUND(...;0))
  const totTd = (row: string, col: string, value: number | null | undefined, opt: { cls?: string; show?: boolean } = {}) => {
    const c = totBlock.get(col);
    const f = totFxText(row, col);
    const err = calc.fxErr[`${row}|${col}`];
    const fxCls = f ? (err ? " !text-red-600 !bg-red-50" : " !bg-indigo-50 italic") : "";
    const title = err ? `Lỗi công thức ${err}: ${f}` : f ? `Công thức: ${f} — xoá trống ô để về lại số tự tính` : "Gõ = để đặt công thức như Excel, VD =ROUND(…;0) · =ROUNDUP(…;-3) · =ROUNDDOWN(…;0)";
    const shown = opt.show === false && !f ? null : (value ?? null);
    if (!c || !canC(c) || !isTotFxRow(row))
      return (
        <td className={`num ${opt.cls ?? ""}${fxCls}`} title={f ? title : undefined} {...xcell(row, col)}>
          {fm(shown)}
        </td>
      );
    const mk = extraManualKey(row, col);
    const auto = virtRaw(row, col);
    return (
      <td className="p-0" {...xcell(row, col)}>
        <NumInput
          decimals
          allowEmpty
          allowFormula
          money
          placeholder=""
          value={shown}
          formula={f || (auto.startsWith("=") ? auto : undefined)}
          onCommitFormula={(t) => setTotFx(row, col, t)}
          onCommit={(v) => typeTot(row, col, v == null ? "" : numRaw(v))}
          title={mk && !f ? undefined : title}
          className={`${cellIn} text-right ${opt.cls ?? ""}${fxCls}`}
        />
      </td>
    );
  };
  // công thức dòng tổng gửi lên khi lưu: bỏ khoá của dòng đã xoá; số tổng của các cột có công thức (phía máy chủ dùng số này)
  const totPayload = () => {
    const fx = Object.fromEntries(Object.entries(head.totalFormulas ?? {}).filter(([k, f]) => vIds.includes(totFxRow(k)) && isTotFxRow(totFxRow(k)) && f.trim().startsWith("=")));
    const fxTks = new Set(Object.keys(fx).map(totFxTk));
    const shown = [...new Set(calc.colTk.values())];
    const amounts: Record<string, SavedTot> = {};
    for (const tk of shown) {
      if (!fxTks.has(tk === "R" ? "D" : tk)) continue;
      const t = calc.totals[tk];
      amounts[tk] = { sum: t.sum, extra: t.extra, prelim: t.prelim, beforeVat: t.beforeVat, vat: t.vat, vat2: t.vat2, afterVat: t.afterVat, x: t.x, t: t.t, ...(calc.diff[tk] != null ? { diff: calc.diff[tk] } : {}) };
    }
    return { totalFormulas: fx, totalAmounts: amounts, totalShown: shown };
  };
  useEffect(() => {
    totRef.current = totPayload;
  });
  const xlApi: XlGridApi = {
    addr: (row, col) => (row.startsWith("v:") ? vAddr(row, col) : xf.addr(row, col)),
    raw: (row, col) => {
      if (row.startsWith("v:")) return totFxText(row, col) || virtRaw(row, col);
      const i = lines.findIndex((x) => x.id === row);
      const l = lines[i];
      if (!l) return "";
      const f = xf.formulaOf(l, col);
      if (f) return f;
      const af = autoFormula(l, col);
      if (af) return af;
      const v = valueOf(l, col, i);
      return typeof v === "number" ? v.toLocaleString("vi-VN", { maximumFractionDigits: 6 }) : (v ?? "");
    },
    text: (row, col) => {
      if (row.startsWith("v:")) return virtText(row, col);
      const i = lines.findIndex((x) => x.id === row);
      const l = lines[i];
      if (!l) return "";
      const v = valueOf(l, col, i);
      return typeof v === "number" ? v.toLocaleString("vi-VN", { maximumFractionDigits: 6 }) : (v ?? "");
    },
    set: (row, col, text) => {
      if (row.startsWith("v:")) {
        // dòng tổng: ô % Prelim / VAT, đơn giá dòng chi phí thêm / thuế bổ sung ghi như cũ; ô THÀNH TIỀN nhận công thức (=ROUND(...)) hoặc số
        const tb = totBlock.get(col);
        if (tb && isTotFxRow(row)) {
          if (canC(tb)) typeTot(row, col, text);
          return;
        }
        const c = vBlockOf(col);
        if (!c || !canC(c)) return;
        const isRate = rateKey(c) === col;
        if ((row === "v:prelim" || row === "v:vat") && isRate) {
          const k = row === "v:prelim" ? "prelim" : "vat";
          setH({ [k]: { ...head[k], [c]: parsePastedNumber(text) ?? 0 } } as Partial<SubHead>);
        } else if (row.startsWith("v:x:")) {
          const xid = row.slice(4);
          if (isRate) setExtraRate(xid, c, text);
          else if (!((head.extras ?? []).find((e) => e.id === xid)?.rates?.[c] ?? "").trim()) setExtraVal(xid, c, parsePastedNumber(text));
        } else if (row.startsWith("v:t:") && isRate) setVatVal(row.slice(4), c, text);
        return;
      }
      const l = lines.find((x) => x.id === row);
      if (!l || !canEdit(l, col)) return;
      if (isNumCol(col)) {
        if (text.trim().startsWith("=")) {
          xf.setFormula(row, col, text);
          if (col === "basePrice") setL(row, { baseManual: true });
          setDirty(true);
        } else setL(row, numPatch(l, col, text.trim() === "" ? null : parsePastedNumber(text)));
      } else setL(row, { [col]: text } as Partial<SubSheetLine>);
    },
    onUndo: hist.undo,
    onRedo: hist.redo,
  };
  const nProps = (l: SubSheetLine, f: string) => {
    const { fx, ...x } = fProps(l, f);
    void fx;
    return x;
  };
  // ô số có công thức: hiện công thức khi bấm vào, lưu công thức; gõ số thường thì bỏ công thức
  const fProps = (l: SubSheetLine, f: string) => {
    const err = xf.errors[`${l.id}|${f}`];
    const has = !!l.formulas?.[f];
    return {
      formula: xf.formulaOf(l, f) || undefined,
      onCommitFormula: (t: string) => {
        xf.setFormula(l.id, f, t);
        if (f === "basePrice") setL(l.id, { baseManual: true });
        setDirty(true);
      },
      onCommit: (v: number | null) => setL(l.id, numPatch(l, f, v)),
      title: err ? `Lỗi công thức ${err}: ${xf.formulaOf(l, f)}` : has ? `Công thức: ${xf.formulaOf(l, f)}` : undefined,
      fx: has ? (err ? " !text-red-600 !bg-red-50" : " !bg-indigo-50 italic") : "",
    };
  };

  const cellIn = "w-full min-w-0 bg-sky-50/70 px-1 py-0.5 font-[inherit] text-[12px] outline-none focus:bg-sky-100";
  // nút ＋ / ✕ của dòng chi phí thêm / thuế bổ sung (cột hạng mục bị ẩn thì nằm đầu ô nội dung)
  const rowBtns = (add: () => void, del: () => void, addTitle: string, delTitle: string) =>
    qs ? (
      <span className="inline-flex shrink-0 gap-1">
        <button type="button" title={addTitle} onClick={add} className="rounded px-1 text-[13px] font-bold leading-none text-emerald-700 hover:bg-emerald-100">
          ＋
        </button>
        <button type="button" title={delTitle} onClick={del} className="rounded px-1 text-[13px] font-bold leading-none text-red-600 hover:bg-red-100">
          ✕
        </button>
      </span>
    ) : null;
  const miss = "!bg-red-100";
  // Gõ tiếng Việt có dấu (Telex/VNI): ô chữ KHÔNG điều khiển — trình duyệt giữ chữ đang gõ, React không ghi đè giữa lúc bộ gõ ghép dấu (như PriceSheet)
  const imeSafe = (value: string, apply: (v: string) => void) => ({
    defaultValue: value,
    ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (el && document.activeElement !== el && el.value !== value) el.value = value;
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => apply(e.target.value),
  });
  // ô chữ: QSĐT / QSTT sửa được (multi = chữ dài tự xuống dòng, ô cao theo nội dung); không thì chỉ hiện chữ
  const txt = (l: SubSheetLine, col: "stt" | "workName" | "content" | "code" | "origin" | "unit" | "dims" | "material" | "dimL" | "dimW" | "dimH" | "baseNote" | "note" | "qsNote" | "tpNote", opt: { multi?: boolean; cls?: string; tdCls?: string; ph?: string; miss?: boolean } = {}) =>
    canEdit(l, col) ? (
      <td className="p-0" {...xcell(l.id, col)}>
        {opt.multi ? (
          <textarea rows={1} style={{ fieldSizing: "content" } as React.CSSProperties} placeholder={opt.ph} className={`${cellIn} block resize-none overflow-hidden whitespace-pre-wrap break-words ${opt.cls ?? ""} ${opt.miss ? miss : ""}`} {...imeSafe(l[col], (v) => setL(l.id, { [col]: v } as Partial<SubSheetLine>))} />
        ) : (
          <input placeholder={opt.ph} className={`${cellIn} ${opt.cls ?? ""} ${opt.miss ? miss : ""}`} {...imeSafe(l[col], (v) => setL(l.id, { [col]: v } as Partial<SubSheetLine>))} />
        )}
      </td>
    ) : (
      <td className={`${opt.tdCls ?? ""} ${opt.multi ? "whitespace-pre-line break-words" : ""}`}>{l[col]}</td>
    );
  // ô số (KL / đơn giá): sửa được thì NumInput có công thức kiểu Excel; không thì chỉ hiện số. kind "q" = khối lượng, "m" = tiền
  const numTd = (l: SubSheetLine, col: string, value: number | null, kind: "q" | "m", opt: { cls?: string; tdCls?: string; ph?: string; title?: string; zero?: boolean; pct?: boolean } = {}) =>
    canEdit(l, col) ? (
      <td className="p-0" {...xcell(l.id, col)} title={opt.title}>
        <NumInput decimals allowEmpty allowFormula showZero={opt.zero} suffix={opt.pct ? "%" : undefined} value={value} placeholder={opt.ph} {...nProps(l, col)} className={`${cellIn} text-right ${opt.cls ?? ""}${fProps(l, col).fx}`} />
      </td>
    ) : (
      <td className={`num ${opt.tdCls ?? ""}`} title={opt.title}>
        {opt.pct ? (value == null ? "" : `${+value.toFixed(4)}%`) : kind === "q" ? fq(value) : opt.zero ? (value == null ? "" : Math.round(value).toLocaleString("vi-VN")) : fm(value)}
      </td>
    );
  const lowest = (l: SubSheetLine) => {
    let best: string | null = null;
    for (const b of bidders) {
      const p = l.bids[b.key]?.price;
      if (p != null && p > 0 && (best == null || p < (l.bids[best]?.price ?? Infinity))) best = b.key;
    }
    return best;
  };
  // Độ rộng CỐ ĐỊNH từng cột (px): STT, Hạng mục, Nội dung, Mã SP, ĐVT, Kích thước | A | B (+ghi chú) | thầu phụ | D | Ghi chú | Ghi chú QSTT | Ý kiến TP/PTG
  const trioW = [64, 92, 108];
  // PLHĐ điều chỉnh: khối "HỢP ĐỒNG GỐC" (KL, đơn giá, thành tiền theo hợp đồng) đứng trước khối CHỦ ĐẦU TƯ — chỉ hiện khi đúng loại này
  const w7 = [64, 64, 92, 92, 108, 108, 108];
  const bw6 = [64, 80, 80, 80, 92, 108]; // giá chi tiết: KL | vật tư | nhân công | thiết bị | đơn giá tổng | thành tiền
  const w10 = [64, 64, 92, 80, 80, 80, 92, 108, 108, 108];
  const bwC = noTb ? [64, 80, 80, 92, 108] : bw6; // MEP không có cột thiết bị
  const trioQ = oneQ ? trioW.slice(1) : trioW; // dùng chung 1 KL: các khối bỏ cột KL
  const bwQ = oneQ ? bwC.slice(1) : bwC;
  const w10C = noTb ? [64, 64, 92, 80, 80, 92, 108, 108, 108] : w10;
  const colW = [...(ntm ? [34, 80, 220, 96, 170, 52, 52, 52, 48] : mep ? [34, 110, 240, 120, 130, 60] : [34, 110, 240, 60, 48]), ...(oneQ ? [70] : []), ...(showHd ? w7 : cdtComp ? bwQ : trioQ), ...(showHd ? (showCt ? w10C : w7) : showCt ? bwQ : trioQ), 130, ...bidders.flatMap(() => (showCt ? bwQ : trioQ)), ...(hideD ? [] : showHd ? (showCt ? w10C : w7) : showCt ? bwQ : trioQ), ...(multiAward ? [130] : []), 140, 160, 160];
  // dòng chi phí thêm có đang tính cột hợp đồng theo % / công thức của ô đơn giá không
  const hdInherited = (x: ExtraRow, c: string) => {
    const b = (x.rates?.[pk(c)] ?? "").trim();
    return !(x.rates?.[hdKeyOf(c)] ?? "").trim() && (b.endsWith("%") || b.startsWith("="));
  };
  const SEVEN = ["KL HĐ", "KL ĐC", "ĐG HĐ", "ĐG ĐC", "TT HĐ", "TT ĐC", "TT PL"];
  const sevenHeads = (cls: string) => SEVEN.map((h) => <th key={h} className={cls}>{h}</th>);
  const THREE = ["KL", "ĐƠN GIÁ", "THÀNH TIỀN"];
  const THREEq = oneQ ? THREE.slice(1) : THREE;
  // PLHĐ điều chỉnh: đơn giá điều chỉnh khác đơn giá hợp đồng (cả hai đều có số) → chữ đỏ
  const diffPrice = (adj: number | null | undefined, hd: number | null | undefined) => showHd && adj != null && hd != null && Math.abs(adj - hd) > 0.5;
  const hrs = showHd ? 3 : 2; // số dòng tiêu đề: PLHĐ điều chỉnh có 3 tầng (khối → Khối lượng / Đơn giá / Thành tiền → Hợp đồng / Điều chỉnh / Phụ lục)
  const hdGroup = (cls: string, comp: boolean) => (
    <>
      <th colSpan={2} className={cls}>Khối lượng</th>
      <th colSpan={comp ? nComp + 2 : 2} className={cls}>Đơn giá</th>
      <th colSpan={3} className={cls}>Thành tiền</th>
    </>
  );
  const hdSub = (cls: string, comp: boolean) =>
    ["Hợp đồng", "Điều chỉnh", "Hợp đồng", ...(comp ? ["Vật tư", "Nhân công", ...(noTb ? [] : [mepT ? "Thuê VT (%)" : "Thiết bị"])] : []), "Điều chỉnh", "Hợp đồng", "Điều chỉnh", "Phụ lục"].map((h, i) => (
      <th key={`${i}-${h}`} className={`${cls} ${h === "Phụ lục" ? "text-blue-700" : ""}`}>
        {h}
      </th>
    ));
  const SIX = noTb ? ["KL", "ĐG VẬT TƯ", "ĐG NHÂN CÔNG", "ĐƠN GIÁ", "THÀNH TIỀN"] : ["KL", "ĐG VẬT TƯ", "ĐG NHÂN CÔNG", mepT ? "THUÊ VẬT TƯ (%)" : "ĐG THIẾT BỊ", "ĐƠN GIÁ", "THÀNH TIỀN"]; // MEP không có thiết bị
  const SIXq = oneQ ? SIX.slice(1) : SIX;
  const TEN = noTb ? ["KL HĐ", "KL ĐC", "ĐG HĐ", "ĐG VT", "ĐG NC", "ĐG ĐC", "TT HĐ", "TT ĐC", "TT PL"] : ["KL HĐ", "KL ĐC", "ĐG HĐ", "ĐG VT", "ĐG NC", mepT ? "THUÊ VT %" : "ĐG TB", "ĐG ĐC", "TT HĐ", "TT ĐC", "TT PL"];
  // cột của (các) thầu phụ được DUYỆT: tô nền xanh + tiêu đề nổi
  const awardKeys = awards.length ? awards.map((a) => a.key) : sel ? [sel] : [];
  const awardRanges = bidders.flatMap((b, idx) => {
    if (!awardKeys.includes(b.key) || hideBid || !(hideD || multiAward)) return [];
    const bn = showCt ? bwQ.length : trioQ.length;
    const nA = showHd ? w7.length : cdtComp ? bwQ.length : trioQ.length;
    const nB = (showHd ? (showCt ? w10C.length : w7.length) : showCt ? bwQ.length : trioQ.length) + 1;
    const st = (leadCols.length + (oneQ ? 1 : 0)) + nA + nB + idx * bn;
    return [[st, st + bn] as [number, number]];
  });
  // cột thầu phụ bị gộp vào khối D (PLHĐ điều chỉnh) → ẩn kiểu Excel (collapse), bớt độ rộng bảng
  const bnW = showCt ? bwQ.length : trioQ.length;
  const collapseFrom = hideBid ? (leadCols.length + (oneQ ? 1 : 0)) + (showHd ? w7.length : cdtComp ? bwQ.length : trioQ.length) + ((showHd ? (showCt ? w10C.length : w7.length) : showCt ? bwQ.length : trioQ.length) + 1) + Math.max(0, bidders.findIndex((b) => b.key === sel)) * bnW : -1;
  // cột ẩn kiểu Excel (collapse): cột thầu phụ gộp vào khối D; cột HẠNG MỤC (index 1) khi trùng cột NỘI DUNG
  const colHidden = (i: number) => (hideBid && i >= collapseFrom && i < collapseFrom + bnW) || (oneName && !ntm && i === 1);
  const tableW = colW.reduce((t, w, i) => t + (colHidden(i) ? 0 : w), 0);

  // ---- NỘI THẤT: các cột đầu (Mã SP | Hạng mục | Hình ảnh | Mô tả vật liệu | Dài | Rộng | Cao | ĐVT), dòng SẢN PHẨM, dòng phần việc đã duyệt ở hồ sơ khác ----
  const ntLead = (l: SubSheetLine, sp: boolean) => (
    <>
      {txt(l, "code", { multi: true, cls: `text-center text-[11px] ${sp ? "font-bold" : ""}`, tdCls: `text-center text-[11px] ${sp ? "font-bold" : ""}` })}
      {txt(l, "content", { multi: true, cls: sp ? "font-bold" : "", tdCls: sp ? "font-bold" : "", ph: sp ? "Tên sản phẩm" : "Hạng mục công việc", miss: qs && !l.content.trim() })}
      <td className="p-0.5 align-middle not-italic">
        <SubImageCell lineId={l.id} images={ntImages[l.id] ?? []} editable={qs} />
      </td>
      {txt(l, "material", { multi: true, cls: "text-[11px]", tdCls: "text-[11px]" })}
      {txt(l, "dimL", { cls: "text-center", tdCls: "text-center" })}
      {txt(l, "dimW", { cls: "text-center", tdCls: "text-center" })}
      {txt(l, "dimH", { cls: "text-center", tdCls: "text-center" })}
      {txt(l, "unit", { cls: "text-center", tdCls: "text-center", miss: qs && l.level === "ITEM" && !l.unit.trim() })}
    </>
  );
  // thành tiền 1 phần việc để cộng giá trị cả sản phẩm: phần việc trình lần này theo đề xuất (QS) / duyệt; phần việc khác theo giá duyệt ở hồ sơ khác hoặc dự kiến
  const partAmt = (c: SubSheetLine) => (c.level === "REF" ? amt(...refQP(c)) : amt(propQtyOf(c, sel), qs ? propPriceOf(c, sel) : apprPriceOf(c, sel))) ?? 0;
  // dòng SẢN PHẨM: thông tin + giá CĐT của cả sản phẩm; khối thầu phụ = tổng các phần việc trình lần này; khối đề xuất = Σ CẢ SẢN PHẨM
  // (mọi phần việc, kể cả phần việc khác / đã duyệt ở hồ sơ khác) — vượt giá CĐT thì tô đỏ
  const spRow = (l: SubSheetLine, i: number) => {
    const g = calc.group[i] ?? {};
    const kids = spChildren(lines, i);
    const extra = ntCtx.extra[l.id] ?? [];
    const all = kids.reduce((t, j) => t + partAmt(lines[j]), 0) + extra.reduce((t, a) => t + (amt(a.qty, a.price) ?? 0), 0);
    const own = amt(l.cdtQty, l.cdtPrice);
    const cdtAll = own ?? (kids.some((j) => lines[j].cdtPrice != null) ? kids.reduce((t, j) => t + (amt(lines[j].cdtQty, lines[j].cdtPrice) ?? 0), 0) : null);
    const overSp = cdtAll != null && cdtAll > 0 && all > cdtAll + 0.5;
    const allTd = (
      <td className={`num font-bold ${overSp ? "bg-orange-100 text-red-600" : "text-emerald-800"}`} title="Σ cả sản phẩm = phần việc trình lần này + phần việc khác (đã duyệt ở hồ sơ khác / dự kiến)">
        {fm(all)}
      </td>
    );
    return (
      <tr key={l.id} className="group bg-amber-50 font-semibold" title="Sản phẩm — tổng các phần việc bên dưới">
        {qs ? (
          <td className="relative p-0" {...xcell(l.id, "stt")}>
            <input className={`${cellIn} text-center font-bold`} {...imeSafe(l.stt, (v) => setL(l.id, { stt: v }))} />
            {rowTools(l, i)}
          </td>
        ) : (
          <td className="text-center font-bold">{l.stt}</td>
        )}
        {ntLead(l, true)}
        {oneQ && numTd(l, "cdtQty", l.cdtQty, "q", { title: "Khối lượng CĐT của cả sản phẩm" })}
        {showHd ? (
          <FragTd wide x={{ row: l.id, v: "cdtAmount", hd: "cdtHdAmount", pl: "cdtPlAmount" }} v={fm(g.A)} hd={fm(g.AH)} pl={fm((g.A ?? 0) - (g.AH ?? 0))} />
        ) : cdtComp ? (
          <FragTd mini={oneQ} comp={cdtComp} n={nComp} x={{ row: l.id, v: "cdtAmount" }} v={fm(g.A)} />
        ) : (
          <>
            {!oneQ && numTd(l, "cdtQty", l.cdtQty, "q", { title: "Khối lượng CĐT của cả sản phẩm" })}
            {numTd(l, "cdtPrice", l.cdtPrice, "m", { title: "Đơn giá CĐT của cả sản phẩm — so với tổng các phần việc" })}
            <td className="num font-bold" {...xcell(l.id, "cdtAmount")}>{fm(own ?? g.A)}</td>
          </>
        )}
        {showHd ? <FragTd comp={showCt} n={nComp} wide x={{ row: l.id, v: "baseAmount", hd: "baseHdAmount", pl: "basePlAmount" }} v={fm(g.B)} hd={fm(g.BH)} pl={fm((g.B ?? 0) - (g.BH ?? 0))} /> : <FragTd mini={oneQ} comp={showCt} n={nComp} x={{ row: l.id, v: "baseAmount" }} v={fm(g.B)} />}
        <td className="text-[11px] font-normal">{kids.length + extra.length} phần việc</td>
        {bidders.map((b) => (
          <FragTd mini={oneQ} comp={showCt} n={nComp} key={b.key} x={{ row: l.id, v: b.key === apprCol ? "apprAmount" : `ba:${b.key}` }} v={fm(b.key === apprCol ? g.R : g[b.key])} />
        ))}
        {showHd ? <FragTd comp={showCt} n={nComp} wide v="" hd={fm(g.H)} pl="" cell={allTd} /> : hideD ? null : <FragTd mini={oneQ} comp={showCt} n={nComp} v="" cell={allTd} />}
        {multiAward && <td className="num">{fm(g.S)}</td>}
        <td className="text-[11px] font-normal">
          <span className="block">
            Σ cả sản phẩm: <b>{fm(all)}</b>
          </span>
          {cdtAll != null && (
            <span className="block">
              Giá CĐT: {fm(cdtAll)}
              {cdtAll > 0 ? ` · bằng ${Math.round((all / cdtAll) * 100)}%` : ""}
            </span>
          )}
          {overSp && <span className="block font-semibold text-red-600">⚠ Tổng các phần việc vượt giá CĐT</span>}
        </td>
        {txt(l, "qsNote", { multi: true, tdCls: "bg-sky-50/40" })}
        <td />
      </tr>
    );
  };
  // phần việc của sản phẩm đã duyệt ở hồ sơ nội thất khác mà hồ sơ này không có dòng → hiện ngay dưới các phần việc của sản phẩm (chỉ xem)
  const ntAfter = new Map<number, string>();
  if (ntm)
    lines.forEach((l, i) => {
      if (l.level !== "SP" || !ntCtx.extra[l.id]?.length) return;
      const k = spChildren(lines, i);
      ntAfter.set(k.length ? k[k.length - 1] : i, l.id);
    });
  const ntWrap = (l: SubSheetLine, i: number, node: React.ReactNode) => {
    const spId = ntAfter.get(i);
    if (!spId) return node;
    return (
      <Fragment key={l.id}>
        {node}
        {(ntCtx.extra[spId] ?? []).map((a, k) => (
          <tr key={`${spId}-x${k}`} className="bg-emerald-50/50 text-[11px] italic text-slate-600" title="Phần việc của sản phẩm này đã duyệt ở hồ sơ khác (chỉ tham khảo, không cộng vào tổng hồ sơ này)">
            <td />
            <td />
            <td className="pl-3">↳ {a.name}</td>
            <td colSpan={colW.length - 3}>
              Phần việc khác — <b className="not-italic text-emerald-700">ĐÃ DUYỆT</b> ở hồ sơ{" "}
              <a href={`/gia-doi/thau-phu/${a.proposalId}`} target="_blank" rel="noreferrer" className="underline">
                {a.code}
              </a>
              {a.sub ? ` · ${a.sub}` : ""}: {fq(a.qty)} {a.unit} × {fm(a.price)} = <b>{fm(amt(a.qty, a.price))}</b>
            </td>
          </tr>
        ))}
      </Fragment>
    );
  };
  // cửa sổ toàn màn hình: thanh nút Trình / Duyệt luôn hiện ở đáy cửa sổ
  const stickyBar = "sticky bottom-0 z-20 shadow-[0_-4px_12px_rgba(15,23,42,0.12)]";
  // ---- ĐỐI CHIẾU TỔNG THỂ: giá trị thầu phụ (HĐTP, hoặc PLĐC = HĐTP gốc + các phụ lục + phụ lục này) + vật tư + thiết bị so với giá trị ký CĐT và DT-CP ----
  const isPl = head.proposalType === "PL";
  const adjValue = calc.totals[qs ? "D" : "R"].afterVat; // giá trị hồ sơ này (sau Prelim + VAT)
  const hdValue = calc.totals.H.afterVat; // PLHĐ điều chỉnh: giá trị theo cột HỢP ĐỒNG (sau Prelim + VAT)
  // giá trị PHỤ LỤC này: PLHĐ điều chỉnh = điều chỉnh − hợp đồng (cột Phụ lục); PL cộng gộp / HĐTP = cả giá trị hồ sơ
  const thisValue = showHd ? adjValue - hdValue : adjValue;
  const priorSum = chain ? chain.priors.reduce((t, x) => t + x.value, 0) : 0;
  // hợp đồng thầu phụ gốc: hồ sơ HĐTP có trên phần mềm → giá trị hồ sơ đó; HĐ nhập tay → PLHĐ điều chỉnh lấy theo cột Hợp đồng của bảng
  // PL cộng gộp + HĐ gõ tay: lấy ô GIÁ TRỊ HĐ + PL ĐÃ KÝ do QSĐT nhập
  const rootValue = chain ? chain.rootValue : showHd ? hdValue : signedNeeded(head) ? Number(head.signedValue) || 0 : 0;
  const plDc = rootValue + priorSum + thisValue; // PLĐC
  const subValue = isPl ? plDc : thisValue;
  const vtVal = Number(head.vtValue) || 0;
  const tbVal = Number(head.tbValue) || 0;
  const otherVal = Number(head.otherValue) || 0; // chi phí khác (tuỳ chọn)
  const totalCost = subValue + vtVal + tbVal + otherVal;
  const cdtVal = calc.totals.A.afterVat;
  const dtcpVal = calc.totals.B.afterVat;
  const reconLevel: "red" | "amber" | "ok" = cdtVal > 0 && totalCost > cdtVal + 0.5 ? "red" : dtcpVal > 0 && totalCost > dtcpVal + 0.5 ? "amber" : "ok";
  const needForm = awardNeed(head.awardForm);
  const headInput = (k: keyof SubHead, label: string) => (
    <tr key={k}>
      <td className="w-56 whitespace-nowrap py-0.5">{label}</td>
      <td className="w-3">:</td>
      <td className="py-0.5">
        {he ? (
          <input className="w-full border-b border-dotted border-slate-500 bg-sky-50/70 px-1 font-[inherit] text-[13px] font-bold outline-none focus:bg-sky-100" value={String(head[k] ?? "")} onChange={(e) => setH({ [k]: e.target.value } as Partial<SubHead>)} />
        ) : (
          <span className="block border-b border-dotted border-slate-400 px-1">{String(head[k] ?? "") || " "}</span>
        )}
      </td>
    </tr>
  );
  void branch;
  void branchReason;
  const sel2 = "border-b border-dotted border-slate-500 bg-sky-50/70 px-1 font-[inherit] text-[13px] font-bold outline-none";
  const row = (label: string, body: React.ReactNode) => (
    <tr>
      <td className="py-0.5">{label}</td>
      <td>:</td>
      <td className="py-0.5">{body}</td>
    </tr>
  );
  const show = (v: React.ReactNode) => <span className="block border-b border-dotted border-slate-400 px-1">{v || " "}</span>;
  // hợp đồng gợi ý: cùng dự án (nếu dự án đã có hợp đồng), cùng khu vực
  const pKey = head.projectName.trim().toLowerCase();
  const inArea = contracts.filter((c) => !head.area || !c.area || c.area === head.area);
  const sameProj = inArea.filter((c) => (head.siteId && c.siteId ? c.siteId === head.siteId : c.name.trim().toLowerCase() === pKey));
  const hdOptions = (sameProj.length ? sameProj : inArea).concat(cid && !inArea.some((c) => c.id === cid) ? contracts.filter((c) => c.id === cid) : []);
  const curContract = contracts.find((c) => c.id === cid);
  const hdText = curContract ? `${curContract.label}${head.cdtContract && head.cdtContract !== curContract.contractNo ? ` · số HĐ ${head.cdtContract}` : ""}` : head.cdtContract;

  return (
    <div className="space-y-3">
      <FormSheet>
        <FormLetterhead />
        <h1 className="mt-2 text-center text-[20px] font-bold">BẢNG ĐỀ XUẤT KÝ HỢP ĐỒNG THẦU PHỤ</h1>
        <div id="sub-part-A" inert={lockA} className={lockA && needInfo ? "opacity-60" : ""}>
        {needInfo && <h3 className="mt-2 font-bold">A. BẢNG ĐƠN GIÁ ĐỀ XUẤT (thông tin hồ sơ + đơn giá)</h3>}
        <table className="mx-auto mt-2 w-[85%] text-[13px] font-bold">
          <tbody>
            {row(
              "KHU VỰC",
              he ? (
                <select className={`${sel2} ${!head.area ? miss : ""}`} value={head.area} disabled={!!curContract?.area} title={curContract?.area ? "Theo khu vực của hợp đồng" : undefined} onChange={(e) => setH({ area: e.target.value })}>
                  <option value="">— Chọn khu vực —</option>
                  {[...new Set([...areas, ...(head.area ? [head.area] : [])])].map((a) => (
                    <option key={a} value={a}>
                      Khu vực {a}
                    </option>
                  ))}
                </select>
              ) : (
                show(head.area && `Khu vực ${head.area}`)
              ),
            )}
            {row(
              "DỰ ÁN / CÔNG TRÌNH",
              he ? (
                <SitePicker
                  sites={sites}
                  value={head.siteId}
                  area={head.area}
                  className="text-[13px] font-bold"
                  invalid
                  placeholder={head.projectName && !head.siteId ? `Trong file ghi “${head.projectName}” — chọn dự án tương ứng trong danh mục` : undefined}
                  disabled={!!curContract?.siteId}
                  title={curContract?.siteId ? "Theo dự án của hợp đồng đã chọn (bỏ chọn hợp đồng để đổi)" : "Chọn dự án trong Danh mục dự án"}
                  onChange={(s) => setH({ siteId: s?.id ?? "", projectName: s?.name ?? "", projectCode: s?.code || (s ? head.projectCode : ""), ...(s?.area && !head.area ? { area: s.area } : {}) })}
                />
              ) : (
                show(head.projectName)
              ),
            )}
            {headInput("projectCode", "MÃ SỐ DỰ ÁN")}
            {row(
              "HỢP ĐỒNG",
              he ? (
                <span className="flex gap-2">
                  <select className={`min-w-0 flex-1 ${sel2} ${!hdSel ? miss : ""}`} value={hdSel} disabled={pending} onChange={(e) => pickHd(e.target.value)}>
                    <option value="">— Chọn hợp đồng —</option>
                    {hdOptions.length > 0 && (
                      <optgroup label="Hợp đồng đã có DT-CP trên phần mềm">
                        {hdOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Chưa có DT-CP trên phần mềm">
                      <option value="@khac">Nhập số hợp đồng…</option>
                      {CONTRACT_STATES.map((s, i) => (
                        <option key={s} value={`@${i}`}>
                          {s}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  {(hdSel === "@khac" || (curContract && !curContract.contractNo)) && (
                    <input className={`w-56 ${sel2} ${!head.cdtContract.trim() ? miss : ""}`} value={head.cdtContract} onChange={(e) => setH({ cdtContract: e.target.value })} placeholder="Số hợp đồng (bắt buộc)" />
                  )}
                </span>
              ) : (
                show(hdText)
              ),
            )}
            {headInput("itemName", "HẠNG MỤC")}
            <tr>
              <td className="py-0.5">THẦU PHỤ ĐỀ XUẤT KÝ HĐ</td>
              <td>:</td>
              <td className="py-0.5">
                {he ? (
                  <span className="flex gap-2">
                    <select
                      disabled={!qs}
                      title={qs ? undefined : "Thầu phụ được chọn gắn với cột giá duyệt — Trưởng phòng / Quản trị chỉ sửa tên thầu phụ"}
                      className="border-b border-dotted border-slate-500 bg-sky-50/70 px-1 font-[inherit] text-[13px] font-bold outline-none"
                      value={sel}
                      onChange={(e) => setH({ selectedBidder: e.target.value, subName: bidders.find((b) => b.key === e.target.value)?.name ?? head.subName })}
                    >
                      {bidders.map((b) => (
                        <option key={b.key} value={b.key}>
                          {b.key} — {b.name}
                        </option>
                      ))}
                    </select>
                    <input className={`flex-1 border-b border-dotted border-slate-500 bg-sky-50/70 px-1 font-[inherit] text-[13px] font-bold outline-none ${!head.subName.trim() ? miss : ""}`} value={head.subName} onChange={(e) => setH({ subName: e.target.value })} placeholder="Tên thầu phụ ký hợp đồng" />
                  </span>
                ) : (
                  <span className="block border-b border-dotted border-slate-400 px-1">
                    {head.subName} <span className="font-normal">({sel})</span>
                  </span>
                )}
              </td>
            </tr>
            {/* LẦN TRÌNH / NHÁNH: QSĐT tự chọn, phần mềm không đề xuất */}
            {row(
              "LẦN TRÌNH / NHÁNH",
              he ? (
                <span className="flex flex-wrap gap-2">
                  <select className={`${sel2} ${!head.revision ? miss : ""}`} value={head.revision || ""} onChange={(e) => setH({ revision: Number(e.target.value) || 0 })}>
                    <option value="">— Lần trình —</option>
                    {[...Array(Math.max(10, head.revision))].map((_, i) => (
                      <option key={i} value={i + 1}>
                        Lần {i + 1}
                      </option>
                    ))}
                  </select>
                  <select className={`min-w-0 flex-1 ${sel2} ${!head.branch ? miss : ""}`} value={head.branch} onChange={(e) => setH({ branch: e.target.value })}>
                    <option value="">— Nhánh —</option>
                    <option value="A">{BRANCH_LABEL.A}</option>
                    <option value="B">{BRANCH_LABEL.B}</option>
                  </select>
                </span>
              ) : (
                <span className="block border-b border-dotted border-slate-400 px-1">
                  <span className={(head.revision || revision) > 1 ? "text-red-600" : ""}>Lần {head.revision || revision || "?"}</span>
                  {head.branch && (
                    <span className={`ml-3 rounded px-2 py-0.5 font-sans text-xs ${head.branch === "A" ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800"}`}>{BRANCH_LABEL[head.branch]}</span>
                  )}
                </span>
              ),
            )}
            {/* LOẠI ĐỀ XUẤT: ký hợp đồng thầu phụ (HĐTP) hay ký phụ lục (PL) — QSĐT chọn, hiện ở cột "Đề xuất HĐHP/PL" của file tổng hợp */}
            {row(
              "LOẠI ĐỀ XUẤT",
              he ? (
                <select className={sel2} value={head.proposalType} onChange={(e) => setH({ proposalType: e.target.value })}>
                  <option value="">— Chọn loại đề xuất —</option>
                  <option value="HDTP">HĐTP — ký hợp đồng thầu phụ</option>
                  <option value="PL">Ký PL — ký phụ lục</option>
                </select>
              ) : (
                <span className="block border-b border-dotted border-slate-400 px-1">
                  {head.proposalType === "HDTP" ? "HĐTP — ký hợp đồng thầu phụ" : head.proposalType === "PL" ? `Ký PL — ${head.plKind === "DIEU_CHINH" ? "PLHĐ điều chỉnh" : head.plKind === "CONG_GOP" ? "PLHĐ cộng gộp" : "chưa chọn loại phụ lục"}` : "—"}
                </span>
              ),
            )}
            {/* LOẠI PHỤ LỤC: cộng gộp / điều chỉnh (QSĐT chọn khi tải file, sửa lại được) */}
            {head.proposalType === "PL" &&
              row(
                "LOẠI PHỤ LỤC",
                he ? (
                  <select className={`${sel2} ${head.plKind !== "CONG_GOP" && head.plKind !== "DIEU_CHINH" ? miss : ""}`} value={head.plKind} onChange={(e) => setH({ plKind: e.target.value })}>
                    <option value="">— Chọn loại phụ lục —</option>
                    {PL_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="block border-b border-dotted border-slate-400 px-1">{PL_KINDS.find((k) => k.value === head.plKind)?.label ?? "—"}</span>
                ),
              )}
            {/* PHỤ LỤC: chọn HỢP ĐỒNG THẦU PHỤ gốc đã có trên hệ thống HOẶC tự gõ số HĐ (hệ thống đang cập nhật dần) */}
            {head.proposalType === "PL" &&
              row(
                "HỢP ĐỒNG THẦU PHỤ GỐC",
                he ? (
                  <span className="flex gap-2">
                    <select
                      className={`min-w-0 flex-1 ${sel2} ${!head.hdtpId && !(head.hdtpNo ?? "").trim() ? miss : ""}`}
                      value={head.hdtpId ? head.hdtpId : hdtpTyped ? "@khac" : ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "@khac") {
                          setHdtpTyped(true);
                          setH({ hdtpId: "" });
                        } else {
                          setHdtpTyped(false);
                          setH({ hdtpId: v, hdtpNo: "" });
                        }
                      }}
                    >
                      <option value="">— Chọn hợp đồng thầu phụ của phụ lục này —</option>
                      {hdtpOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                      <option value="@khac">✎ Nhập số HĐ thầu phụ (chưa có trên hệ thống)…</option>
                    </select>
                    {hdtpTyped && !head.hdtpId && (
                      <input className={`w-56 ${sel2} ${!(head.hdtpNo ?? "").trim() ? miss : ""}`} placeholder="Số HĐ thầu phụ gốc" {...imeSafe(head.hdtpNo ?? "", (v) => setH({ hdtpNo: v }))} />
                    )}
                  </span>
                ) : (
                  <span className="block border-b border-dotted border-slate-400 px-1">{hdtpOptions.find((o) => o.id === head.hdtpId)?.label ?? chain?.rootLabel ?? ((head.hdtpNo ?? "").trim() ? `Số HĐ ${head.hdtpNo} (nhập tay)` : "—")}</span>
                ),
              )}
            {/* PL CỘNG GỘP + HĐ gõ tay: bắt nhập GIÁ TRỊ HĐ + PL ĐÃ KÝ (trước phụ lục này) để có PLĐC cho file tổng hợp */}
            {signedNeeded(head) &&
              row(
                "GIÁ TRỊ HĐ + PL ĐÃ KÝ *",
                he ? (
                  <span className="flex items-center gap-2">
                    <NumInput allowEmpty allowFormula showZero value={head.signedValue ?? null} onCommit={(v) => setH({ signedValue: v })} className={`w-48 ${sel2} text-right ${head.signedValue == null ? miss : ""}`} />
                    <span className="font-sans text-[11px] font-normal text-slate-500">đ — giá trị HĐ thầu phụ gốc + các phụ lục đã ký trước phụ lục này (sau VAT)</span>
                  </span>
                ) : (
                  <span className="block border-b border-dotted border-slate-400 px-1 text-right">{head.signedValue == null ? "—" : `${fm(head.signedValue)} đ`}</span>
                ),
              )}
            {/* ĐƠN GIÁ: giá tổng hoặc giá chi tiết (vật tư, nhân công, thiết bị) — chọn ở bảng chọn đầu, sửa lại được */}
            {row(
              "ĐƠN GIÁ",
              he ? (
                <select className={sel2} value={head.priceMode || "TONG"} onChange={(e) => setH({ priceMode: e.target.value })}>
                  {PRICE_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="block border-b border-dotted border-slate-400 px-1">{PRICE_MODES.find((m) => m.value === (head.priceMode || "TONG"))?.label}</span>
              ),
            )}
            {/* LOẠI THẦU PHỤ: MEP (cơ điện) có thêm cột Mã hiệu sản phẩm + Nhãn hiệu - xuất xứ */}
            {row(
              "LOẠI THẦU PHỤ",
              he ? (
                <select className={sel2} value={ntm ? "NT" : mepT ? "MEPT" : mep ? "MEP" : ""} onChange={(e) => setH({ isNt: e.target.value === "NT", isMep: e.target.value === "MEP" || e.target.value === "MEPT", mepTemp: e.target.value === "MEPT", ...(e.target.value === "MEPT" ? { priceMode: "CHITIET" } : {}) })}>
                  <option value="">Xây dựng</option>
                  <option value="MEP">MEP (cơ điện — có Mã hiệu sản phẩm, Nhãn hiệu - xuất xứ)</option>
                  <option value="MEPT">MEP TẠM (MEP + thuê vật tư: đơn giá = vật tư × % thuê + nhân công)</option>
                  <option value="NT">NỘI THẤT (Mã SP, hình ảnh, mô tả vật liệu, kích thước; sản phẩm gồm nhiều phần việc)</option>
                </select>
              ) : (
                <span className="block border-b border-dotted border-slate-400 px-1">{ntm ? "Nội thất" : mepT ? "MEP TẠM (thuê vật tư)" : mep ? "MEP (cơ điện)" : "Xây dựng"}</span>
              ),
            )}
            {/* KHỐI LƯỢNG: riêng từng khối hay CHUNG 1 khối lượng (bảng chỉ 1 cột KL) — không áp cho PLHĐ điều chỉnh */}
            {!showHd &&
              row(
                "KHỐI LƯỢNG",
                qs ? (
                  <select className={sel2} value={oneQ ? "1" : ""} onChange={(e) => toggleOneQty(e.target.value === "1")}>
                    <option value="">Riêng từng khối (CĐT / cơ sở / thầu phụ)</option>
                    <option value="1">Chung 1 khối lượng (CĐT = cơ sở = thầu phụ)</option>
                  </select>
                ) : (
                  <span className="block border-b border-dotted border-slate-400 px-1">{oneQ ? "Chung 1 khối lượng (CĐT = cơ sở = thầu phụ)" : "Riêng từng khối"}</span>
                ),
              )}
            {/* HÌNH THỨC GIAO THẦU: giao bao vật tư / giao bao thiết bị / nhân công thuần → bổ sung tổng giá trị vật tư / thiết bị */}
            {row(
              "HÌNH THỨC GIAO THẦU",
              he || rv ? (
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <select disabled={!he} title={he ? undefined : "Hình thức giao thầu do QSĐT / QSTT chọn; Trưởng phòng / Phó Tổng sửa được các tổng giá trị bên cạnh"} className={`${sel2} ${!head.awardForm ? miss : ""}`} value={head.awardForm} onChange={(e) => setH({ awardForm: e.target.value })}>
                    <option value="">— Chọn hình thức giao thầu —</option>
                    {AWARD_FORMS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  {/* 3 ô luôn sửa được ở mọi bước QSĐT / QSTT (dấu * = bắt buộc theo hình thức giao thầu) */}
                  <label className="flex items-center gap-1 font-sans text-[12px] font-normal">
                    Tổng giá trị vật tư (đ){needForm.includes("vt") ? " *" : ""}
                    <NumInput allowEmpty allowFormula showZero value={head.vtValue} onCommit={(v) => setH({ vtValue: v })} className={`w-40 ${sel2} text-right ${needForm.includes("vt") && head.vtValue == null ? miss : ""}`} />
                  </label>
                  <label className="flex items-center gap-1 font-sans text-[12px] font-normal">
                    Tổng giá trị thiết bị (đ){needForm.includes("tb") ? " *" : ""}
                    <NumInput allowEmpty allowFormula showZero value={head.tbValue} onCommit={(v) => setH({ tbValue: v })} className={`w-40 ${sel2} text-right ${needForm.includes("tb") && head.tbValue == null ? miss : ""}`} />
                  </label>
                  <label className="flex items-center gap-1 font-sans text-[12px] font-normal">
                    Chi phí khác (đ)
                    <NumInput allowEmpty allowFormula showZero value={head.otherValue ?? null} onCommit={(v) => setH({ otherValue: v })} className={`w-40 ${sel2} text-right`} />
                  </label>
                </span>
              ) : (
                <span className="block border-b border-dotted border-slate-400 px-1">
                  {AWARD_FORMS.find((f) => f.value === head.awardForm)?.label ?? "—"}
                  {vtVal > 0 && ` · Vật tư: ${fm(vtVal)} đ`}
                  {tbVal > 0 && ` · Thiết bị: ${fm(tbVal)} đ`}
                  {otherVal > 0 && ` · Chi phí khác: ${fm(otherVal)} đ`}
                </span>
              ),
            )}
          </tbody>
        </table>

        {!qs && headEdit && (
          <div className="mx-auto mt-1 flex w-[85%] flex-wrap items-center gap-2 font-sans text-[12px] text-slate-600">
            <span>✎ {rv ? "Trưởng phòng" : "Quản trị"} sửa được thông tin đầu hồ sơ khi QSĐT / QSTT ghi sai — không ảnh hưởng giá duyệt.</span>
            <span className="flex-1" />
            <button type="button" disabled={pending || !headDirty} onClick={() => start(async () => { if (await saveHeadInfo()) router.refresh(); })} className={`rounded px-3 py-1 font-medium text-white disabled:opacity-50 ${headDirty ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-500"}`}>
              {headDirty ? "💾 Lưu thông tin hồ sơ *" : "Lưu thông tin hồ sơ"}
            </button>
          </div>
        )}
        {qs && <BidderCols id={id} bidders={bidders} disabled={pending} save={() => saveSubDraftAction(id, ...payload())} />}
        {/* GHI CHÚ thầu phụ được duyệt (khối ĐỀ XUẤT DUYỆT bỏ khi trùng giá 1 thầu phụ) */}
        {bidders.some((b) => awardKeys.includes(b.key)) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-sans text-[12px] text-emerald-900">
            <b>✔ ĐỀ XUẤT DUYỆT:</b>
            {multiAward ? (
              <span>duyệt nhiều thầu phụ — {awards.map((a) => `${bidders.find((b) => b.key === a.key)?.name ?? a.key} (${a.pct}%)`).join(" + ")} (các cột tô xanh).</span>
            ) : (
              <span>
                thầu phụ <b>{dName} ({sel})</b>
                {hideD
                  ? rv ? " — khối lượng, đơn giá duyệt lấy theo thầu phụ này (cột tô xanh). Trưởng phòng / Phó Tổng sửa trực tiếp đơn giá trên cột này." : " — khối lượng, đơn giá duyệt lấy theo thầu phụ này (cột tô xanh). Đã ẩn khối Đề xuất duyệt cho gọn."
                  : hideBid
                    ? bidEmpty
                      ? " — cột thầu phụ không có số liệu báo giá nên đã ẩn; khối lượng, đơn giá đề xuất duyệt nằm ở khối ĐỀ XUẤT DUYỆT."
                      : " — đã gộp cột thầu phụ vào khối ĐỀ XUẤT DUYỆT cho gọn (giá trùng nhau)."
                    : canMerge
                      ? " — đang hiện riêng cột thầu phụ và khối Đề xuất duyệt."
                      : " được chọn — có dòng giá / khối lượng đề xuất duyệt khác giá thầu phụ báo, xem khối ĐỀ XUẤT DUYỆT (D)."}
              </span>
            )}
            {canMerge && (
              <button type="button" onClick={() => setForceD((v) => !v)} className="ml-auto rounded border border-emerald-400 bg-white px-2 py-0.5 text-[11px] font-medium hover:bg-emerald-100">
                {plAdj || bidEmpty ? (hideBid ? "Hiện lại cột thầu phụ" : "Gộp cột thầu phụ vào Đề xuất duyệt") : hideD ? "Hiện khối Đề xuất duyệt" : "Ẩn khối Đề xuất duyệt"}
              </button>
            )}
          </div>
        )}
        {dtcpPanel && (
          <div className="mt-2 flex items-center justify-end gap-2 font-sans text-[12px] text-slate-500">
            <span>Dò, đối chiếu đơn giá với DT-CP hợp đồng:</span>
            {dtcpPanel}
          </div>
        )}
        <ExcelGrid cols={qs ? (oneName && !ntm ? gridCols.filter((k) => k !== "workName") : gridCols) : rv ? ["tpPrice", "tpNote"] : []} refCols={xlCols} onPaste={qs || rv ? pasteGrid : undefined} xl={xlApi} rowOps={qs ? { insert: insertLines, remove: removeLines } : undefined} notes={cellNotes} widthKey={ntm ? "thau-phu-nt" : "thau-phu"}>
          {/* nội thất: 3 cột STT · Mã SP · Hạng mục đứng yên khi kéo ngang (ảnh, vật liệu, kích thước cuộn theo bảng) */}
          <div className={`xfreeze ${ntm ? "xfreeze-3" : "xfreeze-5"} mt-3`} style={ntm ? ({ "--fz1": "34px", "--fz2": "80px", "--fz3": "220px", "--fzh": "130px" } as React.CSSProperties) : ({ "--fz1": "34px", "--fz2": oneName ? "0px" : "110px", "--fz3": "240px", "--fz4": mep ? "120px" : "60px", "--fz5": mep ? "130px" : "48px", "--fzh": "130px" } as React.CSSProperties)}>
          <table className="tmn-grid xl-lines text-[12px]" style={{ width: tableW, minWidth: tableW, tableLayout: "fixed" }}>
            <colgroup>
              {colW.map((w, i) => (
                <col key={i} style={{ width: w, ...(colHidden(i) ? { visibility: "collapse" as const } : {}), ...(awardRanges.some(([a, b]) => i >= a && i < b) ? { background: "rgba(16,185,129,0.13)" } : {}) }} />
              ))}
            </colgroup>
            <thead className="text-center font-bold">
              <tr>
                <th rowSpan={hrs}>STT</th>
                {ntm ? (
                  <>
                    {/* NỘI THẤT — theo mẫu: STT | MÃ SẢN PHẨM | HẠNG MỤC CÔNG VIỆC | HÌNH ẢNH | MÔ TẢ VẬT LIỆU | KÍCH THƯỚC (DÀI, RỘNG, CAO) | ĐVT */}
                    <th rowSpan={hrs}>MÃ SẢN PHẨM</th>
                    <th rowSpan={hrs}>HẠNG MỤC CÔNG VIỆC</th>
                    <th rowSpan={hrs}>HÌNH ẢNH</th>
                    <th rowSpan={hrs}>MÔ TẢ VẬT LIỆU</th>
                    <th colSpan={3}>KÍCH THƯỚC (mm)</th>
                    <th rowSpan={hrs}>ĐVT</th>
                  </>
                ) : (
                  <>
                    <th rowSpan={hrs}>HẠNG MỤC CÔNG VIỆC</th>
                    <th rowSpan={hrs}>NỘI DUNG CÔNG VIỆC</th>
                    <th rowSpan={hrs}>{mep ? "MÃ HIỆU SẢN PHẨM" : "MÃ SP"}</th>
                  </>
                )}
                {ntm ? null : mep ? (
                  <>
                    <th rowSpan={hrs}>NHÃN HIỆU - XUẤT XỨ</th>
                    <th rowSpan={hrs}>ĐVT</th>
                  </>
                ) : (
                  <th rowSpan={hrs}>ĐVT</th>
                )}
                {oneQ && <th rowSpan={hrs} title="Khối lượng dùng chung cho chủ đầu tư, giá cơ sở và thầu phụ">KHỐI LƯỢNG</th>}
                <th colSpan={showHd ? 7 : (cdtComp ? SIX.length : 3) - (oneQ ? 1 : 0)}>CHỦ ĐẦU TƯ (A)</th>
                <th colSpan={showHd ? (showCt ? TEN.length + 1 : 8) : (showCt ? SIX.length + 1 : 4) - (oneQ ? 1 : 0)} className="bg-violet-100">ĐƠN GIÁ CƠ SỞ (B) (THEO DT-CP HỢP ĐỒNG)</th>
                {bidders.map((b) => (
                  <th key={b.key} colSpan={(showCt ? SIX.length : 3) - (oneQ ? 1 : 0)} className={awardKeys.includes(b.key) ? (hideD || multiAward ? "!bg-emerald-300" : "bg-sky-100") : ""}>
                    {b.name} ({b.key})
                    {awardKeys.includes(b.key) && <span className="block text-[10px] font-semibold text-emerald-900">{hideD ? (rv && b.key === apprCol ? "✔ ĐỀ XUẤT DUYỆT — TP / Phó Tổng sửa trực tiếp đơn giá" : "✔ ĐỀ XUẤT DUYỆT") : multiAward ? `✔ DUYỆT ${awards.find((a) => a.key === b.key)?.pct ?? 0}%` : "✔ thầu phụ được chọn"}</span>}
                  </th>
                ))}
                {hideD ? (
                  miniD ? (
                    <th colSpan={2} className="bg-emerald-100" title="Đơn giá duyệt = đơn giá thầu phụ được duyệt; Trưởng phòng / Phó Tổng sửa trực tiếp ở cột này (chữ xanh = đã sửa)">
                      DUYỆT{dName && <span className="block text-[11px] font-semibold">{dName}</span>}<span className="block text-[10px] font-normal">TP / Phó Tổng sửa trực tiếp đơn giá</span>
                    </th>
                  ) : null
                ) : (
                  <th colSpan={showHd ? (showCt ? TEN.length : 7) : (showCt ? SIX.length : 3) - (oneQ ? 1 : 0)} className={rv ? "bg-emerald-100" : "bg-sky-100"} title="Trưởng phòng / Phó Tổng duyệt và sửa trực tiếp trên giá trình (chữ xanh = đã sửa)">
                    ĐỀ XUẤT DUYỆT{hideBid ? " ✔" : " (D)"}
                    {dName && <span className="block text-[11px] font-semibold">Thầu phụ: {dName}{hideBid && sel ? ` (${sel})` : ""}</span>}
                    {rv && <span className="block text-[10px] font-normal">TP / Phó Tổng sửa trực tiếp đơn giá</span>}
                  </th>
                )}
                {multiAward && (
                  <th rowSpan={hrs} className="bg-emerald-200" title="Duyệt nhiều thầu phụ: tổng thành tiền của các thầu phụ được duyệt = Σ (% khối lượng × KL × đơn giá từng thầu phụ)">
                    THÀNH TIỀN TỔNG DUYỆT<span className="block text-[10px] font-normal">Σ các thầu phụ được duyệt</span>
                  </th>
                )}
                <th rowSpan={hrs}>GHI CHÚ</th>
                <th rowSpan={hrs} className="bg-sky-100">
                  Ghi chú QSTT
                  <br />
                  Lý do vượt DT-CP
                </th>
                <th rowSpan={hrs} className="bg-emerald-100">Ý kiến TP / Phó Tổng</th>
              </tr>
              <tr>
                {ntm && ["DÀI", "RỘNG", "CAO"].map((h) => <th key={h} rowSpan={hrs - 1}>{h}</th>)}
                {showHd ? hdGroup("", false) : cdtComp ? SIXq.map((h) => <th key={`A-${h}`}>{h}</th>) : (
                  <>
                    {!oneQ && <th>KL</th>}
                    <th>ĐƠN GIÁ</th>
                    <th>THÀNH TIỀN</th>
                  </>
                )}
                {showHd ? hdGroup("bg-violet-100", showCt) : (showCt ? SIXq : THREEq).map((h) => (
                  <th key={h} className="bg-violet-100">
                    {h}
                  </th>
                ))}
                <th rowSpan={showHd ? 2 : 1} className="bg-violet-100">GHI CHÚ</th>
                {bidders.flatMap((b) => (showCt ? SIXq : THREEq).map((h) => <th key={`${b.key}-${h}`} rowSpan={showHd ? 2 : 1}>{h}</th>))}
                {hideD ? (
                  miniD ? (
                    <>
                      <th className="bg-emerald-50">ĐƠN GIÁ DUYỆT</th>
                      <th className="bg-emerald-50">THÀNH TIỀN DUYỆT</th>
                    </>
                  ) : null
                ) : showHd ? hdGroup(rv ? "bg-emerald-50" : "bg-sky-50", showCt) : (showCt ? SIXq : THREEq).map((h) => (
                  <th key={h} className={rv ? "bg-emerald-50" : "bg-sky-50"}>
                    {h}
                  </th>
                ))}
              </tr>
              {showHd && (
                <tr>
                  {hdSub("", false)}
                  {hdSub("bg-violet-100", showCt)}
                  {hdSub(rv ? "bg-emerald-50" : "bg-sky-50", showCt)}
                </tr>
              )}
              {/* chữ cột A, B, C... như Excel (để gõ công thức, xem tên ô ở thanh công thức) */}
              <tr className="text-[9px] text-slate-400">
                {xlCols.map((k, n) => (
                  <th key={k} className="!py-0 font-normal">
                    {colLetter(n)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => ntWrap(l, i, (() => {
                if (l.level === "SP") return spRow(l, i);
                if (!isPartLevel(l.level)) {
                  const g = calc.group[i] ?? {};
                  return (
                    <tr key={l.id} className={`group ${l.level === "GROUP" ? "bg-yellow-100 font-bold" : "bg-yellow-200 font-bold"}`} title={l.noMgmt ? "Cả nhóm KHÔNG tính chi phí quản lý" : undefined}>
                      {/* đầu mục (A, I, 1...): QSĐT / QSTT sửa được STT, hạng mục, nội dung */}
                      {qs ? (
                        <td className="relative p-0" {...xcell(l.id, "stt")}>
                          <input className={`${cellIn} text-center font-bold`} {...imeSafe(l.stt, (v) => setL(l.id, { stt: v }))} />
                          {rowTools(l, i)}
                        </td>
                      ) : (
                        <td className="text-center">{l.stt}</td>
                      )}
                      {/* 3 cột đầu đứng yên khi kéo ngang → KHÔNG gộp ô (colSpan) qua cột đứng yên, tránh che chữ / lệch dòng */}
                      {qs && !ntm ? txt(l, "workName", { multi: true, cls: "font-bold" }) : <td />}
                      {qs ? txt(l, "content", { multi: true, cls: "font-bold", ph: l.workName ? "" : "Tên đầu mục" }) : <td>{l.content || l.workName}</td>}
                      <td colSpan={padN + (oneQ ? 1 : 0)} />
                      {showHd ? <FragTd wide x={{ row: l.id, v: "cdtAmount", hd: "cdtHdAmount", pl: "cdtPlAmount" }} v={fm(g.A)} hd={fm(g.AH)} pl={fm((g.A ?? 0) - (g.AH ?? 0))} /> : <FragTd mini={oneQ} comp={cdtComp} n={nComp} x={{ row: l.id, v: "cdtAmount" }} v={fm(g.A)} />}
                      {showHd ? <FragTd comp={showCt} n={nComp} wide x={{ row: l.id, v: "baseAmount", hd: "baseHdAmount", pl: "basePlAmount" }} v={fm(g.B)} hd={fm(g.BH)} pl={fm((g.B ?? 0) - (g.BH ?? 0))} /> : <FragTd mini={oneQ} comp={showCt} n={nComp} x={{ row: l.id, v: "baseAmount" }} v={fm(g.B)} />}
                      <td />
                      {bidders.map((b) => (
                        <FragTd mini={oneQ} comp={showCt} n={nComp} key={b.key} x={{ row: l.id, v: b.key === apprCol ? "apprAmount" : `ba:${b.key}` }} v={fm(b.key === apprCol ? g.R : g[b.key])} />
                      ))}
                      {showHd ? <FragTd comp={showCt} n={nComp} wide x={{ row: l.id, v: qs ? "propAmount" : "apprAmount", hd: "hdAmount", pl: "plAmount" }} v={fm(qs ? g.D : g.R)} hd={fm(g.H)} pl={fm((qs ? g.D : g.R) - (g.H ?? 0))} /> : hideD ? null : <FragTd mini={hideD || oneQ} comp={showCt && !hideD} n={nComp} x={{ row: l.id, v: qs ? "propAmount" : "apprAmount" }} v={fm(qs ? g.D : g.R)} />}
                      {multiAward && <td className="num" {...xcell(l.id, "sTotal")}>{fm(g.S)}</td>}
                      <td />
                      <td />
                      <td />
                    </tr>
                  );
                }
                const low = lowest(l);
                const ref = refMap.get(l.lineKey);
                const base1 = baseOf(l);
                // NỘI THẤT — phần việc khác (REF): chỉ tham khảo; đã duyệt ở hồ sơ khác thì giá theo hồ sơ đó (không sửa được), chưa thì giá dự kiến
                const isRef = l.level === "REF";
                const ra = isRef ? ntCtx.refAppr[l.id] : undefined;
                const pp = ra ? ra.price : propPriceOf(l, sel);
                const overPrice = !isRef && pp != null && base1 != null && pp > base1 + 0.5;
                // vượt KL DT-CP: lũy kế các hồ sơ trước + hồ sơ này > khối lượng DT-CP (như giá đội)
                const qtyNow = propQtyOf(l, sel);
                const cum = ref && qtyNow != null ? ref.prevQty + qtyNow : null;
                const overQty = !isRef && !!ref && ref.qty != null && cum != null && cum > ref.qty + 1e-6;
                const over = overPrice || overQty;
                // TÔ MÀU THEO ĐIỀU KIỆN: giá đề xuất / duyệt cao hơn giá CĐT → nền cam (lỗ so với giá bán cho CĐT)
                const cdtP = l.cdtPrice;
                const overCdt = l.level === "ITEM" && cdtP != null && cdtP > 0 && pp != null && pp > cdtP + 0.5;
                const cdtWarn = overCdt ? { title: "Giá đề xuất CAO HƠN giá CĐT" } : {};
                // nội dung phần mềm tự ghi ở cột Ghi chú của khối cơ sở (người dùng gõ ghi chú riêng thì dùng ghi chú đó)
                // luôn hiện đơn giá DT-CP (TĐ1) của dòng đã khớp + so với đơn giá cơ sở đang hiện: Khớp / Cao hơn / Thấp hơn DT-CP = <giá DT-CP>
                const dtP = ref?.base1 ?? null;
                const cmp = ref && dtP != null && base1 != null ? (Math.abs(base1 - dtP) < 0.5 ? "eq" : base1 > dtP ? "hi" : "lo") : null;
                const autoText = ref
                  ? dtP == null
                    ? "Khớp DT-CP (DT-CP chưa có đơn giá)"
                    : `${cmp === "hi" ? "Cao hơn" : cmp === "lo" ? "Thấp hơn" : cmp === "eq" ? "Khớp" : ""} DT-CP = ${fm(dtP)}`.trim()
                  : l.lineKey === "-"
                    ? "Ngoài DT-CP (đơn giá mới)"
                    : "Chưa khớp DT-CP";
                const autoCls = ref ? (cmp === "hi" ? "font-semibold text-red-600" : cmp === "lo" ? "font-semibold text-blue-700" : "font-semibold text-emerald-700") : l.lineKey === "-" ? "text-slate-500" : "text-amber-700";
                const changed = !isRef && l.tpPrice != null && pp != null && Math.abs(l.tpPrice - pp) > 0.5;
                return (
                  <tr key={l.id} className={`group ${isRef ? "bg-slate-100/80 italic text-slate-500" : !l.tpOk ? "bg-red-50" : skipFlags[i] ? "bg-orange-50" : l.added ? "bg-emerald-50/60" : ""}`} title={isRef ? "Phần việc khác — không trình lần này (chỉ tham khảo, không cộng tổng, không duyệt)" : skipFlags[i] ? "KHÔNG tính chi phí quản lý" : undefined}>
                    {/* QSĐT / QSTT sửa được MỌI ô: STT, hạng mục, nội dung, mã SP, ĐVT, kích thước, khối CĐT, cơ sở (DT-CP), từng thầu phụ, đề xuất, ghi chú */}
                    {qs ? (
                      <td className="relative p-0" title={l.added ? "Dòng thêm trên phần mềm (không có trong file)" : undefined} {...xcell(l.id, "stt")}>
                        <input className={`${cellIn} text-center`} placeholder={l.added ? "+" : ""} {...imeSafe(l.stt, (v) => setL(l.id, { stt: v }))} />
                        {rowTools(l, i)}
                      </td>
                    ) : (
                      <td className="text-center" title={l.added ? "Dòng thêm trên phần mềm (không có trong file)" : undefined}>
                        {l.stt}
                        {l.added && !l.stt && <span className="text-emerald-700">+</span>}
                      </td>
                    )}
                    {ntm ? (
                      ntLead(l, false)
                    ) : (
                      <>
                        {txt(l, "workName", { multi: true })}
                        {txt(l, "content", { multi: true, ph: "Nội dung công việc", miss: qs && !l.content.trim() })}
                        {txt(l, "code", { multi: true, cls: "text-center text-[11px]", tdCls: "text-center text-[11px]" })}
                        {/* MEP: Nội dung → Mã hiệu SP → Nhãn hiệu - xuất xứ → ĐVT (không có Kích thước) */}
                        {mep && txt(l, "origin", { multi: true, cls: "text-[11px]", tdCls: "text-[11px]" })}
                        {txt(l, "unit", { cls: "text-center", tdCls: "text-center", miss: qs && !l.unit.trim() })}
                      </>
                    )}
                    {oneQ && numTd(l, "cdtQty", l.cdtQty, "q", { cls: "font-semibold", tdCls: "font-semibold", title: "Khối lượng chung: chủ đầu tư = giá cơ sở = thầu phụ" })}
                    {/* ---- CHỦ ĐẦU TƯ (A) ---- */}
                    {showHd ? (
                      <>
                        {numTd(l, "cdtHdQty", l.cdtHdQty, "q", { cls: "!text-black", tdCls: "text-black" })}
                        {numTd(l, "cdtQty", l.cdtQty, "q", { cls: "!text-black", tdCls: "text-black" })}
                        {numTd(l, "cdtHdPrice", l.cdtHdPrice, "m", { cls: "!text-black", tdCls: "text-black" })}
                        {numTd(l, "cdtPrice", l.cdtPrice, "m", diffPrice(l.cdtPrice, l.cdtHdPrice) ? { cls: "!text-red-600 font-semibold", tdCls: "text-red-600 font-semibold" } : { cls: "!text-black", tdCls: "text-black" })}
                        <td className="num" {...xcell(l.id, "cdtHdAmount")}>{fm(amt(l.cdtHdQty, l.cdtHdPrice))}</td>
                        <td className="num" {...xcell(l.id, "cdtAmount")}>{fm(amt(l.cdtQty, l.cdtPrice))}</td>
                        <td className="num bg-orange-50/60 font-bold text-blue-700" {...xcell(l.id, "cdtPlAmount")}>{fm((amt(l.cdtQty, l.cdtPrice) ?? 0) - (amt(l.cdtHdQty, l.cdtHdPrice) ?? 0))}</td>
                      </>
                    ) : (
                      <>
                        {!oneQ && numTd(l, "cdtQty", l.cdtQty, "q")}
                        {cdtComp && (
                          <>
                            {numTd(l, "cdtVt", l.cdtVt, "m", { zero: true })}
                            {numTd(l, "cdtNc", l.cdtNc, "m", { zero: true })}
                            {mepT && numTd(l, "cdtKh", l.cdtKh, "m", { zero: true, pct: true })}
                          </>
                        )}
                        {numTd(l, "cdtPrice", l.cdtPrice, "m")}
                        <td className="num" {...xcell(l.id, "cdtAmount")}>{fm(amt(l.cdtQty, l.cdtPrice))}</td>
                      </>
                    )}
                    {/* ---- ĐƠN GIÁ CƠ SỞ (B) = đơn giá TĐ1 của dòng TH Thầu Phụ tự khớp; chưa khớp thì giá trong file ---- */}
                    {(() => {
                      const bPrice = numTd(l, "basePrice", base1, "m", {
                        cls: `${showHd && diffPrice(base1, l.baseHdPrice) ? "!text-red-600 font-semibold " : ""}${ref && !l.baseManual ? "!bg-violet-50/70 font-semibold" : ""} ${l.baseManual ? "text-blue-700" : ""} ${overPrice ? "font-bold !text-red-600" : ""}`,
                        tdCls: `${showHd && diffPrice(base1, l.baseHdPrice) ? "text-red-600 " : ""}${ref ? "bg-violet-50/60 font-semibold" : ""} ${overPrice ? "font-bold text-red-600" : ""}`,
                        title: l.baseManual ? "Đơn giá cơ sở do người dùng tự nhập (xoá trống để quay về giá DT-CP)" : ref ? `Theo DT-CP: ${ref.name} (${ref.unit}) — sửa số để tự nhập giá cơ sở` : undefined,
                      });
                      // giá chi tiết: 3 cột đơn giá vật tư | nhân công | thiết bị của khối cơ sở (gõ thành phần thì đơn giá cơ sở = tổng, tính là cơ sở nhập tay)
                      const bCompCells = showCt ? (
                        <>
                          {numTd(l, "baseVt", l.baseVt, "m", { zero: true })}
                          {numTd(l, "baseNc", l.baseNc, "m", { zero: true })}
                          {!noTb && numTd(l, "baseTb", l.baseTb, "m", { zero: true, pct: mepT })}
                        </>
                      ) : null;
                      return showHd ? (
                        <>
                          {numTd(l, "baseHdQty", l.baseHdQty, "q", { cls: "!text-black", tdCls: "text-black" })}
                          {numTd(l, "baseQty", l.baseQty, "q", { cls: "!text-black", tdCls: "text-black" })}
                          {numTd(l, "baseHdPrice", l.baseHdPrice, "m", { cls: "!text-black", tdCls: "text-black" })}
                          {bCompCells}
                          {bPrice}
                          <td className="num" {...xcell(l.id, "baseHdAmount")}>{fm(amt(l.baseHdQty, l.baseHdPrice))}</td>
                          <td className="num" {...xcell(l.id, "baseAmount")}>{fm(amt(l.baseQty, base1))}</td>
                          <td className="num bg-orange-50/60 font-bold text-blue-700" {...xcell(l.id, "basePlAmount")}>{fm((amt(l.baseQty, base1) ?? 0) - (amt(l.baseHdQty, l.baseHdPrice) ?? 0))}</td>
                        </>
                      ) : (
                        <>
                          {!oneQ && numTd(l, "baseQty", l.baseQty, "q")}
                          {bCompCells}
                          {bPrice}
                          <td className="num" {...xcell(l.id, "baseAmount")}>{fm(amt(l.baseQty, base1))}</td>
                        </>
                      );
                    })()}
                    {/* ghi chú khối cơ sở: để trống thì phần mềm tự ghi Đã khớp / Chưa khớp (nhận diện DT-CP có thể sai → sửa tay được); cảnh báo vượt luôn hiện */}
                    <td className={qs ? "p-0 align-top" : "text-[11px]"} {...(qs ? xcell(l.id, "baseNote") : {})} title={ref ? `Dòng DT-CP: ${ref.name} (${ref.unit})${dtP != null ? ` — đơn giá TĐ1 ${fm(dtP)}` : ""}` : undefined}>
                      {/* trạng thái khớp DT-CP luôn hiện (dòng đầu); ghi chú người dùng gõ nằm bên dưới */}
                      {l.level === "ITEM" && !isRef && <span className={`block px-1 text-[11px] ${autoCls}`}>{autoText}</span>}
                      {qs ? (
                        <textarea rows={1} style={{ fieldSizing: "content" } as React.CSSProperties} className={`${cellIn} block resize-none overflow-hidden whitespace-pre-wrap break-words text-[11px]`} placeholder="" {...imeSafe(l.baseNote, (v) => setL(l.id, { baseNote: v }))} />
                      ) : (
                        l.baseNote.trim() && <span className="block px-1">{l.baseNote}</span>
                      )}
                      <span className="block px-1 text-[11px]">
                        {/* NỘI THẤT: phần việc khác — nguồn giá đang dùng để cộng giá trị cả sản phẩm */}
                        {isRef && (
                          <span className="block not-italic font-semibold text-slate-600">
                            ○ Phần việc khác — không trình lần này
                            {ra ? (
                              <span className="block font-normal text-emerald-700">
                                Đã duyệt ở <a href={`/gia-doi/thau-phu/${ra.proposalId}`} target="_blank" rel="noreferrer" className="underline">{ra.code}</a>
                                {ra.sub ? ` · ${ra.sub}` : ""}: {fq(ra.qty)} × {fm(ra.price)} = {fm(amt(...refQP(l)))}
                              </span>
                            ) : (
                              <span className="block font-normal text-amber-700">Chưa duyệt — giá dự kiến{pp != null ? `: ${fq(propQtyOf(l, sel))} × ${fm(pp)} = ${fm(amt(...refQP(l)))}` : " (nhập ở khối đề xuất)"}</span>
                            )}
                          </span>
                        )}
                        {l.baseManual && <span className="block text-blue-700">Giá cơ sở nhập tay</span>}
                        {overPrice && <span className="block font-semibold text-red-600">⚠ Vượt giá cơ sở</span>}
                        {overQty && ref && (
                          <span className="block font-semibold text-red-600">
                            ⚠ Vượt KL DT-CP ({fq(cum)} / {fq(ref.qty)})
                          </span>
                        )}
                      </span>
                      {(qs || rv) && contractId && l.level === "ITEM" && (
                        <div className="px-1 pb-1 text-[11px]">
                          <button
                            type="button"
                            className="text-blue-700 underline decoration-dotted hover:text-blue-900"
                            onClick={() => {
                              setMatchQ("");
                              setMatchRow(matchRow === l.id ? null : l.id);
                            }}
                          >
                            {ref ? "Đổi khớp" : "Chọn khớp DT-CP"}
                          </button>
                          {matchRow === l.id && (
                            <div className="mt-1 space-y-1 rounded border border-blue-200 bg-blue-50/60 p-1.5">
                              <input value={matchQ} onChange={(e) => setMatchQ(e.target.value)} placeholder="Gõ tên công tác DT-CP để tìm…" className="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] outline-none" />
                              {candidatesOf(l).map(({ r }) => (
                                <button key={r.key} type="button" disabled={pending} onClick={() => pickMatch(l, r.key)} className={`block w-full rounded border bg-white px-1.5 py-1 text-left hover:bg-emerald-50 ${r.key === l.lineKey ? "border-emerald-500" : "border-slate-200"}`} title="Bấm để chọn khớp dòng DT-CP này">
                                  <span className="block font-medium text-slate-800">{r.name}</span>
                                  <span className="block text-slate-600">
                                    {r.unit} · KL DT-CP {fq(r.qty)} · <b className="text-violet-800">Đơn giá DT-CP (TĐ1) {fm(r.base1)}</b>
                                  </span>
                                </button>
                              ))}
                              {!candidatesOf(l).length && <div className="text-slate-500">Không thấy dòng DT-CP nào giống — gõ tên khác vào ô tìm, hoặc chọn &ldquo;Ngoài DT-CP&rdquo;.</div>}
                              <div className="flex gap-1.5">
                                <button type="button" disabled={pending} onClick={() => pickMatch(l, "-")} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 hover:bg-slate-100">
                                  Ngoài DT-CP
                                </button>
                                {(ref || l.lineKey === "-") && (
                                  <button type="button" disabled={pending} onClick={() => pickMatch(l, "")} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 hover:bg-slate-100">
                                    Bỏ khớp
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    {/* ---- từng thầu phụ báo giá (C1, C2...): KL, đơn giá sửa được; thành tiền tự tính ---- */}
                    {bidders.map((b) => {
                      const bd = l.bids[b.key];
                      const bcls = `${b.key === low ? "bg-emerald-50 font-bold text-emerald-800" : ""} ${b.key === sel ? "ring-1 ring-inset ring-sky-400" : ""}`;
                      return (
                        <Fragment key={b.key}>
                          {!oneQ && numTd(l, `bq:${b.key}`, bd?.qty ?? null, "q")}
                          {showCt && (
                            <>
                              {numTd(l, `bv:${b.key}`, bd?.vt ?? null, "m", { zero: true })}
                              {numTd(l, `bn:${b.key}`, bd?.nc ?? null, "m", { zero: true })}
                              {!noTb && numTd(l, `bt:${b.key}`, bd?.tb ?? null, "m", { zero: true, pct: mepT })}
                            </>
                          )}
                          {b.key === apprCol ? (
                            rv ? (
                              <td className="p-0" {...xcell(l.id, "tpPrice")} title={changed ? `Giá thầu phụ báo: ${fm(pp)}` : "Sửa trực tiếp đơn giá duyệt (để trống = đồng ý giá thầu phụ)"}>
                                <NumInput decimals allowEmpty allowFormula value={l.tpPrice} placeholder={fm(pp)} {...nProps(l, "tpPrice")} className={`${cellIn} !bg-emerald-50/70 text-right font-bold ${changed ? "text-blue-700" : over ? "text-red-600" : ""}${fProps(l, "tpPrice").fx}`} />
                              </td>
                            ) : (
                              <td className={`num font-bold ${changed ? "text-blue-700" : overPrice ? "text-red-600" : ""}`} {...xcell(l.id, "tpPrice")} title={changed ? `Giá thầu phụ báo: ${fm(pp)} — TP / Phó Tổng đã sửa` : undefined}>
                                {fm(apprPriceOf(l, sel))}
                                {changed && <span className="block text-[10px] font-normal text-slate-400 line-through">{fm(pp)}</span>}
                              </td>
                            )
                          ) : (
                            numTd(l, `bp:${b.key}`, bd?.price ?? null, "m", { cls: b.key === low ? "!bg-emerald-50 font-bold text-emerald-800" : b.key === sel ? "ring-1 ring-inset ring-sky-400" : "", tdCls: bcls, zero: showCt })
                          )}
                          {b.key === apprCol ? (
                            <td className="num font-bold" {...xcell(l.id, "apprAmount")}>{fm(amt(propQtyOf(l, sel), apprPriceOf(l, sel)))}</td>
                          ) : (
                            <td className="num" {...xcell(l.id, `ba:${b.key}`)}>{fm(amt(bd?.qty ?? null, bd?.price ?? null))}</td>
                          )}
                        </Fragment>
                      );
                    })}
                    {(() => {
                      const dRed = showHd && diffPrice(qs ? pp : apprPriceOf(l, sel), l.hdPrice); // đơn giá điều chỉnh khác đơn giá hợp đồng → chữ đỏ
                      // phần việc khác (REF): đã duyệt ở hồ sơ khác → hiện giá duyệt (khoá); chưa duyệt → QSĐT / QSTT nhập giá dự kiến, người khác chỉ xem
                      const refStatic = isRef && (!!ra || !qs);
                      const dQty = refStatic ? (
                        <td className="num">{fq(refQP(l)[0])}</td>
                      ) : qs ? (
                        <td className="p-0" {...xcell(l.id, "propQty")}>
                          <NumInput decimals allowEmpty allowFormula value={l.propQty} placeholder={fq(l.bids[sel]?.qty ?? l.baseQty ?? l.cdtQty)} {...nProps(l, "propQty")} className={`${cellIn} text-right${fProps(l, "propQty").fx}`} />
                        </td>
                      ) : (
                        <td className="num">{fq(propQtyOf(l, sel))}</td>
                      );
                      const dPrice = refStatic ? (
                        <td className={`num ${ra ? "text-emerald-700" : ""}`} title={ra ? `Giá đã duyệt ở hồ sơ ${ra.code}` : "Giá dự kiến (chưa duyệt)"}>
                          {fm(pp)}
                        </td>
                      ) : qs ? (
                        <td className={`p-0 ${overCdt ? "bg-orange-100" : ""}`} {...cdtWarn} {...xcell(l.id, "propPrice")} title={isRef ? "Giá DỰ KIẾN của phần việc khác (chỉ để cộng giá trị cả sản phẩm, không duyệt)" : undefined}>
                          <NumInput decimals allowEmpty allowFormula value={l.propPrice} placeholder={isRef ? "giá dự kiến" : fm(l.bids[sel]?.price)} {...nProps(l, "propPrice")} className={`${cellIn} text-right font-bold ${overCdt ? "!bg-orange-100" : ""} ${dRed ? "!text-red-600" : pp == null && !isRef ? miss : over ? "text-red-600" : ""}${fProps(l, "propPrice").fx}`} />
                        </td>
                      ) : rv ? (
                        <td className="p-0" {...xcell(l.id, "tpPrice")} title={changed ? `Giá trình: ${fm(pp)}` : "Sửa trực tiếp đơn giá trình (để trống = đồng ý giá trình)"}>
                          <NumInput decimals allowEmpty allowFormula value={l.tpPrice} placeholder={fm(pp)} {...nProps(l, "tpPrice")} className={`${cellIn} !bg-emerald-50/70 text-right font-bold ${dRed ? "!text-red-600" : changed ? "text-blue-700" : over ? "text-red-600" : ""}${fProps(l, "tpPrice").fx}`} />
                        </td>
                      ) : (
                        <td className={`num font-bold ${overCdt ? "bg-orange-100" : ""} ${dRed ? "text-red-600" : changed ? "text-blue-700" : overPrice ? "text-red-600" : ""}`} title={changed ? `Giá trình: ${fm(pp)} — TP / Phó Tổng đã sửa` : undefined}>
                          {fm(apprPriceOf(l, sel))}
                          {changed && <span className="block text-[10px] font-normal text-slate-400 line-through">{fm(pp)}</span>}
                        </td>
                      );
                      const adjAmt = isRef ? amt(...refQP(l)) : amt(propQtyOf(l, sel), qs ? pp : apprPriceOf(l, sel));
                      const dAmt = <td className={`num ${rv && !isRef ? "font-bold" : ""}`} {...xcell(l.id, qs ? "propAmount" : "apprAmount")}>{fm(adjAmt)}</td>;
                      // giá chi tiết: 3 cột đơn giá vật tư | nhân công | thiết bị đứng ngay trước đơn giá tổng
                      const compCells = showCt ? (
                        <>
                          {numTd(l, "propVt", l.propVt, "m", { zero: true })}
                          {numTd(l, "propNc", l.propNc, "m", { zero: true })}
                          {!noTb && numTd(l, "propTb", l.propTb, "m", { zero: true, pct: mepT })}
                        </>
                      ) : null;
                      // PLHĐ điều chỉnh: KL (HĐ | ĐC), đơn giá (HĐ | ĐC), thành tiền (HĐ | ĐC | phụ lục = ĐC − HĐ)
                      return showHd ? (
                        <>
                          {numTd(l, "hdQty", l.hdQty, "q", { cls: "!text-black", tdCls: "text-black" })}
                          {dQty}
                          {numTd(l, "hdPrice", l.hdPrice, "m", { cls: "!text-black", tdCls: "text-black" })}
      {compCells}
                          {dPrice}
                          <td className="num" {...xcell(l.id, "hdAmount")}>{fm(amt(l.hdQty, l.hdPrice))}</td>
                          {dAmt}
                          <td className="num bg-orange-50/60 font-bold text-blue-700" {...xcell(l.id, "plAmount")} title="Thành tiền phụ lục = thành tiền điều chỉnh − thành tiền hợp đồng">{fm((adjAmt ?? 0) - (amt(l.hdQty, l.hdPrice) ?? 0))}</td>
                        </>
                      ) : (
                        hideD ? (
                          miniD ? (
                            <>
                              {dPrice}
                              {dAmt}
                            </>
                          ) : null
                        ) : (
                          <>
                            {!oneQ && dQty}
      {compCells}
                            {dPrice}
                            {dAmt}
                          </>
                        )
                      );
                    })()}
                    {multiAward && (
                      <td className="num font-bold text-emerald-800" {...xcell(l.id, "sTotal")} title="Σ (% × KL × đơn giá) của các thầu phụ được duyệt">
                        {fm(sAmt(l))}
                      </td>
                    )}
                    {txt(l, "note", { multi: true, ph: skipFlags[i] ? "Không tính CP quản lý" : undefined })}
                    {txt(l, "qsNote", { multi: true, tdCls: "bg-sky-50/40", miss: over && !l.qsNote.trim(), ph: over ? `Vượt ${[overPrice && "giá cơ sở", overQty && "KL DT-CP"].filter(Boolean).join(" và ")} — ghi lý do` : "" })}
                    {txt(l, "tpNote", { multi: true })}
                  </tr>
                );
              })()))}
              {(
                [
                  ["sum", "TỔNG CỘNG"],
                  ["prelim", "CHI PHÍ PRELIM"],
                  ["beforeVat", "TỔNG CỘNG TRƯỚC VAT"],
                  ["vat", "VAT"],
                  ["afterVat", "TỔNG CỘNG SAU VAT"],
                ] as const
              ).flatMap(([k, label]) => {
                const row = (
                  <tr key={k} className={k === "afterVat" || k === "sum" ? "bg-slate-100 font-bold" : ""}>
                    <td />
                    <td />
                    <td className="text-center">
                      {label}
                      {k === "prelim" && (calc.exempt[qs ? "D" : "R"] ?? 0) > 0 && <span className="block text-[10px] font-normal text-orange-700">(không tính trên {fm(calc.exempt[qs ? "D" : "R"])} — dòng đánh dấu)</span>}
                      {/* VAT: nút bổ sung thuế khi có 2 loại thuế (VD 8% nhân công + 10% vật tư) */}
                      {k === "vat" && (qs || rv) && (
                        <button type="button" title="Bổ sung dòng thuế (khi có 2 loại thuế). Ô nhập số hoặc công thức: TT là tổng cộng trước thuế của cột, VD =TT*15%*8%" onClick={() => addVatAfter(null)} className="ml-2 rounded border border-amber-300 bg-amber-50 px-1.5 py-0 align-middle font-sans text-[11px] font-medium text-amber-800 hover:bg-amber-100">
                          ＋ Bổ sung thuế
                        </button>
                      )}
                      {/* TỔNG CỘNG: nút thêm dòng chi phí (1, 2, 3... dòng tuỳ ý) ngay bên dưới, như các dòng chi tiết ở trên */}
                      {k === "sum" && (qs || rv) && (
                        <button type="button" title="Thêm dòng chi phí ngay dưới TỔNG CỘNG (thêm được nhiều dòng)" onClick={() => addExtraAfter(null)} className="ml-2 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0 align-middle font-sans text-[11px] font-medium text-emerald-800 hover:bg-emerald-100">
                          ＋ Thêm dòng
                        </button>
                      )}
                    </td>
                    <td colSpan={padN + (oneQ ? 1 : 0)} />
                    {blockKeys.map((c) => (
                      <Fragment key={c}>
                        <FragTotal mini={(c === "D" && hideD) || oneQ} comp={hasComp(c)} n={nComp} x={vx(`v:${k}`, c)} pctKey={k === "prelim" ? "prelim" : k === "vat" ? "vat" : null} col={pk(c)} head={head} editable={canC(c)} onPct={(v) => setH({ [k === "prelim" ? "prelim" : "vat"]: { ...head[k === "prelim" ? "prelim" : "vat"], [pk(c)]: v } } as Partial<SubHead>)} value={calc.totals[tkOf(c)][k]} wide={wideCol(c) ? { hd: calc.totals[hdKeyOf(c)][k] } : undefined} amtTd={totTd(`v:${k}`, amtKey(c), calc.totals[tkOf(c)][k])} hdTd={wideCol(c) ? totTd(`v:${k}`, hdKey(c), calc.totals[hdKeyOf(c)][k]) : undefined} plTd={wideCol(c) ? totTd(`v:${k}`, plKey(c), plValue(`v:${k}`, c, calc.totals[tkOf(c)][k] - calc.totals[hdKeyOf(c)][k]), { cls: "bg-orange-50/60 font-bold text-blue-700" }) : undefined} />
                        {c === "B" && <td />}
                      </Fragment>
                    ))}
                    {multiAward && totTd(`v:${k}`, "sTotal", calc.totals.S?.[k])}
                    <td />
                    <td />
                    <td />
                  </tr>
                );
                // các dòng thuế bổ sung (nằm dưới dòng VAT, cộng vào TỔNG CỘNG SAU VAT)
                const vatRowEls = k === "vat" ? (head.vatRows ?? []).map((x) => (
                  <tr key={x.id} className="bg-amber-50/40">
                    <td className="p-0" />
                    <td className="p-0 text-center">{!oneName && rowBtns(() => addVatAfter(x.id), () => removeVat(x), "Thêm dòng thuế bên dưới", "Xoá dòng thuế này")}</td>
                    <td className="p-0">
                      <div className="flex items-start">
                        {oneName && rowBtns(() => addVatAfter(x.id), () => removeVat(x), "Thêm dòng thuế bên dưới", "Xoá dòng thuế này")}
                        {qs ? <input className={cellIn} placeholder="VD: 8% VAT (Nhân công 15% ĐG)" {...imeSafe(x.label, (v) => setVatRow(x.id, { label: v }))} /> : <span className="block flex-1 px-1 text-center">{x.label}</span>}
                      </div>
                    </td>
                    <td colSpan={padN + (oneQ ? 1 : 0)} />
                    {blockKeys.map((c) => (
                      <Fragment key={c}>
                        {hasComp(c) && Array.from({ length: nComp }, (_, i) => <td key={i} />)}
                        {wideCol(c) && (
                          <>
                            <td />
                            <td />
                            <td />
                          </>
                        )}
                        {!wideCol(c) && !(c === "D" && hideD) && !oneQ && <td />}
                        <td className={canC(c) ? "p-0" : "num"} {...xcell(`v:t:${x.id}`, rateKey(c))}>
                          <VatCell raw={x.vals[pk(c)] ?? ""} tt={calc.totals[tkOf(c)].beforeVat} editable={canC(c)} onCommit={(v) => setVatVal(x.id, pk(c), v)} />
                        </td>
                        {wideCol(c) && totTd(`v:t:${x.id}`, hdKey(c), calc.totals[hdKeyOf(c)].t[x.id], { show: (x.vals[pk(c)] ?? "").trim() !== "" })}
                        {totTd(`v:t:${x.id}`, amtKey(c), calc.totals[tkOf(c)].t[x.id], { show: (x.vals[pk(c)] ?? "").trim() !== "" })}
                        {wideCol(c) && totTd(`v:t:${x.id}`, plKey(c), plValue(`v:t:${x.id}`, c, (calc.totals[tkOf(c)].t[x.id] ?? 0) - (calc.totals[hdKeyOf(c)].t[x.id] ?? 0)), { cls: "bg-orange-50/60 font-bold text-blue-700", show: (x.vals[pk(c)] ?? "").trim() !== "" })}
                        {c === "B" && <td />}
                      </Fragment>
                    ))}
                    {multiAward && totTd(`v:t:${x.id}`, "sTotal", calc.totals.S.t[x.id], { show: (x.vals.D ?? "").trim() !== "" })}
                    <td />
                    <td />
                    <td />
                  </tr>
                )) : [];
                if (k === "vat") return [row, ...vatRowEls];
                if (k !== "sum") return [row];
                // các dòng chi phí thêm (nằm dưới TỔNG CỘNG, được cộng vào TỔNG CỘNG TRƯỚC VAT)
                const extraRows = (head.extras ?? []).map((x) => (
                  <tr key={x.id} className="bg-emerald-50/50">
                    <td className="p-0">{qs ? <input className={`${cellIn} text-center`} {...imeSafe(x.stt, (v) => setExtra(x.id, { stt: v }))} /> : <span className="block text-center">{x.stt}</span>}</td>
                    <td className="p-0 text-center">{!oneName && rowBtns(() => addExtraAfter(x.id), () => removeExtra(x), "Thêm dòng mới bên dưới", "Xoá dòng này")}</td>
                    <td className="p-0">
                      <div className="flex items-start">
                        {oneName && rowBtns(() => addExtraAfter(x.id), () => removeExtra(x), "Thêm dòng mới bên dưới", "Xoá dòng này")}
                        {qs ? <input className={cellIn} placeholder="Nội dung chi phí (VD: Chi phí khác)" {...imeSafe(x.label, (v) => setExtra(x.id, { label: v }))} /> : <span className="block flex-1 px-1">{x.label}</span>}
                      </div>
                    </td>
                    <td colSpan={padN + (oneQ ? 1 : 0)} />
                    {blockKeys.map((c) => (
                      <Fragment key={c}>
                        {hasComp(c) && Array.from({ length: nComp }, (_, i) => <td key={i} />)}
                        {wideCol(c) && (
                          <>
                            <td />
                            <td />
                            <td />
                          </>
                        )}
                        {!wideCol(c) && !(c === "D" && hideD) && !oneQ && <td />}
                        <td className={canC(c) ? "p-0" : "num"} {...xcell(`v:x:${x.id}`, rateKey(c))}>
                          <VatCell raw={x.rates?.[pk(c)] ?? ""} tt={calc.totals[tkOf(c)].sum} editable={canC(c)} onCommit={(v) => setExtraRate(x.id, pk(c), v)} />
                        </td>
                        {/* PLHĐ điều chỉnh: TT HĐ — % / công thức ở ô đơn giá áp cho cả cột hợp đồng (trên TỔNG CỘNG HĐ); không thì tự nhập số hoặc công thức Excel */}
                        {wideCol(c) && totTd(`v:x:${x.id}`, hdKey(c), calc.totals[hdKeyOf(c)].x[x.id])}
                        {totTd(`v:x:${x.id}`, amtKey(c), calc.totals[tkOf(c)].x[x.id])}
                        {/* TT phụ lục = điều chỉnh − hợp đồng */}
                        {wideCol(c) &&
                          (() => {
                            const adjV = calc.totals[tkOf(c)].x[x.id] ?? 0;
                            const hdV = calc.totals[hdKeyOf(c)].x[x.id] ?? 0;
                            return totTd(`v:x:${x.id}`, plKey(c), plValue(`v:x:${x.id}`, c, adjV - hdV), { cls: "bg-orange-50/60 font-bold text-blue-700", show: !!(adjV || hdV) });
                          })()}
                        {c === "B" && <td />}
                      </Fragment>
                    ))}
                    {multiAward && totTd(`v:x:${x.id}`, "sTotal", calc.totals.S.x[x.id])}
                    <td />
                    <td />
                    <td />
                  </tr>
                ));
                return [row, ...extraRows];
              })}
              {([
                [vtVal, "TỔNG GIÁ TRỊ VẬT TƯ", "v:vt"],
                [tbVal, "TỔNG GIÁ TRỊ THIẾT BỊ", "v:tb"],
                [otherVal, "TỔNG GIÁ TRỊ CHI PHÍ KHÁC", "v:other"],
              ] as const).map(([val, label, vid]) =>
                val > 0 ? (
                  <tr key={label} className="bg-slate-50 font-bold">
                    <td />
                    <td />
                    <td className="text-center">{label}</td>
                    <td colSpan={padN + (oneQ ? 1 : 0)} />
                    {blockKeys.map((c) => (
                      <Fragment key={c}>
                        <FragTd mini={(c === "D" && hideD) || oneQ} comp={hasComp(c)} n={nComp} wide={wideCol(c)} x={{ row: vid, v: amtKey(c), hd: hdKey(c), pl: plKey(c) }} v={c !== "A" ? fm(val) : ""} />
                        {c === "B" && <td />}
                      </Fragment>
                    ))}
                    {multiAward && <td className="num" {...xcell(vid, "sTotal")}>{fm(val)}</td>}
                    <td colSpan={3} />
                  </tr>
                ) : null,
              )}
              <tr>
                <td />
                <td />
                <td className="text-center">CHÊNH LỆCH so với CĐT</td>
                <td colSpan={padN + (oneQ ? 1 : 0)} />
                {blockKeys.map((c) => {
                  // CĐT − TỔNG SAU VAT thầu phụ − vật tư − thiết bị (mọi cột trừ cột CĐT); gõ được công thức (=ROUND...) như các dòng tổng
                  const d = diffOf(tkOf(c));
                  return (
                    <Fragment key={c}>
                      <FragTd mini={(c === "D" && hideD) || oneQ} comp={hasComp(c)} n={nComp} wide={wideCol(c)} x={{ row: "v:diff", v: amtKey(c), hd: hdKey(c), pl: plKey(c) }} v={c === "A" ? "" : fm(d)} cell={c === "A" ? undefined : totTd("v:diff", amtKey(c), d)} />
                      {c === "B" && <td />}
                    </Fragment>
                  );
                })}
                {multiAward && totTd("v:diff", "sTotal", diffOf("S"))}
                <td colSpan={3} />
              </tr>
              <tr>
                <td />
                <td />
                <td className="text-center">TỶ LỆ so với CĐT</td>
                <td colSpan={padN + (oneQ ? 1 : 0)} />
                {blockKeys.map((c) => {
                  const d = diffOf(tkOf(c));
                  return (
                    <Fragment key={c}>
                      <FragTd mini={(c === "D" && hideD) || oneQ} comp={hasComp(c)} n={nComp} wide={wideCol(c)} x={{ row: "v:ratio", v: amtKey(c), hd: hdKey(c), pl: plKey(c) }} v={c === "A" ||!calc.totals.A.afterVat ? "" : `${Math.round((d / calc.totals.A.afterVat) * 100)}%`} />
                      {c === "B" && <td />}
                    </Fragment>
                  );
                })}
                {multiAward && <td className="num" {...xcell("v:ratio", "sTotal")}>{calc.totals.A.afterVat ? `${Math.round((diffOf("S") / calc.totals.A.afterVat) * 100)}%` : ""}</td>}
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
          </div>
        </ExcelGrid>
        {qs && (
          <div className="mt-1 flex flex-wrap items-center gap-3 font-sans text-[11px] text-slate-500">
            <button type="button" onClick={() => addLineAfter(lines.length - 1)} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-800 hover:bg-emerald-100">
              ＋ Thêm dòng cuối bảng
            </button>
            <span>
              Mọi ô trong bảng đều sửa được như Excel (gõ số / công thức, chọn vùng, Ctrl+C / Ctrl+V, Ctrl+Z). Rê chuột vào ô <b>STT</b> của một dòng: <b className="text-emerald-700">＋</b> thêm dòng mới bên dưới, <b className="text-red-600">✕</b> xoá dòng. Ở dòng <b>TỔNG CỘNG</b> bấm <b className="text-emerald-700">＋ Thêm dòng</b> để thêm các dòng chi phí khác (thêm bao nhiêu dòng cũng được). Ở dòng <b>VAT</b> bấm <b className="text-amber-700">＋ Bổ sung thuế</b> khi có 2 loại thuế; ô thuế nhập số hoặc công thức, <b>TT</b> = tổng cộng trước thuế của cột (VD <b>=TT*15%*8%</b>). Ô <b>thành tiền</b> các dòng từ <b>TỔNG CỘNG</b> trở xuống gõ được công thức như Excel để làm tròn: bấm vào ô sẽ hiện công thức đang tính, bọc lại bằng <b>=ROUND(…;0)</b>, <b>=ROUNDUP(…;-3)</b> hoặc <b>=ROUNDDOWN(…;0)</b> (các dòng bên dưới tự tính theo số đã làm tròn); xoá trống ô để về lại số tự tính. Bấm <b>Lưu nháp</b> để lưu.
            </span>
          </div>
        )}

        {/* ĐỐI CHIẾU TỔNG THỂ: giá trị thầu phụ (PLĐC) + vật tư + thiết bị so với giá trị ký CĐT / DT-CP */}
        <div className={`mt-4 rounded-lg border-2 p-3 font-sans text-[13px] ${reconLevel === "red" ? "border-red-300 bg-red-50" : reconLevel === "amber" ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50/40"}`}>
          <h3 className="mb-1 font-bold">ĐỐI CHIẾU TỔNG THỂ (sau Prelim + VAT)</h3>
          <table className="w-full max-w-2xl">
            <tbody>
              <tr>
                <td className="py-0.5">Giá trị ký với CĐT (A)</td>
                <td className="py-0.5 text-right font-semibold">{fm(cdtVal)} đ</td>
              </tr>
              <tr>
                <td className="py-0.5">Giá trị DT-CP (B)</td>
                <td className="py-0.5 text-right font-semibold">{fm(dtcpVal)} đ</td>
              </tr>
              {/* GIÁ CÁC THẦU PHỤ BÁO (sau Prelim + VAT) và thầu phụ được chọn */}
              {bidders.length > 0 && (
                <>
                  <tr>
                    <td colSpan={2} className="pt-1.5 font-semibold">
                      Giá các thầu phụ báo ({bidders.length} thầu phụ)
                    </td>
                  </tr>
                  {bidders.map((b) => {
                    const aw = awards.find((a) => a.key === b.key);
                    const chosen = multiAward ? !!aw : b.key === sel;
                    const v = calc.totals[tkOf(b.key)]?.afterVat ?? 0;
                    return (
                      <tr key={b.key} className={chosen ? "font-semibold text-emerald-800" : "text-slate-700"}>
                        <td className="py-0.5 pl-4">
                          {b.name} ({b.key}){chosen && <span className="ml-1 rounded bg-emerald-100 px-1 text-[11px]">✔ {multiAward ? `được duyệt ${aw?.pct ?? 0}%` : "được chọn"}</span>}
                        </td>
                        <td className="py-0.5 text-right">{fm(v)} đ</td>
                      </tr>
                    );
                  })}
                  {multiAward && (
                    <tr className="font-semibold text-emerald-800">
                      <td className="py-0.5 pl-4">Tổng duyệt (Σ các thầu phụ được duyệt theo %)</td>
                      <td className="py-0.5 text-right">{fm(calc.totals.S?.afterVat ?? 0)} đ</td>
                    </tr>
                  )}
                </>
              )}
              {isPl && (
                <>
                  <tr>
                    <td className="py-0.5">{!chain && signedNeeded(head) ? "Giá trị HĐ + PL đã ký" : "Hợp đồng thầu phụ gốc"} {chain?.rootLabel ? `(${chain.rootLabel})` : (head.hdtpNo ?? "").trim() ? `(số HĐ ${head.hdtpNo} — nhập tay)` : <span className="text-red-600">— chưa chọn</span>}</td>
                    <td className="py-0.5 text-right" title={!chain && showHd ? "Lấy theo cột Hợp đồng của bảng (sau Prelim + VAT)" : undefined}>{fm(rootValue)} đ</td>
                  </tr>
                  {chain?.priors.map((x) => (
                    <tr key={x.code}>
                      <td className="py-0.5 pl-4 text-slate-600">+ Phụ lục đã duyệt {x.code}</td>
                      <td className="py-0.5 text-right">{fm(x.value)} đ</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-0.5 pl-4 text-slate-600">+ Phụ lục này (Ký PL)</td>
                    <td className="py-0.5 text-right">{fm(thisValue)} đ</td>
                  </tr>
                </>
              )}
              <tr>
                <td className="py-0.5">{isPl ? "Giá trị hợp đồng thầu phụ sau điều chỉnh (PLĐC)" : "Giá trị thầu phụ đề xuất (HĐTP)"}</td>
                <td className="py-0.5 text-right font-semibold">{fm(subValue)} đ</td>
              </tr>
              {vtVal > 0 && (
                <tr>
                  <td className="py-0.5">+ Tổng giá trị vật tư</td>
                  <td className="py-0.5 text-right">{fm(vtVal)} đ</td>
                </tr>
              )}
              {tbVal > 0 && (
                <tr>
                  <td className="py-0.5">+ Tổng giá trị thiết bị</td>
                  <td className="py-0.5 text-right">{fm(tbVal)} đ</td>
                </tr>
              )}
              {otherVal > 0 && (
                <tr>
                  <td className="py-0.5">+ Chi phí khác</td>
                  <td className="py-0.5 text-right">{fm(otherVal)} đ</td>
                </tr>
              )}
              <tr className="border-t border-slate-300 font-bold">
                <td className="py-1">TỔNG CHI PHÍ (thầu phụ + vật tư + thiết bị{otherVal > 0 ? " + chi phí khác" : ""})</td>
                <td className="py-1 text-right">{fm(totalCost)} đ</td>
              </tr>
              <tr>
                <td className="py-0.5">Chênh lệch so với giá trị ký CĐT</td>
                <td className="py-0.5 text-right font-semibold">{fm(cdtVal - totalCost)} đ</td>
              </tr>
              <tr>
                <td className="py-0.5">Tỷ lệ chênh lệch so với giá trị ký CĐT</td>
                <td className="py-0.5 text-right font-semibold">{cdtVal > 0 ? `${(((cdtVal - totalCost) / cdtVal) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%` : "—"}</td>
              </tr>
            </tbody>
          </table>
          {reconLevel === "red" && <p className="mt-1 font-semibold text-red-700">⚠ Tổng chi phí VƯỢT giá trị ký với CĐT — không hợp lý, cần xem lại trước khi duyệt.</p>}
          {reconLevel === "amber" && <p className="mt-1 font-semibold text-amber-700">⚠ Tổng chi phí vượt giá trị DT-CP (chưa vượt giá trị ký CĐT) — cân nhắc.</p>}
        </div>
        </div>

        {/* điều khoản hợp đồng */}
        <div id="sub-part-B" inert={lockB} className={lockB && needInfo ? "opacity-60" : ""}>
        <h3 className="mt-4 font-bold">B. ĐIỀU KHOẢN HỢP ĐỒNG</h3>
        {(() => {
          const setTerm = (i: number, p: Partial<Term>) => setH({ terms: head.terms.map((x, j) => (j === i ? { ...x, ...p } : x)) });
          const area = `${cellIn} block resize-none whitespace-pre-wrap`;
          const cell = (v: string, edit: boolean, on: (s: string) => void, placeholder = "", cls = "", xc?: { row: string; col: string }) =>
            edit ? (
              <td className="p-0" {...(xc ? xcell(xc.row, xc.col) : {})}>
                <textarea rows={2} className={`${area} ${cls}`} value={v} placeholder={placeholder} onChange={(e) => on(e.target.value)} />
              </td>
            ) : (
              <td className={`whitespace-pre-wrap ${cls}`}>{v || <span className="text-slate-400">{placeholder}</span>}</td>
            );
          // chỉ 2 cột ĐỀ XUẤT | DUYỆT (anh chốt 11/11/2026). ĐỀ XUẤT: QSĐT chọn nội dung đọc được trong file hoặc tự nhập.
          return (
            <ExcelGrid cols={qs ? ["prop", "appr"] : rv ? ["appr"] : []}>
            <table className="tmn-grid xl-lines mt-1 text-[12px]" style={{ tableLayout: "fixed", width: 900 }}>
              <colgroup>
                <col style={{ width: 140 }} />
                <col style={{ width: 380 }} />
                <col style={{ width: 380 }} />
              </colgroup>
              <thead className="text-center font-bold">
                <tr>
                  <th>Điều khoản</th>
                  <th className="bg-sky-100">ĐỀ XUẤT</th>
                  <th className="bg-emerald-100">DUYỆT (TRƯỞNG PHÒNG / PHÓ TỔNG)</th>
                </tr>
              </thead>
              <tbody>
                {head.terms.map((t, i) => {
                  const prop = termProp(t);
                  const choices = termChoices(t);
                  return (
                    <tr key={i} className="align-top">
                      <td className="font-bold">{t.label}</td>
                      {qs ? (
                        <td className="p-0" {...xcell(`term${i}`, "prop")}>
                          <select className="block w-full cursor-pointer border-b border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-600" value="" onChange={(e) => e.target.value && setTerm(i, { prop: e.target.value })}>
                            <option value="">▾ Chọn nội dung…</option>
                            {choices.length > 0 && (
                              <optgroup label="Đọc từ file">
                                {choices.map((c, k) => (
                                  <option key={`f${k}`} value={c}>
                                    {c.length > 90 ? `${c.slice(0, 90)}…` : c}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="Nội dung hay dùng">
                              {termPresets(t)
                                .filter((c) => !choices.includes(c))
                                .map((c, k) => (
                                  <option key={`p${k}`} value={c}>
                                    {c}
                                  </option>
                                ))}
                            </optgroup>
                          </select>
                          <textarea rows={2} className={`${area} font-semibold`} value={t.prop} placeholder="Chọn ở trên hoặc tự nhập" onChange={(e) => setTerm(i, { prop: e.target.value })} />
                        </td>
                      ) : (
                        cell(prop, false, () => {}, "", "font-semibold")
                      )}
                      {/* DUYỆT: Trưởng phòng / Phó Tổng sửa; trống = đồng ý theo đề xuất */}
                      {cell(rv ? t.appr : termAppr(t, sel), rv, (v) => setTerm(i, { appr: v }), rv ? prop || "Trống = đồng ý theo đề xuất" : "", `font-semibold ${t.appr && t.appr !== prop ? "text-blue-700" : ""}`, { row: `term${i}`, col: "appr" })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </ExcelGrid>
          );
        })()}
        {rv && <p className="mt-1 font-sans text-[11px] text-slate-500">Cột DUYỆT để trống = đồng ý theo đề xuất (chữ xám). Chữ <span className="font-bold text-blue-700">xanh</span> = đã sửa khác đề xuất.</p>}

        </div>

        {/* C. PHẠM VI CÔNG VIỆC: sheet đọc từ file QSĐT trình — chỉ xem; QSĐT bổ sung theo yêu cầu TP thì tải lại file Excel chứa sheet này */}
        {(scopeRows.length > 0 || !!needInfo || qs || rv) && (
          <div id="sub-part-C" className={needInfo && part !== "C" ? "opacity-60" : ""}>
            <h3 className="mt-4 font-bold">
              C. PHẠM VI CÔNG VIỆC {scopeRows.length === 0 && <span className="font-normal text-slate-500">(chưa có)</span>}
            </h3>
            {scopeEdit && (
              <div className="mt-1 rounded border border-fuchsia-300 bg-fuchsia-50 p-2 font-sans text-[13px]">
                <p className="mb-1 font-semibold text-fuchsia-900">Tải file Excel có sheet &quot;PHẠM VI CÔNG VIỆC&quot; để thay nội dung mục C (chỉ lấy từ dòng tiêu đề TT trở xuống; bỏ dòng, cột ẩn):</p>
                <input
                  type="file"
                  accept=".xlsx"
                  disabled={pending}
                  className="text-[13px]"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const fd = new FormData();
                    fd.append("file", file);
                    start(async () => done(await uploadSubScopeAction(id, fd)));
                    e.target.value = "";
                  }}
                />
              </div>
            )}
            {scopeRows.length > 0 && (
              <div className="mt-1">
                <ScopeTable rows={scopeRows} editable={scopeEdit} onChange={(r) => (setScopeRows(r), setScopeDirty(true), setDirty(true))} />
              </div>
            )}
            {scopeEdit ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 font-sans text-[11px] text-slate-500">
                <button type="button" disabled={pending || !scopeDirty} onClick={() => start(async () => done(await saveSubScopeAction(id, scopeRows)))} className="rounded border border-fuchsia-300 bg-fuchsia-50 px-2 py-0.5 text-[12px] font-medium text-fuchsia-800 disabled:opacity-40">
                  {scopeDirty ? "💾 Lưu mục C *" : "💾 Lưu mục C"}
                </button>
                {scopeRows.length === 0 && (
                  <button type="button" onClick={() => (setScopeRows([["TT", "NỘI DUNG CÔNG VIỆC", "GHI CHÚ"], ["", "", ""]]), setScopeDirty(true))} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[12px] text-slate-700">
                    ＋ Tạo bảng trống
                  </button>
                )}
                <span>Sửa trực tiếp trong ô; ＋ / ✕ ở đầu dòng và đầu cột để thêm / xoá dòng, cột. Bấm Lưu mục C (hoặc Lưu nháp / Cập nhật / Duyệt) để lưu.</span>
              </div>
            ) : (
              scopeRows.length > 0 && <p className="mt-1 font-sans text-[11px] text-slate-500">Phạm vi công việc lấy từ file QSĐT trình — chỉ xem. Cần chỉnh thì ghi vào ô Ý kiến.</p>
            )}
          </div>
        )}

        <div className="mt-4 grid gap-4 text-[13px] sm:grid-cols-2">
          <div>
            <p className="font-bold">Ý kiến QSTT:</p>
            {qs ? <textarea className="mt-1 w-full rounded border border-slate-300 bg-sky-50/70 p-1.5 font-[inherit] text-[13px]" rows={3} value={head.qsNote} onChange={(e) => setH({ qsNote: e.target.value })} /> : <p className="mt-1 whitespace-pre-line">{head.qsNote || "—"}</p>}
          </div>
          {rv && (
            <div>
              <p className="font-bold">Ý kiến {mode === "ptg" ? "Phó Tổng" : "Trưởng phòng"}:</p>
              <textarea className="mt-1 w-full rounded border border-slate-300 bg-emerald-50/70 p-1.5 font-[inherit] text-[13px]" rows={3} value={note} onChange={(e) => (setNote(e.target.value), setDirty(true))} placeholder="Bắt buộc khi không duyệt" />
            </div>
          )}
        </div>
      </FormSheet>

      {qs && (
        <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 ${ws ? stickyBar : ""}`}>
          {needInfo && (
            <div className="flex w-full flex-wrap items-start gap-2">
              <span className="text-sm text-fuchsia-900">Trưởng phòng yêu cầu bổ sung: <b className="whitespace-pre-line">{needInfo}</b></span>
              <div className="flex w-full flex-wrap items-center gap-2">
                <button type="button" disabled={pending} onClick={() => setPickPart(!pickPart)} className="rounded-md border border-fuchsia-400 bg-white px-4 py-1.5 text-sm font-medium text-fuchsia-800 hover:bg-fuchsia-50">
                  ✎ Bổ sung hồ sơ
                </button>
                {pickPart && (
                  <>
                    <span className="text-sm text-slate-600">Chọn mục cần bổ sung:</span>
                    {([
                      ["A", "A. Bảng đơn giá đề xuất"],
                      ["B", "B. Điều khoản hợp đồng"],
                      ["C", "C. Phạm vi công việc"],
                    ] as const).map(([k, label]) => (
                      <button key={k} type="button" onClick={() => choosePart(k)} className="rounded-md border border-sky-400 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-900 hover:bg-sky-100">
                        {label}
                      </button>
                    ))}
                  </>
                )}
                {part && !pickPart && (
                  <span className="text-sm text-fuchsia-900">
                    Đang bổ sung: <b>{part === "A" ? "A. Bảng đơn giá đề xuất — sửa trực tiếp trên hồ sơ" : part === "B" ? "B. Điều khoản hợp đồng — sửa trực tiếp trên hồ sơ" : "C. Phạm vi công việc — tải file Excel ở mục C"}</b>
                  </span>
                )}
              </div>
              {(
                <textarea className="w-full rounded border border-slate-300 bg-sky-50/70 p-1.5 font-[inherit] text-[13px]" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Ghi chú đã bổ sung những gì (QSTT và Trưởng phòng sẽ thấy)" />
              )}
              {<button
                type="button"
                disabled={pending}
                className="rounded-md bg-fuchsia-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-fuchsia-800 disabled:opacity-50"
                onClick={async () => {
                  if (!(await confirmNear("Cập nhật và gửi lại Trưởng phòng? Hồ sơ lên thẳng Trưởng phòng, QSTT được thông báo để nắm."))) return;
                  start(async () => {
                    if (!(await saveScope())) return;
                    finish(await qsdtUpdateInfoAction(id, reply, ...payload()), "Đã cập nhật — hồ sơ đã lên lại Trưởng phòng");
                  });
                }}
              >
                ⟳ Cập nhật → gửi lại Trưởng phòng
              </button>}
            </div>
          )}
          {!canSubmit && !needInfo && <span className="text-sm text-slate-600">① QSĐT lập hồ sơ — lập xong bấm <b>Chuyển QSTT kiểm tra</b>.</span>}
          {canHandOff && (
            <button
              type="button"
              disabled={pending}
              className="rounded-md bg-sky-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
              onClick={() => {
                if (!window.confirm("Lưu và chuyển hồ sơ cho QSTT kiểm tra? Sau khi chuyển, QSĐT không sửa được (trừ khi QSTT trả lại).")) return;
                start(async () => {
                  if (!(await saveScope())) return;
                  finish(await handSubToQsttAction(id, ...payload()), "Đã chuyển hồ sơ thầu phụ cho QSTT kiểm tra");
                });
              }}
            >
              📤 Chuyển QSTT kiểm tra
            </button>
          )}
          {canSubmit && !needInfo && <span className="text-sm font-medium text-slate-700">Trình Trưởng phòng:</span>}
          {canSubmit && !needInfo && <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">— Chọn —</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>}
          {canSubmit && !needInfo && <button
            type="button"
            disabled={pending}
            className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            onClick={async () => {
              if (!category) return window.alert("Chọn Trưởng phòng duyệt");
              if (!(await confirmNear(`Lưu và trình ${categoryLabel(category)} duyệt?${head.branch ? ` (${BRANCH_LABEL[head.branch]})` : ""}`))) return;
              start(async () => {
                if (!(await saveScope())) return;
                finish(await submitSubAction(id, category, ...payload()), `Đã trình ${categoryLabel(category)} duyệt giá thầu phụ`);
              });
            }}
          >
            Lưu & trình duyệt →
          </button>}
          <button type="button" disabled={pending} onClick={() => start(async () => {
            if (!(await saveScope())) return;
            done(await saveSubDraftAction(id, ...payload()));
          })} className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${dirty ? "bg-amber-600" : "bg-slate-600"}`}>
            {dirty ? "Lưu nháp *" : "Lưu nháp"}
          </button>
          <button
            type="button"
            disabled={pending}
            title="Đọc lại file Excel đã tải lên (điều khoản, thầu phụ, VAT...). Các chỉnh sửa trên bảng sẽ bị thay bằng dữ liệu trong file."
            onClick={() => {
              if (!window.confirm("Đọc lại file Excel đã tải lên?\nBảng, điều khoản và danh sách thầu phụ sẽ được thay bằng dữ liệu đọc lại từ file — các dòng đã thêm / sửa / xoá trên phần mềm sẽ mất.")) return;
              start(async () => done(await rereadSubFileAction(id)));
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            ↻ Đọc lại file Excel
          </button>
          {contractId && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r1 = await saveSubDraftAction(id, ...payload());
                  if (!r1.ok) return window.alert(r1.error);
                  done(await rematchSubAction(id));
                })
              }
              className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm text-violet-800"
            >
              Tự khớp các dòng chưa khớp
            </button>
          )}
          {returnSlot}
        </div>
      )}

      {rv && adjust && (
        <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 p-3 ${ws ? `${stickyBar} bg-amber-50` : "bg-amber-50/60"}`}>
          <span className="text-sm text-slate-700">
            Điều chỉnh giá sau duyệt — tổng giá trị duyệt (sau VAT): <b className="text-base text-amber-800">{fm(calc.totals.R.afterVat)} đ</b>
          </span>
          <span className="flex-1" />
          <button
            type="button"
            disabled={pending}
            className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            onClick={async () => {
              if (!(await confirmNear("Lưu điều chỉnh giá sau duyệt? Sổ giá thầu phụ sẽ ghi lại theo giá mới."))) return;
              start(async () => { if (!(await saveScope())) return; finish(await adjustApprovedSubAction(id, note, tpLines(), head.terms.map((t) => t.appr), finPayload()), "Đã điều chỉnh giá thầu phụ sau duyệt — hồ sơ về QSTT để gửi lại mail kết quả"); });
            }}
          >
            ✓ Lưu điều chỉnh
          </button>
        </div>
      )}

      {rv && !adjust && (
        <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 p-3 ${ws ? `${stickyBar} bg-emerald-50` : "bg-emerald-50/50"}`}>
          <span className="text-sm text-slate-700">
            Tổng giá trị duyệt (sau VAT): <b className="text-base text-emerald-800">{fm(calc.totals.R.afterVat)} đ</b>
          </span>
          <span className="flex-1" />
          {mode === "tp" && (
            <button type="button" disabled={pending} onClick={() => start(async () => { if (!(await saveScope())) return; done(await tpSaveSubAction(id, note, tpLines(), head.terms.map((t) => t.appr), finPayload())); })} className="rounded-md bg-slate-600 px-4 py-1.5 text-sm text-white">
              {dirty ? "Lưu nháp *" : "Lưu nháp"}
            </button>
          )}
          {mode === "tp" && (
            <button
              type="button"
              disabled={pending}
              className="rounded-md border border-fuchsia-300 bg-white px-4 py-1.5 text-sm font-medium text-fuchsia-800"
              title="Giữ hồ sơ, yêu cầu QSĐT bổ sung thêm; QSĐT cập nhật xong hồ sơ lên thẳng lại Trưởng phòng (không qua QSTT)"
              onClick={async () => {
                if (!note.trim()) return window.alert("Nhập nội dung cần QSĐT bổ sung vào ô Ý kiến");
                if (!(await confirmNear("YÊU CẦU QSĐT BỔ SUNG hồ sơ? Hồ sơ về QSĐT, bổ sung xong sẽ lên lại Trưởng phòng."))) return;
                start(async () => { if (!(await saveScope())) return; finish(await tpRequestInfoAction(id, note, tpLines(), head.terms.map((t) => t.appr), finPayload()), "Đã yêu cầu QSĐT bổ sung hồ sơ"); });
              }}
            >
              ✎ Yêu cầu QSĐT bổ sung
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            className="rounded-md border border-red-300 bg-white px-4 py-1.5 text-sm font-medium text-red-700"
            onClick={async () => {
              if (!note.trim()) return window.alert("Nhập lý do không duyệt vào ô Ý kiến");
              if (!(await confirmNear("KHÔNG DUYỆT, trả về bổ sung / sửa?"))) return;
              start(async () => { if (!(await saveScope())) return; finish(await (mode === "ptg" ? ptgDecideSubAction : tpDecideSubAction)(id, false, note, tpLines(), head.terms.map((t) => t.appr), finPayload()), "Đã KHÔNG DUYỆT và trả hồ sơ thầu phụ về bổ sung"); });
            }}
          >
            ✕ Không duyệt — trả về
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white"
            onClick={async () => {
              const msg = mode === "ptg" ? "PHÊ DUYỆT — giá có hiệu lực ngay?" : head.branch === "A" ? "DUYỆT (nhánh A) — Phó Tổng xem để nắm, giá tự hiệu lực sau 24 giờ?" : "DUYỆT và trình Phó Tổng phê duyệt (nhánh B)?";
              if (!(await confirmNear(msg))) return;
              start(async () => { if (!(await saveScope())) return; finish(await (mode === "ptg" ? ptgDecideSubAction : tpDecideSubAction)(id, true, note, tpLines(), head.terms.map((t) => t.appr), finPayload()), mode === "ptg" ? "Đã PHÊ DUYỆT giá thầu phụ" : "Đã DUYỆT giá thầu phụ"); });
            }}
          >
            ✓ {mode === "ptg" ? "Phê duyệt" : "Duyệt"}
          </button>
        </div>
      )}
    </div>
  );
}

// cell: ô thành tiền dựng sẵn (ô nhập được công thức ở dòng CHÊNH LỆCH) thay cho ô chỉ hiện số
function FragTd({ v, wide, hd, pl, comp, n = 3, x, mini, cell }: { mini?: boolean; v: string; wide?: boolean; hd?: string; pl?: string; comp?: boolean; n?: number; x?: { row: string; v: string; hd?: string; pl?: string }; cell?: React.ReactNode }) {
  // x = địa chỉ ô để bấm vào xem công thức tổng (SUBTOTAL) ở thanh công thức
  const xv = x ? xcell(x.row, x.v) : {};
  // wide = khối 7 cột của PLHĐ điều chỉnh: KL HĐ | KL ĐC | ĐG HĐ | ĐG ĐC | TT HĐ | TT ĐC | TT phụ lục; comp = thêm n cột đơn giá vật tư | nhân công (| thiết bị — MEP không có)
  const pre = comp ? <>{Array.from({ length: n }, (_, i) => <td key={i} />)}</> : null;
  if (wide)
    return (
      <>
        {pre}
        <td />
        <td />
        <td />
        <td />
        <td className="num" {...(x?.hd ? xcell(x.row, x.hd) : {})}>{hd}</td>
        {cell ?? <td className="num" {...xv}>{v}</td>}
        <td className="num bg-orange-50/60 font-bold text-blue-700" {...(x?.pl ? xcell(x.row, x.pl) : {})}>{pl}</td>
      </>
    );
  return (
    <>
      {pre}
      {!mini && <td />}
      <td />
      {cell ?? <td className="num" {...xv}>{v}</td>}
    </>
  );
}
// amtTd / hdTd: ô thành tiền (và thành tiền theo hợp đồng) dựng sẵn — ô nhập được công thức (=ROUND...) ở các dòng tổng
function FragTotal({ pctKey, col, head, editable, onPct, value, wide, comp, n = 3, x, mini, amtTd, hdTd, plTd }: { plTd?: React.ReactNode; mini?: boolean; x?: { row: string; rate: string; amt: string; hd: string; pl: string }; pctKey: "prelim" | "vat" | null; col: string; head: SubHead; editable: boolean; onPct: (v: number) => void; value: number; wide?: { hd: number }; comp?: boolean; n?: number; amtTd?: React.ReactNode; hdTd?: React.ReactNode }) {
  const pct = pctKey ? head[pctKey][col] : undefined;
  const pctEl =
    pctKey &&
    (editable ? (
      <NumInput decimals allowEmpty value={pct ?? null} suffix="%" onCommit={(v) => onPct(v ?? 0)} className="w-full bg-sky-50/70 px-1 text-right font-[inherit] text-[12px] outline-none" />
    ) : pct != null ? (
      `${+pct.toFixed(4)}%`
    ) : (
      ""
    ));
  const pre = comp ? <>{Array.from({ length: n }, (_, i) => <td key={i} />)}</> : null;
  if (wide)
    return (
      <>
        {pre}
        <td />
        <td />
        <td />
        <td className="num" {...(x ? xcell(x.row, x.rate) : {})}>{pctEl}</td>
        {hdTd ?? <td className="num" {...(x ? xcell(x.row, x.hd) : {})}>{fm(wide.hd)}</td>}
        {amtTd ?? <td className="num" {...(x ? xcell(x.row, x.amt) : {})}>{fm(value)}</td>}
        {plTd ?? <td className="num bg-orange-50/60 font-bold text-blue-700" {...(x ? xcell(x.row, x.pl) : {})}>{fm(value - wide.hd)}</td>}
      </>
    );
  return (
    <>
      {pre}
      {!mini && <td />}
      <td className="num" {...(x ? xcell(x.row, x.rate) : {})}>{pctEl}</td>
      {amtTd ?? <td className="num" {...(x ? xcell(x.row, x.amt) : {})}>{fm(value)}</td>}
    </>
  );
}

// ô thuế bổ sung: nhập số hoặc công thức (=TT*15%*8%, TT = tổng cộng trước thuế của cột); không đang sửa thì hiện kết quả
function VatCell({ raw, tt, editable, onCommit }: { raw: string; tt: number; editable: boolean; onCommit: (v: string) => void }) {
  const [focus, setFocus] = useState(false);
  const [text, setText] = useState(raw);
  const r = evalVat(raw, tt);
  const shown = raw.trim(); // ô ĐƠN GIÁ hiện đúng chữ đã gõ (số, 25%, hoặc công thức); thành tiền tính ở ô bên cạnh
  if (!editable) return <span className="block text-right">{shown}</span>;
  return (
    <input
      className={`w-full min-w-0 bg-sky-50/70 px-1 py-0.5 text-right font-[inherit] text-[12px] outline-none focus:bg-sky-100 ${raw.trim().startsWith("=") ? "italic !bg-indigo-50" : ""} ${r.err ? "!bg-red-50 text-red-600" : ""}`}
      value={focus ? text : shown}
      placeholder="số hoặc %"
      title={r.err ? `Lỗi công thức: ${r.err}` : raw.trim().startsWith("=") ? `Công thức: ${raw}` : "Gõ số tiền, hoặc % (VD 8%), hoặc công thức (VD =TT*15%*8%) — TT = tổng cộng của cột"}
      onFocus={() => {
        setFocus(true);
        setText(raw);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocus(false);
        if (text !== raw) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
