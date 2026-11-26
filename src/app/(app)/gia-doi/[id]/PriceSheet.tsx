"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NumInput from "../../NumInput";
import ExcelGrid, { xcell, type GridPaste, type XlGridApi, type GridNote } from "../../ExcelGrid";
import { useUndo, useXlFormulas } from "../../xl/useXl";
import { useCellNotes } from "../../xl/useCellNotes";
import { colLetter } from "@/lib/grid-formula";
import { parsePastedNumber } from "@/lib/parse-number";
import { FormLetterhead, FormSheet } from "../../mua-vat-tu/forms/FormBits";
import { amount, approvedPriceOf, CATEGORIES, categoryLabel, hasFormula, missingOf, opinionOf, parentLineIdx, proposedPriceOf, QS_AMOUNT_COLS, sitePriceOf } from "@/lib/gia-doi-calc";
import { numRaw } from "@/lib/xl-formula";
import { adjustApprovedPriceAction, savePriceHeadInfoAction, decidePriceAction, rematchPriceAction, savePriceDraftAction, saveTpDraftAction, setLineMatchAction, setSubmissionContractAction, submitPriceAction, type HeadInput, type LineInput, type TotalInput, type TpLineInput } from "@/lib/gia-doi-actions";
import { normText, similarity, type DtcpRef } from "@/lib/hop-dong-calc";
import { confirmNear } from "@/app/(app)/confirm-near";
import { useTaskWorkspace } from "@/app/(app)/TaskWorkspace";
import SitePicker from "@/app/(app)/du-an/SitePicker";
import type { SiteOpt } from "@/lib/project-site-calc";

// Hồ sơ đề xuất đơn giá tổ đội hiển thị & nhập theo đúng mẫu Excel của phòng (2 trường hợp IN / OUT) + khối TRƯỞNG PHÒNG DUYỆT.
//  mode "qs"  : QSTT kiểm tra, bổ sung ô thiếu (tô đỏ), ghi chú từng dòng + ghi chú chung, chọn hạng mục rồi trình TP
//  mode "tp"  : Trưởng phòng duyệt từng dòng (✓ / ✕, sửa đơn giá duyệt, ghi chú) rồi Duyệt / Không duyệt cả hồ sơ
//  mode "view": chỉ xem

export type SheetLine = Omit<LineInput, "id"> & {
  id: string;
  level: string;
  stt: string;
  cdtAmount: number | null;
  baseAmount: number | null;
  siteAmount: number | null;
  ptAmount: number | null;
  apprAmount: number | null; // thành tiền duyệt do Trưởng phòng đặt công thức (lưu ở PriceLine.tpAmount)
  tpPrice: number | null;
  tpOk: boolean;
  tpNote: string;
  added?: boolean; // dòng QSTT thêm trên phần mềm (không có trong file gốc) — sửa được STT
  formulas: Record<string, string>; // công thức kiểu Excel các ô số (src/lib/xl-formula.ts)
};
export type SheetHead = HeadInput & { tpNote: string; category: string };
export type SheetTotal = { formulas: Record<string, string>; amounts: { cdt?: number; base?: number; site?: number; appr?: number } };

const TOTAL_ID = "__total";
// dòng ảo cuối bảng = dòng TỔNG CỘNG (để sửa bằng công thức như mọi ô khác; không phải dòng công việc)
const blankSheetLine = (id: string): SheetLine => ({
  id, level: "ITEM", stt: "", content: "", unit: "", qty: null, cdtPrice: null, cdtAmount: null, basePrice: null, baseAmount: null, baseNote: "",
  siteOpinion: "", sitePrice: null, siteAmount: null, siteNote: "", ptOpinion: "", ptPrice: null, ptAmount: null, ptNote: "", qsNote: "", apprAmount: null,
  tpPrice: null, tpOk: true, tpNote: "", lineKey: "", overReason: "", formulas: {},
});
const AMT_FIELD = { cdt: "cdtAmount", base: "baseAmount", site: "siteAmount", appr: "apprAmount" } as const;
const AMT_KEYS = ["cdt", "base", "site", "appr"] as const;

const fm = (n: number | null | undefined) => (n ? Math.round(n).toLocaleString("vi-VN") : "");
const fq = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })); // khối lượng: 2 số lẻ

export default function PriceSheet({
  id,
  notes: initNotes = [],
  kind,
  mode,
  adjust = false,
  head: initHead,
  lines: initLines,
  contracts,
  sites,
  contractId,
  dtcpLater = false,
  status = "",
  canFillLater = false,
  total: initTotal,
  refs: initRefs,
  revision,
  dtcpPanel = null,
  headEdit = false,
}: {
  headEdit?: boolean; // Trưởng phòng (đang chờ duyệt) / Quản trị (mọi lúc): sửa được thông tin đầu hồ sơ (không ảnh hưởng giá duyệt)
  dtcpPanel?: React.ReactNode; // nút "Xem DT-CP" (ngăn bên phải) đặt cạnh nút Lưu nháp của Trưởng phòng
  total: SheetTotal; // công thức + số đã tính của dòng TỔNG CỘNG
  id: string;
  notes?: GridNote[]; // ghi chú ô (tam giác đỏ)
  kind: string;
  mode: "qs" | "tp" | "view";
  adjust?: boolean; // Trưởng phòng điều chỉnh giá sau khi đã duyệt
  head: SheetHead;
  lines: SheetLine[];
  contracts: { id: string; label: string; siteId: string | null }[];
  sites: SiteOpt[]; // DANH MỤC DỰ ÁN
  contractId: string | null;
  dtcpLater?: boolean; // "Chưa có DT-CP — bổ sung sau"
  status?: string;
  canFillLater?: boolean; // QSTT bổ sung DT-CP cho hồ sơ đã trình / đã duyệt đang "bổ sung sau"
  refs: DtcpRef[]; // dòng TH Nhân Công của hợp đồng (đơn giá DT-CP, giá đã duyệt theo đội, lũy kế đã trình ở hồ sơ khác)
  revision: number;
}) {
  const router = useRouter();
  const cellNotes = useCellNotes("GD", id, initNotes);
  const [pending, start] = useTransition();
  const [head, setHead] = useState(initHead);
  // dòng cuối (mã __total) = TỔNG CỘNG; mọi chỗ duyệt dòng công việc phải bỏ qua level "TOTAL"
  const [lines, setLines] = useState<SheetLine[]>(() => [
    ...initLines,
    { ...blankSheetLine(TOTAL_ID), level: "TOTAL", formulas: initTotal.formulas, cdtAmount: initTotal.amounts.cdt ?? null, baseAmount: initTotal.amounts.base ?? null, siteAmount: initTotal.amounts.site ?? null, apprAmount: initTotal.amounts.appr ?? null },
  ]);
  const [dirty, setDirty] = useState(false);
  const qs = mode === "qs";
  const tp = mode === "tp";
  const isOut = kind === "OUT";
  // he = được sửa thông tin đầu hồ sơ: QSTT (lưu cùng bảng) hoặc Trưởng phòng / Quản trị (lưu riêng bằng savePriceHeadInfoAction)
  const he = qs || headEdit;
  const hx = !qs && headEdit;
  const [hc, setHc] = useState<string>(contractId ?? (dtcpLater ? "@later" : "")); // hợp đồng (DT-CP) Trưởng phòng / Quản trị chọn, lưu khi bấm Lưu thông tin
  const [headDirty, setHeadDirty] = useState(false);
  const curCid = hx ? (hc && hc !== "@later" ? hc : null) : contractId;

  const setH = (patch: Partial<SheetHead>) => {
    setHead((h) => ({ ...h, ...patch }));
    setDirty(true);
    setHeadDirty(true);
  };
  // Trưởng phòng / Quản trị: lưu thông tin đầu hồ sơ đã sửa (trước mọi thao tác lưu / duyệt khác); false = lỗi (đã báo)
  const saveHeadInfo = async () => {
    if (!hx || !headDirty) return true;
    const r = await savePriceHeadInfoAction(id, head, curCid, hc === "@later");
    if (!r.ok) {
      window.alert(r.error);
      return false;
    }
    if (r.info) window.alert(r.info);
    setHeadDirty(false);
    return true;
  };
  const setL = (lid: string, patch: Partial<SheetLine>) => {
    setLines((ls) => ls.map((l) => (l.id === lid ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  // QSTT thêm / xoá dòng đề xuất (lưu khi bấm Lưu nháp / Trình)
  const blankLine = (): SheetLine => ({ ...blankSheetLine(`new:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`), added: true });
  const addLineAfter = (idx: number) => {
    setLines((ls) => [...ls.slice(0, Math.min(idx, ls.length - 2) + 1), blankLine(), ...ls.slice(Math.min(idx, ls.length - 2) + 1)]); // luôn chèn TRƯỚC dòng TỔNG CỘNG
    setDirty(true);
  };
  // các dòng thuộc 1 dòng: dòng công tác = chính nó; ĐẦU MỤC LỚN (A, B / I, II) = nó + toàn bộ dòng bên dưới thuộc đầu mục đó
  const blockOf = (i: number) => {
    const l = lines[i];
    let end = i;
    if (l.level === "GROUP" || l.level === "SUB") {
      for (let j = i + 1; j < lines.length; j++) {
        const lj = lines[j];
        if (lj.level === "TOTAL" || lj.level === "GROUP" || (l.level === "SUB" && lj.level === "SUB")) break;
        end = j;
      }
    }
    return lines.slice(i, end + 1);
  };
  const removeLine = (l: SheetLine) => removeLines([l.id]);
  // XOÁ 1 hoặc nhiều dòng (nút ✕ hoặc chuột phải "Xoá dòng"); đầu mục kéo theo các dòng bên dưới; dòng TỔNG CỘNG không xoá
  const removeLines = (rowIds: string[]) => {
    const picked = lines.map((l, i) => ({ l, i })).filter((x) => rowIds.includes(x.l.id) && x.l.level !== "TOTAL");
    if (!picked.length) return;
    const gone = new Map<string, SheetLine>();
    for (const { i } of picked) for (const x of blockOf(i)) gone.set(x.id, x);
    const all = [...gone.values()];
    const items = all.filter((x) => x.level === "ITEM").length;
    const heads = picked.filter((x) => x.l.level === "GROUP" || x.l.level === "SUB");
    const first = picked[0].l;
    const name = `${first.stt ? `${first.stt} ` : ""}"${first.content.slice(0, 60) || "(trống)"}"`;
    const tail = "\n(Bấm Lưu nháp mới lưu; chưa lưu thì tải lại trang là lấy lại được.)";
    const msg =
      picked.length > 1
        ? `Xoá ${all.length} dòng (${items} công tác${heads.length ? `, gồm ${heads.length} đầu mục kèm các dòng bên dưới` : ""}) khỏi hồ sơ?${tail}`
        : all.length > 1
          ? `Xoá ĐẦU MỤC ${name} cùng ${all.length - 1} dòng bên dưới (${items} công tác) khỏi hồ sơ?${tail}`
          : `Xoá dòng ${name} khỏi hồ sơ?${tail}`;
    if (all.some((x) => x.content || x.qty != null || all.length > 1) && !window.confirm(msg)) return;
    setLines((ls) => ls.filter((x) => !gone.has(x.id)));
    setDirty(true);
  };
  // CHÈN DÒNG từ menu chuột phải (như Excel): count dòng trống phía trên / phía dưới dòng anchor; luôn nằm TRƯỚC dòng TỔNG CỘNG
  const insertLines = (anchor: string, where: "above" | "below", count: number) => {
    setLines((ls) => {
      const i = ls.findIndex((x) => x.id === anchor);
      if (i < 0) return ls;
      const at = Math.min(where === "above" ? i : i + 1, ls.length - 1);
      return [...ls.slice(0, at), ...Array.from({ length: Math.max(1, count) }, blankLine), ...ls.slice(at)];
    });
    setDirty(true);
  };
  // nút ＋ / ✕ hiện khi rê chuột vào ô STT (QSTT)
  const rowTools = (l: SheetLine, idx: number) =>
    qs && (
      <span className="absolute inset-y-0 right-0 z-10 hidden items-center gap-px bg-white/95 pl-0.5 shadow-sm group-hover:flex">
        <button type="button" title="Thêm dòng mới bên dưới" onClick={() => addLineAfter(idx)} className="rounded px-0.5 text-[12px] font-bold leading-none text-emerald-700 hover:bg-emerald-100">
          ＋
        </button>
        {l.level !== "TOTAL" && (
          <button type="button" title={l.level === "GROUP" || l.level === "SUB" ? "Xoá đầu mục này (kèm các dòng bên dưới)" : "Xoá dòng này"} onClick={() => removeLine(l)} className="rounded px-0.5 text-[12px] font-bold leading-none text-red-600 hover:bg-red-100">
            ✕
          </button>
        )}
      </span>
    );

  // ---- CHỌN KHỚP DT-CP bằng tay: xem dòng DT-CP gần giống (kèm đơn giá) rồi bấm chọn. QSTT (hồ sơ nháp) lưu khi bấm Lưu nháp; Trưởng phòng lưu ngay ----
  const [matchRow, setMatchRow] = useState<string | null>(null);
  const [matchQ, setMatchQ] = useState("");
  const candidatesOf = (l: SheetLine) => {
    const q = normText(matchQ);
    const unit = normText(l.unit);
    return initRefs
      .map((r) => ({ r, score: q ? (normText(r.name).includes(q) ? 1 : 0) : similarity(l.content, r.name) + (unit && normText(r.unit) === unit ? 0.15 : 0) }))
      .filter((x) => x.score > (q ? 0 : 0.12))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  };
  const pickMatch = (l: SheetLine, key: string) => {
    if (qs) {
      setL(l.id, { lineKey: key });
      setMatchRow(null);
      return;
    }
    start(async () => {
      const r = await setLineMatchAction(id, l.id, key);
      if (!r.ok) return window.alert(r.error);
      const bp = r.info ? Number(r.info) : NaN;
      setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, lineKey: key, ...(Number.isFinite(bp) ? { basePrice: bp } : {}) } : x)));
      setMatchRow(null);
    });
  };

  // dòng DT-CP (TH Nhân Công) của hợp đồng — phần mềm tự khớp khi gắn hợp đồng / lưu; chưa khớp thì chọn tay (nút "Xem giá DT-CP gần giống")
  const refMap = useMemo(() => new Map(initRefs.map((r) => [r.key, r])), [initRefs]);
  // vượt: đơn giá đề xuất > GIÁ CƠ SỞ (đơn giá DT-CP dòng đã khớp; chưa khớp thì giá cơ sở trong file), hoặc lũy kế KL > KL DT-CP
  // TÔ MÀU THEO ĐIỀU KIỆN: giá công trình đề xuất cao hơn giá CĐT → nền cam (lỗ so với giá bán cho CĐT)
  const overCdt = (l: SheetLine) => (l.level === "ITEM" && l.sitePrice != null && l.cdtPrice != null && l.cdtPrice > 0 && l.sitePrice > l.cdtPrice + 0.5 ? "Giá đề xuất CAO HƠN giá CĐT" : "");
  const overOf = (l: SheetLine) => {
    const ref = refMap.get(l.lineKey);
    const p = proposedPriceOf(kind, l);
    const base = ref?.price ?? l.basePrice;
    return { price: p != null && base != null && base > 0 && p > base + 0.5, qty: !!ref && ref.qty != null && ref.prevQty + (l.qty ?? 0) > ref.qty + 1e-6, ref };
  };
  const missing = useMemo(() => {
    if (!qs) return [];
    const m = missingOf({ ...head, kind }, lines);
    if (!head.siteId) m.unshift("Chưa chọn CÔNG TRÌNH (dự án) trong Danh mục dự án");
    if (!contractId && !dtcpLater) m.unshift('Chưa chọn HỢP ĐỒNG (DT-CP) — chưa có thì chọn "Chưa có DT-CP — bổ sung sau"');
    for (const l of lines) {
      if (l.level !== "ITEM") continue;
      const o = overOf(l);
      if ((o.price || o.qty) && !l.qsNote.trim() && !l.overReason.trim()) m.push(`Dòng ${l.stt || "?"} "${l.content.slice(0, 40)}": vượt ${o.price ? "giá cơ sở" : "KL DT-CP"} — ghi lý do vào cột Ghi chú QSTT`);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, head, lines, kind, contractId, dtcpLater, refMap]);
  const parents = useMemo(() => parentLineIdx(lines), [lines]);

  // thành tiền từng dòng + cộng theo nhóm (A, B / I, II) giống SUBTOTAL trong file
  const calc = useMemo(() => {
    // ô thành tiền có CÔNG THỨC (QSTT / Trưởng phòng tự sửa như Excel) thì lấy số đã tính của công thức, không thì tự tính
    const ov = (l: SheetLine, k: (typeof AMT_KEYS)[number], auto: number | null): number | null => (hasFormula(l, AMT_FIELD[k]) ? l[AMT_FIELD[k]] : auto);
    const row = lines.map((l) => {
      if (l.level !== "ITEM") return null;
      return {
        cdt: ov(l, "cdt", amount(l.qty, l.cdtPrice)),
        base: ov(l, "base", amount(l.qty, refMap.get(l.lineKey)?.price ?? l.basePrice)),
        site: ov(l, "site", amount(l.qty, sitePriceOf(kind, l))),
        pt: amount(l.qty, l.ptPrice),
        prop: proposedPriceOf(kind, l),
        appr: l.tpOk ? ov(l, "appr", amount(l.qty, approvedPriceOf(kind, l))) : 0,
      };
    });
    const keys = ["cdt", "base", "site", "pt", "appr"] as const;
    const group = lines.map((l, i) => {
      if (l.level !== "GROUP" && l.level !== "SUB") return null;
      const s = { cdt: 0, base: 0, site: 0, pt: 0, appr: 0 };
      for (let j = i + 1; j < lines.length; j++) {
        const lj = lines[j];
        if (lj.level === "GROUP" || (l.level === "SUB" && lj.level === "SUB") || lj.level === "TOTAL") break;
        const r = row[j];
        if (r) for (const k of keys) s[k] += r[k] ?? 0;
      }
      // nhóm khoán gọn trong file (VD "B. Chi phí nhân công khác" ghi 80.000.000 ở cột giá cơ sở, không chia dòng)
      if (!s.cdt && l.cdtAmount) s.cdt = l.cdtAmount;
      if (!s.base && l.baseAmount) s.base = l.baseAmount;
      for (const k of AMT_KEYS) if (hasFormula(l, AMT_FIELD[k])) s[k] = l[AMT_FIELD[k]] ?? 0; // tổng nhóm sửa bằng công thức
      return s;
    });
    const total = { cdt: 0, base: 0, site: 0, pt: 0, appr: 0 };
    lines.forEach((l, i) => {
      if (l.level === "GROUP") for (const k of keys) total[k] += group[i]![k];
    });
    if (!lines.some((l) => l.level === "GROUP")) row.forEach((r) => r && keys.forEach((k) => (total[k] += r[k] ?? 0)));
    const totalLine = lines[lines.length - 1];
    if (totalLine?.level === "TOTAL") for (const k of AMT_KEYS) if (hasFormula(totalLine, AMT_FIELD[k])) total[k] = totalLine[AMT_FIELD[k]] ?? 0; // TỔNG CỘNG sửa bằng công thức
    return { row, group, total };
  }, [lines, kind, refMap]);

  // dòng TỔNG CỘNG gửi lên máy chủ: công thức + số đã tính (cả khi không sửa — để danh sách / PDF / Excel dùng đúng số này)
  const totalPayload = (): TotalInput => {
    const t = lines[lines.length - 1];
    return {
      formulas: t?.level === "TOTAL" ? t.formulas : {},
      amounts: { cdt: calc.total.cdt, base: calc.total.base, site: calc.total.site, appr: calc.total.appr },
    };
  };
  const qsPayload = (): [HeadInput, LineInput[], TotalInput] => [
    { siteId: head.siteId ?? "", projectName: head.projectName, contractNo: head.contractNo, projectCode: head.projectCode, itemName: head.itemName, quoteStatus: head.quoteStatus, batch: head.batch, batchDate: head.batchDate, qsNote: head.qsNote, crewName: head.crewName },
    lines.filter((l) => l.level !== "TOTAL").map((l) => ({
      id: l.id, stt: l.stt, content: l.content, unit: l.unit, qty: l.qty, cdtPrice: l.cdtPrice, basePrice: l.basePrice, baseNote: l.baseNote,
      siteOpinion: l.siteOpinion, sitePrice: l.sitePrice, siteNote: l.siteNote, ptOpinion: l.ptOpinion, ptPrice: l.ptPrice, ptNote: l.ptNote, qsNote: l.qsNote,
      lineKey: l.lineKey, overReason: l.overReason, formulas: l.formulas, cdtAmount: l.cdtAmount, baseAmount: l.baseAmount, siteAmount: l.siteAmount,
      tpPrice: l.tpPrice, tpOk: l.tpOk, tpNote: l.tpNote, tpAmount: l.apprAmount, // khối KT-KH: QSTT sửa được khi chưa trình
    })),
    totalPayload(),
  ];
  const tpPayload = (): TpLineInput[] =>
    lines.filter((l) => l.level === "ITEM" || l.level === "GROUP" || l.level === "SUB").map((l) => ({ id: l.id, tpPrice: l.tpPrice, tpOk: l.tpOk, tpNote: l.tpNote, formulas: l.formulas, tpAmount: l.apprAmount }));
  // cửa sổ làm việc toàn màn hình: báo có thay đổi chưa lưu + cách lưu nháp (khi bấm "Về màn hình chính")
  const ws = useTaskWorkspace();
  const saveDraft = async () => {
    if (adjust) {
      window.alert("Hồ sơ đã duyệt không có bản nháp — bấm \"Lưu điều chỉnh\" để ghi giá mới (hoặc thoát để bỏ thay đổi).");
      return false;
    }
    if (!(await saveHeadInfo())) return false;
    const r = qs ? await savePriceDraftAction(id, ...qsPayload()) : tp ? await saveTpDraftAction(id, head.tpNote, tpPayload(), totalPayload()) : { ok: true as const };
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
  const after = (r: { ok: boolean; error?: string }) => {
    if (!r.ok) {
      window.alert(r.error);
      return false;
    }
    setDirty(false);
    router.refresh();
    return true;
  };

  // cid "@later" = "Chưa có DT-CP — bổ sung sau"
  const changeContract = (cid: string) =>
    start(async () => {
      if (qs) {
        const r1 = await savePriceDraftAction(id, ...qsPayload());
        if (!r1.ok) return window.alert(r1.error);
      } else {
        // hồ sơ đã trình / đã duyệt: QSTT bổ sung DT-CP
        if (!cid || cid === "@later") return;
        if (!window.confirm(`Bổ sung DT-CP cho hồ sơ: ${contracts.find((c) => c.id === cid)?.label ?? ""}?${status === "APPROVED" ? "\nGiá đã duyệt sẽ được ghi vào sổ giá hợp đồng này (theo ngày Trưởng phòng duyệt)." : ""}\nSau khi bổ sung không đổi lại được.`)) return;
      }
      const r = await setSubmissionContractAction(id, cid && cid !== "@later" ? cid : null, cid === "@later");
      if (!r.ok) return window.alert(r.error);
      if (r.info) window.alert(r.info);
      setDirty(false);
      router.refresh();
    });

  // ---- dán vùng copy từ Excel ----
  const NUMS = new Set(["qty", "cdtPrice", "basePrice", "sitePrice", "ptPrice", "tpPrice"]);
  const AMT_COLS = new Set<string>(["cdtAmount", "baseAmount", "siteAmount", "apprAmount"]); // thành tiền: sửa bằng công thức như Excel
  const pasteGrid = (cells: GridPaste[]) => {
    setLines((ls) =>
      ls.map((l) => {
        const cs = cells.filter((c) => c.row === l.id);
        if (!cs.length) return l;
        const p = { ...l, formulas: { ...l.formulas } } as Record<string, unknown> & { formulas: Record<string, string> };
        for (const c of cs) {
          if (AMT_COLS.has(c.col)) {
            // dán số vào ô thành tiền / tổng = ghi đè số tự tính (lưu dạng công thức "=số"); dán ô trống = về lại số tự tính
            if (c.num == null) delete p.formulas[c.col];
            else {
              p.formulas[c.col] = `=${numRaw(c.num)}`;
              p[c.col] = c.num;
            }
            continue;
          }
          p[c.col] = NUMS.has(c.col) ? c.num : c.col === "tpOk" ? !/^(x|✕|khong|không|0|no)$/i.test(c.text) : c.text;
          delete p.formulas[c.col]; // dán số đè lên ô có công thức → bỏ công thức
        }
        return p as unknown as SheetLine;
      }),
    );
    setDirty(true);
  };
  const qsCols = ["content", "unit", "qty", "cdtPrice", "basePrice", "baseNote", ...(isOut ? ["sitePrice", "siteNote"] : ["siteOpinion", "sitePrice", "siteNote"]), "qsNote", "tpPrice", "tpNote"];
  const tpCols = ["tpPrice", "tpNote"];

  // ---- Công thức kiểu Excel + Ctrl+Z (src/lib/xl-formula.ts, ../../xl/useXl.ts, ExcelGrid prop xl) ----
  // Chữ cột A, B, C... = thứ tự cột của bảng; số dòng = thứ tự dòng trong bảng (1, 2, 3...) → gõ =K5*1,05 như Excel
  const xlCols = useMemo(
    () =>
      isOut
        ? ["stt", "content", "unit", "qty", "cdtPrice", "cdtAmount", "basePrice", "baseAmount", "baseNote", "sitePrice", "siteAmount", "siteNote", "qsNote", "tpOk", "opinion", "tpPrice", "apprAmount", "tpNote"]
        : ["stt", "content", "unit", "qty", "cdtPrice", "cdtAmount", "basePrice", "baseAmount", "baseNote", "siteOpinion", "sitePrice", "siteAmount", "siteNote", "qsNote", "tpOk", "tpPrice", "apprAmount", "tpNote"],
    [isOut],
  );
  // giá trị ô (cả cột tính sẵn như thành tiền, giá cơ sở theo DT-CP) để công thức tham chiếu
  const valueOf = useCallback(
    (l: SheetLine, col: string, i: number): number | string | null => {
      const r = calc.row[i];
      const g = calc.group[i];
      switch (col) {
        case "cdtAmount":
          return r ? r.cdt : l.level === "TOTAL" ? calc.total.cdt : (g?.cdt ?? null);
        case "baseAmount":
          return r ? r.base : l.level === "TOTAL" ? calc.total.base : (g?.base ?? null);
        case "siteAmount":
          return r ? r.site : l.level === "TOTAL" ? calc.total.site : (g?.site ?? null);
        case "apprAmount":
          return r ? r.appr : l.level === "TOTAL" ? calc.total.appr : (g?.appr ?? null);
        case "basePrice":
          return refMap.get(l.lineKey)?.price ?? l.basePrice;
        case "sitePrice":
          return l.level === "ITEM" ? sitePriceOf(kind, l) : null;
        case "tpPrice":
          return l.level === "ITEM" ? approvedPriceOf(kind, l) : null;
        case "opinion":
          return l.level === "ITEM" ? opinionOf(kind, l) : "";
        case "tpOk":
          return l.level === "ITEM" ? (l.tpOk ? "✓" : "✕") : "";
        default: {
          const v = (l as unknown as Record<string, unknown>)[col];
          return typeof v === "number" || typeof v === "string" ? v : null;
        }
      }
    },
    [calc, refMap, kind],
  );
  const hist = useUndo(
    useMemo(() => ({ head, lines }), [head, lines]),
    useCallback((s: { head: SheetHead; lines: SheetLine[] }) => {
      setHead(s.head);
      setLines(s.lines);
      setDirty(true);
    }, []),
  );
  const xf = useXlFormulas({ lines, setLines, cols: xlCols, valueOf, silent: hist.silent });
  const NUM_COLS = ["qty", "cdtPrice", "basePrice", "sitePrice", "ptPrice", "tpPrice"];
  // CÔNG THỨC TỰ TÍNH của ô thành tiền (chưa ai sửa tay) viết ra dạng Excel để bấm vào / F2 là thấy: dòng công việc =KL×đơn giá,
  // dòng nhóm =SUBTOTAL(9;K5:K9) (các dòng con), TỔNG CỘNG =SUBTOTAL(9;K1:K20) — ExcelGrid tô viền các ô được tham chiếu
  const autoFormula = (l: SheetLine, col: string): string => {
    if (!AMT_COLS.has(col)) return "";
    const i = lines.findIndex((x) => x.id === l.id);
    if (i < 0) return "";
    const A = (idx: number, c: string) => xf.addr(lines[idx].id, c);
    if (l.level === "ITEM") {
      if (col === "apprAmount" && !l.tpOk) return "";
      const siteCol = l.sitePrice != null && sitePriceOf(kind, l) === l.sitePrice ? "sitePrice" : "basePrice";
      const priceCol = col === "cdtAmount" ? "cdtPrice" : col === "baseAmount" ? "basePrice" : col === "siteAmount" ? siteCol : l.tpPrice != null ? "tpPrice" : siteCol;
      return `=${A(i, "qty")}*${A(i, priceCol)}`;
    }
    if (l.level === "GROUP" || l.level === "SUB") {
      let last = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const lj = lines[j];
        if (lj.level === "TOTAL" || lj.level === "GROUP" || (l.level === "SUB" && lj.level === "SUB")) break;
        last = j;
      }
      return last > i ? `=SUBTOTAL(9;${A(i + 1, col)}:${A(last, col)})` : "";
    }
    if (l.level === "TOTAL") return i > 0 ? `=SUBTOTAL(9;${A(0, col)}:${A(i - 1, col)})` : "";
    return "";
  };
  // thứ tự cột sửa được (theo đúng thứ tự cột của bảng) cho ExcelGrid; thành tiền: QSTT sửa 3 cột đầu, Trưởng phòng sửa cột duyệt
  const qsGridCols = xlCols.filter((k) => qsCols.includes(k) || QS_AMOUNT_COLS.includes(k) || k === "apprAmount");
  const tpGridCols = xlCols.filter((k) => tpCols.includes(k) || k === "apprAmount");
  const canEdit = (l: SheetLine, col: string) => {
    if (AMT_COLS.has(col)) return l.level !== "NOTE" && (qs ? QS_AMOUNT_COLS.includes(col) || col === "apprAmount" : tp ? col === "apprAmount" : false);
    return qs ? (qsCols.includes(col) && !(col === "basePrice" && refMap.has(l.lineKey))) || col === "stt" : tp ? tpCols.includes(col) && l.level === "ITEM" : false;
  };
  const xlApi: XlGridApi = {
    addr: xf.addr,
    raw: (row, col) => {
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
      const i = lines.findIndex((x) => x.id === row);
      const l = lines[i];
      if (!l) return "";
      const v = valueOf(l, col, i);
      return typeof v === "number" ? v.toLocaleString("vi-VN", { maximumFractionDigits: 6 }) : (v ?? "");
    },
    set: (row, col, text) => {
      const l = lines.find((x) => x.id === row);
      if (!l || !canEdit(l, col)) return;
      if (AMT_COLS.has(col)) {
        // ô thành tiền: "=công thức" như Excel; gõ số = ghi đè số tự tính; để trống = về lại số tự tính
        if (text.trim().startsWith("=")) xf.setFormula(row, col, text);
        else if (text.trim() === "") setL(row, { formulas: xf.clearFormula(l, col) } as Partial<SheetLine>);
        else {
          const n = parsePastedNumber(text);
          if (n == null) setL(row, { formulas: xf.clearFormula(l, col) } as Partial<SheetLine>);
          else xf.setFormula(row, col, `=${numRaw(n)}`);
        }
        setDirty(true);
        return;
      }
      if (NUM_COLS.includes(col)) {
        if (text.trim().startsWith("=")) {
          xf.setFormula(row, col, text);
          setDirty(true);
        } else setL(row, { [col]: text.trim() === "" ? null : parsePastedNumber(text), formulas: xf.clearFormula(l, col) } as Partial<SheetLine>);
      } else setL(row, { [col]: text } as Partial<SheetLine>);
    },
    onUndo: hist.undo,
    onRedo: hist.redo,
  };
  // ô số có công thức: hiện công thức khi bấm vào, lưu công thức; gõ số thường thì bỏ công thức
  const fProps = (l: SheetLine, f: string) => {
    const err = xf.errors[`${l.id}|${f}`];
    const has = !!l.formulas?.[f];
    return {
      formula: xf.formulaOf(l, f) || undefined,
      onCommitFormula: (t: string) => {
        xf.setFormula(l.id, f, t);
        setDirty(true);
      },
      title: err ? `Lỗi công thức ${err}: ${xf.formulaOf(l, f)}` : has ? `Công thức: ${xf.formulaOf(l, f)}` : undefined,
      fx: has ? (err ? " !text-red-600 !bg-red-50" : " !bg-indigo-50 italic") : "",
    };
  };

  // ---- ô nhập ----
  const cellIn = "w-full min-w-0 bg-sky-50/70 px-1 py-0.5 font-[inherit] text-[12px] outline-none focus:bg-sky-100";
  const miss = "!bg-red-100";
  // Gõ tiếng Việt có dấu (Telex/VNI): chỉ cập nhật bảng khi đã ghép dấu xong (compositionend), không cập nhật giữa lúc đang ghép — nếu không dấu bị cắt
  // Ô chữ KHÔNG điều khiển (uncontrolled): trình duyệt giữ chữ đang gõ, React không ghi đè giá trị giữa lúc bộ gõ (Unikey/Telex/VNI) xoá-gõ lại dấu
  // → không mất chữ. Mỗi lần gõ vẫn báo lên state; khi giá trị đổi từ nơi khác (hoàn tác, đọc lại...) và ô không đang gõ thì cập nhật lại ô.
  const imeSafe = (value: string, apply: (v: string) => void) => ({
    defaultValue: value,
    ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (el && document.activeElement !== el && el.value !== value) el.value = value;
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => apply(e.target.value),
  });
  // multi = chữ dài tự XUỐNG DÒNG, ô cao theo nội dung (nội dung công việc, ghi chú) — không bị che mất chữ
  const txt = (l: SheetLine, f: keyof SheetLine, editable: boolean, extra = "", isMissing = false, multi = false) =>
    editable ? (
      <td className="p-0" {...xcell(l.id, f)}>
        {multi ? (
          <textarea
            rows={1}
            style={{ fieldSizing: "content" } as React.CSSProperties}
            className={`${cellIn} block resize-none overflow-hidden whitespace-pre-wrap break-words ${extra} ${isMissing ? miss : ""}`}
            {...imeSafe(String(l[f] ?? ""), (v) => setL(l.id, { [f]: v } as Partial<SheetLine>))}
          />
        ) : (
          <input className={`${cellIn} ${extra} ${isMissing ? miss : ""}`} {...imeSafe(String(l[f] ?? ""), (v) => setL(l.id, { [f]: v } as Partial<SheetLine>))} />
        )}
      </td>
    ) : (
      <td className={`${extra} ${multi ? "whitespace-pre-line break-words" : ""}`}>{String(l[f] ?? "")}</td>
    );
  const numCell = (l: SheetLine, f: "qty" | "cdtPrice" | "basePrice" | "sitePrice" | "ptPrice", editable: boolean, isMissing = false, red = false, warn = "") =>
    editable ? (
      <td className={`p-0 ${warn ? "xl-warn" : ""}`} title={warn || undefined} {...xcell(l.id, f)}>
        {(() => {
          const fp = fProps(l, f);
          return (
            <NumInput
              decimals
              qty={f === "qty"}
              allowEmpty
              allowFormula
              placeholder=""
              value={l[f]}
              formula={fp.formula}
              onCommitFormula={fp.onCommitFormula}
              title={fp.title}
              onCommit={(v) => setL(l.id, { [f]: v, formulas: xf.clearFormula(l, f) } as Partial<SheetLine>)}
              className={`${cellIn} text-right ${isMissing ? miss : ""} ${red ? "text-red-600" : ""}${warn ? " !bg-orange-100" : ""}${fp.fx}`}
            />
          );
        })()}
      </td>
    ) : (
      <td className={`num ${red ? "text-red-600" : ""} ${warn ? "bg-orange-100" : ""}`} title={warn || undefined} {...xcell(l.id, f)}>
        {f === "qty" ? fq(l[f]) : fm(l[f])}
      </td>
    );

  // ô THÀNH TIỀN / TỔNG (dòng công việc, dòng nhóm, TỔNG CỘNG): tự tính; bấm vào gõ "=công thức" như Excel (VD =E5*F5*1,05 hay =SUM(K5:K20)),
  // gõ số = ghi đè số tự tính, xoá trống = về lại số tự tính. QSTT sửa 3 cột đầu, Trưởng phòng sửa cột duyệt.
  const amtCell = (l: SheetLine, f: "cdtAmount" | "baseAmount" | "siteAmount" | "apprAmount", value: number | null, cls = "") => {
    if (!canEdit(l, f) || (f === "apprAmount" && l.level === "ITEM" && !l.tpOk))
      return (
        <td className={`num ${cls}`} {...xcell(l.id, f)}>
          {fm(value)}
        </td>
      );
    const fp = fProps(l, f);
    return (
      <td className="p-0" {...xcell(l.id, f)}>
        <NumInput
          decimals
          allowEmpty
          allowFormula
          money
          placeholder=""
          value={value}
          formula={fp.formula ?? (autoFormula(l, f) || undefined)}
          onCommitFormula={fp.onCommitFormula}
          title={fp.title}
          onCommit={(v) => {
            if (v == null) setL(l.id, { formulas: xf.clearFormula(l, f) } as Partial<SheetLine>);
            else {
              xf.setFormula(l.id, f, `=${numRaw(v)}`);
              setDirty(true);
            }
          }}
          className={`${cellIn} text-right ${cls}${fp.fx}`}
        />
      </td>
    );
  };

  const groupCls = "bg-yellow-100 font-bold";
  // Khối "GIÁ CƠ SỞ ĐỀ XUẤT" gộp với "KIỂM SOÁT THEO DT-CP HỢP ĐỒNG" (7 cột); mẫu ngoài HĐ: cột "Đơn giá DT-CP" cũng chính là cột này.
  // Khối duyệt = KHỐI KT-KH (Trưởng phòng duyệt; mẫu ngoài HĐ: khối "GIÁ ĐỀ XUẤT CỦA P.ĐT-TT", 5 cột)
  const colsCount = 3 + 3 + 3 + (isOut ? 3 : 4) + 1 + (isOut ? 5 : 4);
  // Độ rộng CỐ ĐỊNH từng cột (px) theo thứ tự cột của bảng: số tiền đủ chỗ "999.999.999.999", ghi chú rộng hơn
  const MONEY = 108;
  const PRICE = 96;
  const colW = [
    58, 260, 52, // STT (kèm số dòng), Nội dung, ĐVT
    74, PRICE, MONEY, // Chủ đầu tư: KL, Đơn giá, Thành tiền
    PRICE, MONEY, 150, // Giá cơ sở đề xuất: Đơn giá, Thành tiền, Ghi chú (phần mềm tự ghi)
    ...(isOut ? [PRICE, MONEY, 150] : [82, PRICE, MONEY, 150]), // Giá đề xuất của công trình
    150, // Ghi chú QSTT
    ...(isOut ? [48, 82, 104, MONEY, 170] : [48, 104, MONEY, 170]), // Phòng Đấu thầu - Thanh toán
  ];
  const tableW = colW.reduce((s, w) => s + w, 0);
  // cửa sổ toàn màn hình: thanh nút Trình / Duyệt luôn hiện ở đáy cửa sổ, không phải cuộn xuống tìm
  const stickyBar = "sticky bottom-0 z-20 shadow-[0_-4px_12px_rgba(15,23,42,0.12)]";
  const tpTitle = `${isOut ? "GIÁ ĐỀ XUẤT CỦA KHỐI KT-KH" : "KHỐI KT-KH"}${head.category ? ` (${categoryLabel(head.category)})` : ""}`;

  return (
    <div className="space-y-3">
      <FormSheet>
        <FormLetterhead />
        <p className="text-right text-[11px] italic">Mẫu : ĐTKSTT- ĐXĐGĐ 01/2020</p>
        <h1 className="mt-1 text-center text-[20px] font-bold">{isOut ? "BẢNG TỔNG HỢP ĐỀ XUẤT ĐƠN GIÁ NHÂN CÔNG NGOÀI HỢP ĐỒNG, PHỤ LỤC" : "BẢNG TỔNG HỢP ĐƠN GIÁ NHÂN CÔNG TRÌNH DUYỆT"}</h1>

        <table className="mx-auto mt-2 w-[80%] text-[13px] font-bold">
          <tbody>
            {(
              [
                ["projectName", "CÔNG TRÌNH"],
                ["contractNo", "THUỘC HỢP ĐỒNG VỚI CĐT SỐ"],
                ["projectCode", "MÃ SỐ DỰ ÁN"],
                ["itemName", "HẠNG MỤC"],
                ...(isOut ? [["quoteStatus", "TÌNH TRẠNG BÁO GIÁ"]] : []),
              ] as [keyof HeadInput, string][]
            ).map(([f, label]) => {
              const need = he && (f === "projectName" || f === "itemName") && !head[f];
              return (
                <tr key={f}>
                  <td className="w-64 whitespace-nowrap py-0.5">{label}</td>
                  <td className="w-3">:</td>
                  <td className="py-0.5">
                    {he && f === "projectName" ? (
                      <SitePicker
                        sites={sites}
                        value={head.siteId}
                        invalid
                        className="text-[13px] font-bold"
                        placeholder={head.projectName && !head.siteId ? `Trong file ghi “${head.projectName}” — chọn dự án tương ứng trong danh mục` : undefined}
                        disabled={!!contracts.find((c) => c.id === curCid)?.siteId}
                        title={contracts.find((c) => c.id === curCid)?.siteId ? "Theo dự án của hợp đồng (DT-CP) đã chọn" : `Chọn dự án trong Danh mục dự án${head.projectName ? ` — trong file ghi: ${head.projectName}` : ""}`}
                        onChange={(s) => setH({ siteId: s?.id ?? "", projectName: s?.name ?? "", projectCode: s?.code || head.projectCode })}
                      />
                    ) : he ? (
                      <input className={`w-full border-b border-dotted border-slate-500 bg-sky-50/70 px-1 font-[inherit] text-[13px] font-bold outline-none focus:bg-sky-100 ${need ? miss : ""}`} {...imeSafe(head[f] ?? "", (v) => setH({ [f]: v }))} placeholder={need ? "Thiếu — QSTT bổ sung" : ""} />
                    ) : (
                      <span className="block border-b border-dotted border-slate-400 px-1">{head[f] || " "}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td className="py-0.5">HỢP ĐỒNG (DT-CP)</td>
              <td>:</td>
              <td className="py-0.5">
                {he || (canFillLater && status !== "DRAFT") ? (
                  <select
                    className={`w-full border-b border-dotted border-slate-500 bg-sky-50/70 px-1 font-[inherit] text-[13px] font-bold outline-none ${hx ? (hc === "@later" ? "!bg-amber-100 text-amber-800" : !hc ? miss : "") : !contractId && !dtcpLater ? miss : dtcpLater ? "!bg-amber-100 text-amber-800" : ""}`}
                    value={hx ? hc : (contractId ?? (dtcpLater ? "@later" : ""))}
                    disabled={pending}
                    onChange={(e) => {
                      if (!hx) return changeContract(e.target.value);
                      const c = contracts.find((x) => x.id === e.target.value);
                      setHc(e.target.value);
                      setHeadDirty(true);
                      setDirty(true);
                      if (c?.siteId) setH({ siteId: c.siteId });
                    }}
                  >
                    {he && <option value="">— Chọn hợp đồng (DT-CP) để kiểm soát giá —</option>}
                    <option value="@later">⏳ Chưa có DT-CP — bổ sung sau{status !== "DRAFT" && !hx ? " (chọn hợp đồng để bổ sung)" : ""}</option>
                    {contracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`block border-b border-dotted border-slate-400 px-1 ${dtcpLater && !contractId ? "text-amber-700" : ""}`}>
                    {contracts.find((c) => c.id === contractId)?.label ?? (dtcpLater ? "⏳ Chưa có DT-CP — bổ sung sau" : "—")}
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td className="py-0.5">TÊN TỔ ĐỘI</td>
              <td>:</td>
              <td className="py-0.5">
                {he ? (
                  <input className="w-full border-b border-dotted border-slate-500 bg-sky-50/70 px-1 font-[inherit] text-[13px] font-bold outline-none focus:bg-sky-100" {...imeSafe(head.crewName, (v) => setH({ crewName: v }))} placeholder="Để trống nếu chưa có đội" />
                ) : (
                  <span className="block border-b border-dotted border-slate-400 px-1">{head.crewName || "(chưa có đội)"}</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="py-0.5">ĐỢT</td>
              <td>:</td>
              <td className="py-0.5">
                {he ? (
                  <span className="flex items-center gap-2">
                    <input className={`w-24 border-b border-dotted border-slate-500 bg-sky-50/70 px-1 font-[inherit] text-[13px] font-bold outline-none ${!head.batch ? miss : ""}`} {...imeSafe(head.batch, (v) => setH({ batch: v }))} />
                    (Ngày
                    <input className="w-40 border-b border-dotted border-slate-500 bg-sky-50/70 px-1 font-[inherit] text-[13px] font-bold outline-none" {...imeSafe(head.batchDate, (v) => setH({ batchDate: v }))} placeholder="dd/mm/yyyy" />)
                  </span>
                ) : (
                  <span className="block border-b border-dotted border-slate-400 px-1">
                    {head.batch} {head.batchDate && `(Ngày ${head.batchDate})`}
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td className="py-0.5">LẦN TRÌNH</td>
              <td>:</td>
              <td className="py-0.5">
                <span className={`block px-1 ${revision > 1 ? "text-red-600" : ""}`}>Lần {revision}</span>
              </td>
            </tr>
          </tbody>
        </table>
        {hx && (
          <div className="mx-auto mt-1 flex flex-wrap items-center gap-2 font-sans text-[12px] text-slate-600">
            <span>✎ {tp ? "Trưởng phòng" : "Quản trị"} sửa được thông tin đầu hồ sơ khi QSTT ghi sai — không ảnh hưởng giá duyệt.</span>
            <span className="flex-1" />
            <button type="button" disabled={pending || !headDirty} onClick={() => start(async () => { if (await saveHeadInfo()) { setDirty(false); router.refresh(); } })} className={`rounded px-3 py-1 font-medium text-white disabled:opacity-50 ${headDirty ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-500"}`}>
              {headDirty ? "💾 Lưu thông tin hồ sơ *" : "Lưu thông tin hồ sơ"}
            </button>
          </div>
        )}

        <ExcelGrid cols={qs ? ["stt", ...qsGridCols] : tp ? tpGridCols : []} refCols={xlCols} onPaste={qs || tp ? pasteGrid : undefined} xl={qs || tp ? xlApi : undefined} rowOps={qs ? { insert: insertLines, remove: removeLines } : undefined} notes={cellNotes} widthKey="gia-doi">
          <div className="xfreeze xfreeze-3 mt-3" style={{ "--fz1": "58px", "--fz2": "260px", "--fz3": "52px", "--fzh": "130px" } as React.CSSProperties}>
          <table className="tmn-grid xl-lines xl-rn text-[12px]" style={{ width: tableW, minWidth: tableW, tableLayout: "fixed" }}>
            <colgroup>
              {colW.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead className="text-center font-bold">
              <tr>
                <th rowSpan={2} className="w-8">STT</th>
                <th rowSpan={2} className="min-w-56">NỘI DUNG</th>
                <th rowSpan={2} className="w-12">ĐVT</th>
                <th colSpan={3}>{isOut ? "CHỦ ĐẦU TƯ ( DỰ KIẾN )" : "CHỦ ĐẦU TƯ"}</th>
                <th colSpan={3} className="bg-violet-100">GIÁ CƠ SỞ ĐỀ XUẤT (THEO DT-CP HỢP ĐỒNG)</th>
                <th colSpan={isOut ? 3 : 4}>GIÁ ĐỀ XUẤT CỦA CÔNG TRÌNH</th>
                <th rowSpan={2} className="bg-sky-100">
                  Ghi chú QSTT
                  <br />
                  Lý do vượt DT-CP
                </th>
                <th colSpan={isOut ? 5 : 4} className="bg-emerald-100">{tpTitle}</th>
              </tr>
              <tr>
                <th className="w-20">Khối lượng hợp đồng</th>
                <th className="w-20">Đơn giá (NC + VT hoàn thiện)</th>
                <th className="w-24">Thành tiền</th>
                <th className="bg-violet-100">Đơn giá cơ sở</th>
                <th className="bg-violet-100">Thành tiền</th>
                <th className="bg-violet-100">Ghi chú</th>
                {isOut ? (
                  <>
                    <th className="w-20">Đơn giá</th>
                    <th className="w-24">Thành tiền</th>
                    <th className="min-w-24">Ghi chú</th>
                  </>
                ) : (
                  <>
                    <th className="w-20">Ý kiến (Đồng ý / điều chỉnh)</th>
                    <th className="w-20">Đơn giá đề xuất lại nếu điều chỉnh</th>
                    <th className="w-24">Thành tiền</th>
                    <th className="min-w-24">Ghi chú (tham chiếu công trình gần nhất)</th>
                  </>
                )}
                <th className="w-10 bg-emerald-100">Duyệt</th>
                {isOut && <th className="w-20 bg-emerald-100">Ý kiến (Đồng ý / điều chỉnh)</th>}
                <th className="w-24 bg-emerald-100">{isOut ? "Đơn giá đề xuất lại" : "Đơn giá duyệt"}</th>
                <th className="w-24 bg-emerald-100">{isOut ? "Thành tiền" : "Thành tiền duyệt"}</th>
                <th className="min-w-32 bg-emerald-100">{isOut ? "Ghi chú (tham chiếu công trình)" : "Ý kiến phòng"}</th>
              </tr>
              {/* chữ cột A, B, C... như Excel (để gõ công thức, xem tên ô ở thanh công thức) */}
              <tr className="text-[9px] text-slate-400">
                {xlCols.map((k, i) => (
                  <th key={k} className="!py-0 font-normal">
                    {colLetter(i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                if (l.level === "NOTE")
                  return (
                    <tr key={l.id} className="group">
                      <td>{rowTools(l, i)}</td>
                      {qs ? (
                        <td colSpan={colsCount - 1} className="bg-yellow-200 p-0 font-bold" {...xcell(l.id, "content")}>
                          <textarea rows={1} style={{ fieldSizing: "content" } as React.CSSProperties} className={`${cellIn} block resize-none overflow-hidden whitespace-pre-wrap break-words !bg-yellow-200 font-bold`} {...imeSafe(l.content, (v) => setL(l.id, { content: v }))} />
                        </td>
                      ) : (
                        <td colSpan={colsCount - 1} className="bg-yellow-200 font-bold">
                          {l.content}
                        </td>
                      )}
                    </tr>
                  );
                if (l.level === "GROUP" || l.level === "SUB") {
                  const g = calc.group[i]!;
                  return (
                    <tr key={l.id} className={`group ${l.level === "GROUP" ? groupCls : "font-bold"}`}>
                      {qs ? (
                        <td className="p-0" {...xcell(l.id, "stt")}>
                          <input className={`${cellIn} text-center font-bold`} value={l.stt} onChange={(e) => setL(l.id, { stt: e.target.value })} />
                          {rowTools(l, i)}
                        </td>
                      ) : (
                        <td className="text-center">
                          {l.stt}
                          {rowTools(l, i)}
                        </td>
                      )}
                      {txt(l, "content", qs, "font-bold", false, true)}
                      <td />
                      <td />
                      <td />
                      {amtCell(l, "cdtAmount", g.cdt)}
                      <td />
                      {amtCell(l, "baseAmount", g.base)}
                      <td />
                      {isOut ? (
                        <>
                          <td />
                          {amtCell(l, "siteAmount", g.site)}
                          <td />
                        </>
                      ) : (
                        <>
                          <td />
                          <td />
                          {amtCell(l, "siteAmount", g.site)}
                          <td />
                        </>
                      )}
                      <td />
                      <td />
                      {isOut && <td />}
                      <td />
                      {amtCell(l, "apprAmount", g.appr)}
                      <td />
                    </tr>
                  );
                }
                if (l.level === "TOTAL")
                  return (
                    <tr key={l.id} className="bg-slate-200 font-bold">
                      <td />
                      <td className="py-1.5 text-center">TỔNG CỘNG</td>
                      <td />
                      <td />
                      <td />
                      {amtCell(l, "cdtAmount", calc.total.cdt)}
                      <td />
                      {amtCell(l, "baseAmount", calc.total.base)}
                      <td />
                      {isOut ? (
                        <>
                          <td />
                          {amtCell(l, "siteAmount", calc.total.site)}
                          <td />
                        </>
                      ) : (
                        <>
                          <td />
                          <td />
                          {amtCell(l, "siteAmount", calc.total.site)}
                          <td />
                        </>
                      )}
                      <td />
                      <td />
                      {isOut && <td />}
                      <td />
                      {amtCell(l, "apprAmount", calc.total.appr, "text-emerald-800")}
                      <td />
                    </tr>
                  );
                const r = calc.row[i]!;
                const sp = sitePriceOf(kind, l);
                const changed = l.tpPrice != null && r.prop != null && Math.abs(l.tpPrice - r.prop) > 0.5;
                const o = overOf(l);
                const ref = o.ref;
                const cum = ref ? ref.prevQty + (l.qty ?? 0) : null;
                const over = o.price || o.qty;
                const isParent = parents.has(i); // đầu mục chia nhỏ (2.1 → *, -, 2.1.1...): không bắt nhập
                return (
                  <tr key={l.id} className={`group ${!l.tpOk ? "bg-red-50" : l.added ? "bg-emerald-50/60" : ""}`}>
                    {qs ? (
                      <td className="p-0" title="Dòng QSTT thêm (không có trong file BCH gửi)" {...xcell(l.id, "stt")}>
                        <input className={`${cellIn} text-center`} value={l.stt} onChange={(e) => setL(l.id, { stt: e.target.value })} placeholder="+" />
                        {rowTools(l, i)}
                      </td>
                    ) : (
                      <td className="text-center" title={l.added ? "Dòng QSTT thêm (không có trong file BCH gửi)" : undefined}>
                        {l.stt}
                        {l.added && !l.stt && <span className="text-emerald-700">+</span>}
                        {rowTools(l, i)}
                      </td>
                    )}
                    {txt(l, "content", qs, "", qs && !l.content, true)}
                    {txt(l, "unit", qs, "text-center", qs && !l.unit && !isParent)}
                    {numCell(l, "qty", qs, qs && l.qty == null && !isParent)}
                    {numCell(l, "cdtPrice", qs)}
                    {amtCell(l, "cdtAmount", r.cdt)}
                    {/* ---- GIÁ CƠ SỞ ĐỀ XUẤT = đơn giá kiểm soát của dòng DT-CP tự khớp (rê chuột xem dòng DT-CP); chưa khớp thì giá trong file ---- */}
                    {ref ? (
                      <td
                        className={`num bg-violet-50/60 ${o.price ? "font-bold text-red-600" : "font-semibold"}`}
                        {...xcell(l.id, "basePrice")}
                        title={`Theo DT-CP: ${ref.name} (${ref.unit})${ref.latest != null && ref.latest !== ref.price ? ` — thời điểm mới nhất: ${fm(ref.latest)}` : ""}`}
                      >
                        {fm(ref.price)}
                        {o.price && " ⚠"}
                      </td>
                    ) : (
                      numCell(l, "basePrice", qs, qs && !isOut && !sp && !isParent, o.price)
                    )}
                    {amtCell(l, "baseAmount", r.base)}
                    {/* Ghi chú: QSTT sửa được (ghi chú trong file BCH gửi hoặc tự gõ); phần mềm hiện thêm trạng thái khớp DT-CP + cảnh báo vượt bên dưới */}
                    <td className={qs ? "p-0 align-top" : "text-[11px] align-top"} title={ref ? `Dòng DT-CP: ${ref.name} (${ref.unit})` : undefined} {...(qs ? xcell(l.id, "baseNote") : {})}>
                      {qs ? (
                        <textarea
                          rows={1}
                          style={{ fieldSizing: "content" } as React.CSSProperties}
                          className={`${cellIn} block resize-none overflow-hidden whitespace-pre-wrap break-words`}
                          placeholder="Ghi chú…"
                          {...imeSafe(l.baseNote, (v) => setL(l.id, { baseNote: v }))}
                        />
                      ) : (
                        l.baseNote && <span className="block whitespace-pre-line break-words text-slate-800">{l.baseNote}</span>
                      )}
                      <span className="block px-1 text-[11px]">
                        {ref ? <span className="text-emerald-700">Đã khớp DT-CP</span> : l.lineKey === "-" ? <span className="text-slate-500">Ngoài DT-CP</span> : <span className="text-amber-700">Chưa khớp DT-CP</span>}
                        {o.price && <span className="block font-semibold text-red-600">⚠ Vượt giá cơ sở</span>}
                        {o.qty && ref && (
                          <span className="block font-semibold text-red-600">
                            ⚠ Vượt KL DT-CP ({fq(cum)} / {fq(ref.qty)})
                          </span>
                        )}
                      </span>
                      {(qs || tp) && contractId && l.level === "ITEM" && !isParent && (
                        <div className="px-1 pb-1 text-[11px]">
                          <button
                            type="button"
                            className="text-blue-700 underline decoration-dotted hover:text-blue-900"
                            onClick={() => {
                              setMatchQ("");
                              setMatchRow(matchRow === l.id ? null : l.id);
                            }}
                          >
                            {ref ? "Đổi dòng DT-CP khớp" : "Xem giá DT-CP gần giống / chọn khớp"}
                          </button>
                          {matchRow === l.id && (
                            <div className="mt-1 space-y-1 rounded border border-blue-200 bg-blue-50/60 p-1.5">
                              <input value={matchQ} onChange={(e) => setMatchQ(e.target.value)} placeholder="Gõ tên công tác DT-CP để tìm…" className="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] outline-none" />
                              {candidatesOf(l).map(({ r }) => (
                                <button key={r.key} type="button" disabled={pending} onClick={() => pickMatch(l, r.key)} className={`block w-full rounded border bg-white px-1.5 py-1 text-left hover:bg-emerald-50 ${r.key === l.lineKey ? "border-emerald-500" : "border-slate-200"}`} title="Bấm để chọn khớp dòng DT-CP này">
                                  <span className="block font-medium text-slate-800">{r.name}</span>
                                  <span className="block text-slate-600">
                                    {r.unit} · KL DT-CP {fq(r.qty)} · <b className="text-violet-800">Đơn giá DT-CP {fm(r.price)}</b>
                                    {r.latest != null && r.latest !== r.price ? ` (mới nhất ${fm(r.latest)})` : ""}
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
                    {/* ---- GIÁ ĐỀ XUẤT CỦA CÔNG TRÌNH ---- */}
                    {isOut ? (
                      <>
                        {numCell(l, "sitePrice", qs, qs && !sp && !isParent, true, overCdt(l))}
                        {amtCell(l, "siteAmount", r.site)}
                        {txt(l, "siteNote", qs, "", false, true)}
                      </>
                    ) : (
                      <>
                        {txt(l, "siteOpinion", qs, "text-center")}
                        {numCell(l, "sitePrice", qs, false, true, overCdt(l))}
                        {amtCell(l, "siteAmount", r.site)}
                        {txt(l, "siteNote", qs, "", false, true)}
                      </>
                    )}
                    {txt(l, "qsNote", qs, "bg-sky-50/40", qs && over && !l.qsNote.trim() && !l.overReason.trim(), true)}
                    {/* ---- KHỐI KT-KH ---- */}
                    <td className="text-center">
                      {qs || tp ? (
                        <input type="checkbox" className="h-4 w-4" checked={l.tpOk} onChange={(e) => setL(l.id, { tpOk: e.target.checked })} title="Bỏ dấu = không đồng ý dòng này" />
                      ) : l.tpOk ? (
                        ""
                      ) : (
                        <span className="font-bold text-red-600">✕</span>
                      )}
                    </td>
                    {isOut &&
                      (qs ? (
                        <td className="p-0">
                          <select
                            className={`${cellIn} text-center ${!l.tpOk ? "text-red-600" : changed ? "text-blue-700" : ""}`}
                            value={opinionOf(kind, l)}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "Không đồng ý") setL(l.id, { tpOk: false });
                              else if (v === "Đồng ý") setL(l.id, { tpOk: true, tpPrice: null, formulas: xf.clearFormula(l, "tpPrice") });
                              else {
                                setL(l.id, { tpOk: true });
                                // Điều chỉnh: nhảy tới ô Đơn giá đề xuất lại để nhập giá
                                setTimeout(() => document.querySelector<HTMLInputElement>(`[data-xr="${CSS.escape(l.id)}"][data-xc="tpPrice"] input`)?.focus(), 0);
                              }
                            }}
                            title="Đồng ý = theo giá công trình · Điều chỉnh = nhập Đơn giá đề xuất lại · Không đồng ý = bỏ dòng"
                          >
                            <option>Đồng ý</option>
                            <option>Điều chỉnh</option>
                            <option>Không đồng ý</option>
                          </select>
                        </td>
                      ) : (
                        <td className={`text-center ${!l.tpOk ? "text-red-600" : changed ? "text-blue-700" : ""}`}>{opinionOf(kind, l)}</td>
                      ))}
                    {qs || tp ? (
                      <td className="p-0" {...xcell(l.id, "tpPrice")}>
                        {(() => {
                          const fp = fProps(l, "tpPrice");
                          return (
                            <NumInput decimals allowEmpty allowFormula value={l.tpPrice} placeholder={fm(r.prop)} disabled={!l.tpOk} formula={fp.formula} onCommitFormula={fp.onCommitFormula} title={fp.title} onCommit={(v) => setL(l.id, { tpPrice: v, formulas: xf.clearFormula(l, "tpPrice") })} className={`${cellIn} text-right font-bold ${changed ? "text-blue-700" : ""}${fp.fx}`} />
                          );
                        })()}
                      </td>
                    ) : (
                      <td className={`num font-bold ${changed ? "text-blue-700" : ""}`} {...xcell(l.id, "tpPrice")}>
                        {fm(approvedPriceOf(kind, l))}
                      </td>
                    )}
                    {amtCell(l, "apprAmount", r.appr, "font-bold")}
                    {txt(l, "tpNote", qs || tp, "", false, true)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </ExcelGrid>
        {qs && (
          <div className="mt-1 flex flex-wrap items-center gap-3 font-sans text-[11px] text-slate-500">
            <button type="button" onClick={() => addLineAfter(lines.length - 2)} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-800 hover:bg-emerald-100">
              ＋ Thêm dòng cuối bảng
            </button>
            <span>
              Rê chuột vào ô <b>STT</b> của một dòng: <b className="text-emerald-700">＋</b> thêm dòng mới bên dưới, <b className="text-red-600">✕</b> xoá dòng. Dòng QSTT thêm có nền xanh nhạt. Bấm <b>Lưu nháp</b> để lưu.
            </span>
          </div>
        )}
        {(tp || mode === "view") && (
          <p className="mt-1 font-sans text-[11px] text-slate-500">
            Đơn giá duyệt để trống = theo giá đề xuất (chữ xám). Số <span className="font-bold text-blue-700">xanh</span> = Trưởng phòng đã sửa. Dòng bỏ dấu ✓ = không đồng ý (thành tiền duyệt = 0).
          </p>
        )}

        <div className="mt-4 grid gap-4 text-[13px] sm:grid-cols-2">
          <div>
            <p className="font-bold">Ý kiến của Khối Kinh Tế - Kế Hoạch (QSTT):</p>
            {qs ? (
              <textarea className="mt-1 w-full rounded border border-slate-300 bg-sky-50/70 p-1.5 font-[inherit] text-[13px]" rows={3} {...imeSafe(head.qsNote, (v) => setH({ qsNote: v }))} placeholder="Ghi chú khi kiểm tra (nếu có)" />
            ) : (
              <p className="mt-1 whitespace-pre-line">{head.qsNote || "—"}</p>
            )}
          </div>
          <div>
            <p className="font-bold">Ý kiến của Trưởng phòng:</p>
            {tp ? (
              <textarea className="mt-1 w-full rounded border border-slate-300 bg-emerald-50/70 p-1.5 font-[inherit] text-[13px]" rows={3} {...imeSafe(head.tpNote, (v) => setH({ tpNote: v }))} placeholder="Ý kiến chung (bắt buộc khi không duyệt)" />
            ) : (
              <p className="mt-1 whitespace-pre-line">{head.tpNote || "—"}</p>
            )}
          </div>
        </div>
      </FormSheet>

      {qs && missing.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <b>Hồ sơ còn thiếu {missing.length} mục</b> (ô tô đỏ) — QSTT bổ sung trước khi trình:
          <ul className="mt-1 list-disc pl-5 text-xs">
            {missing.slice(0, 12).map((m) => (
              <li key={m}>{m}</li>
            ))}
            {missing.length > 12 && <li>... và {missing.length - 12} mục khác</li>}
          </ul>
        </div>
      )}

      {qs && (
        <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 ${ws ? stickyBar : ""}`}>
          <span className="text-sm font-medium text-slate-700">Trình Trưởng phòng:</span>
          <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={head.category} onChange={(e) => setHead((h) => ({ ...h, category: e.target.value }))}>
            <option value="">— Chọn hạng mục —</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending}
            className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            onClick={async () => {
              if (!head.category) return window.alert("Chọn hạng mục (Trưởng phòng duyệt) trước khi trình");
              if (missing.length) return window.alert(`Hồ sơ còn thiếu ${missing.length} mục (ô tô đỏ), bổ sung trước khi trình.`);
              if (!(await confirmNear(`Lưu và trình ${categoryLabel(head.category)} duyệt hồ sơ này?`))) return;
              start(async () => {
                if (after(await submitPriceAction(id, head.category, ...qsPayload()))) ws?.done(`Đã trình ${categoryLabel(head.category)} duyệt`);
              });
            }}
          >
            Lưu & trình duyệt →
          </button>
          <button type="button" disabled={pending} onClick={() => start(async () => void after(await savePriceDraftAction(id, ...qsPayload())))} className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${dirty ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-600 hover:bg-slate-700"}`}>
            {pending ? "Đang lưu..." : dirty ? "Lưu nháp *" : "Lưu nháp"}
          </button>
          {contractId && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r1 = await savePriceDraftAction(id, ...qsPayload());
                  if (!r1.ok) return window.alert(r1.error);
                  const r = await rematchPriceAction(id);
                  if (!r.ok) return window.alert(r.error);
                  if (r.info) window.alert(r.info);
                  setDirty(false);
                  router.refresh();
                })
              }
              className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-100"
            >
              Tự khớp các dòng chưa khớp
            </button>
          )}
          {dirty && <span className="text-xs text-amber-700">* Có thay đổi chưa lưu</span>}
        </div>
      )}

      {tp && adjust && (
        <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 p-3 ${ws ? `${stickyBar} bg-amber-50` : "bg-amber-50/60"}`}>
          <span className="text-sm text-slate-700">
            Điều chỉnh giá sau duyệt — tổng giá trị duyệt: <b className="text-base text-amber-800">{fm(calc.total.appr)} đ</b>
          </span>
          <span className="flex-1" />
          <button
            type="button"
            disabled={pending}
            className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            onClick={() => {
              start(async () => {
                if (!(await saveHeadInfo())) return;
                if (after(await adjustApprovedPriceAction(id, "", head.tpNote, tpPayload(), totalPayload()))) ws?.done(`Đã điều chỉnh giá sau duyệt (${fm(calc.total.appr)} đ) — hồ sơ về QSTT để gửi lại mail kết quả`);
              });
            }}
          >
            ✓ Lưu điều chỉnh
          </button>
        </div>
      )}

      {tp && !adjust && (
        <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 p-3 ${ws ? `${stickyBar} bg-emerald-50` : "bg-emerald-50/50"}`}>
          <span className="text-sm text-slate-700">
            Tổng giá trị duyệt: <b className="text-base text-emerald-800">{fm(calc.total.appr)} đ</b>
          </span>
          <span className="flex-1" />
          {dtcpPanel}
          <button type="button" disabled={pending} onClick={() => start(async () => { if (await saveHeadInfo()) after(await saveTpDraftAction(id, head.tpNote, tpPayload(), totalPayload())); })} className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${dirty ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-600 hover:bg-slate-700"}`}>
            {dirty ? "Lưu nháp *" : "Lưu nháp"}
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-md border border-red-300 bg-white px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            onClick={async () => {
              if (!head.tpNote.trim()) return window.alert("Nhập lý do không duyệt vào ô \"Ý kiến của Trưởng phòng\"");
              if (!(await confirmNear("KHÔNG DUYỆT hồ sơ này và trả về QSTT?"))) return;
              start(async () => {
                if (!(await saveHeadInfo())) return;
                if (after(await decidePriceAction(id, false, head.tpNote, tpPayload(), totalPayload()))) ws?.done("Đã KHÔNG DUYỆT và trả hồ sơ về QSTT");
              });
            }}
          >
            ✕ Không duyệt
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            onClick={async () => {
              if (!(await confirmNear(`DUYỆT hồ sơ với tổng giá trị ${fm(calc.total.appr)} đ và trả về QSTT?`))) return;
              start(async () => {
                if (!(await saveHeadInfo())) return;
                if (after(await decidePriceAction(id, true, head.tpNote, tpPayload(), totalPayload()))) ws?.done(`Đã DUYỆT hồ sơ (${fm(calc.total.appr)} đ) và trả về QSTT`);
              });
            }}
          >
            ✓ Duyệt hồ sơ
          </button>
        </div>
      )}
    </div>
  );
}
