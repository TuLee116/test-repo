"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { analyzeSubFileAction, subSheetPreviewAction, uploadSubFileAction, type SubImportChoice, type SubImportItem } from "@/lib/thau-phu-actions";
import { AWARD_FORMS, awardNeed, PL_KINDS } from "@/lib/thau-phu-calc";
import NumInput from "../../NumInput";
import type { SubMapping, SubSheetPreview } from "@/lib/thau-phu-excel";

// NHẬP FILE THẦU PHỤ: chọn file → chọn sheet (nhiều sheet được, mỗi sheet 1 hồ sơ) → BẢNG CHỌN CỘT cho từng sheet:
// nội dung công việc, giá chủ đầu tư, giá cơ sở, thầu phụ 1/2/3..., giá đề xuất / duyệt. Phần mềm chỉ GỢI Ý sẵn (từ chữ tiêu đề); người dùng kiểm tra / sửa rồi mới nhập.
// Lựa chọn được NHỚ theo chữ tiêu đề của bảng để lần sau file cùng mẫu tự điền lại.
type Trio = { qty?: number; price?: number; amount?: number; vt?: number; nc?: number; tb?: number };
type M = { award?: number[]; hr: number; first: number; stt?: number; workName?: number; content?: number; code?: number; origin?: number; unit?: number; note?: number; material?: number; dims: number[]; cdt: Trio; base: Trio; prop: Trio; hd?: Trio; plAmount?: number; cdtHd?: Trio; baseHd?: Trio; cdtPl?: number; basePl?: number; bids: ({ name: string } & Trio)[] };
type SheetState = { loading?: boolean; preview?: SubSheetPreview; m?: M };

const REMEMBER = "sub-import-maps";
const letter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const normKey = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, "");

const fromGuess = (g: SubMapping | null): M => {
  if (!g) return { hr: 0, first: 0, dims: [], cdt: {}, base: {}, prop: {}, bids: [] };
  const c = g.colMap;
  return {
    hr: g.hr,
    first: g.first ?? g.hr + 2,
    stt: c.stt,
    workName: c.workName,
    content: c.content,
    code: c.code,
    origin: c.origin,
    unit: c.unit,
    note: c.note,
    material: c.material, // nội thất: mô tả vật liệu
    dims: c.dims ?? [],
    cdt: { ...c.cdt },
    base: { ...c.base },
    prop: { ...c.prop },
    hd: { ...(c.hd ?? {}) }, // PLHĐ điều chỉnh: cột theo hợp đồng gốc (tự nhận từ tiêu đề)
    plAmount: c.plAmount,
    cdtHd: { ...(c.cdtHd ?? {}) },
    baseHd: { ...(c.baseHd ?? {}) },
    cdtPl: c.cdtPl,
    basePl: c.basePl,
    bids: g.bidders.map((b) => ({ name: b.name, ...(c.bids?.[b.key] ?? {}) })),
  };
};
// PLHĐ điều chỉnh (file có cột theo hợp đồng gốc) hoặc QSĐT chọn loại phụ lục điều chỉnh
const isAdjM = (m: M, plKind: string) => plKind === "DIEU_CHINH" || !!(m.hd && (m.hd.qty || m.hd.price || m.hd.amount));
// LỰA CHỌN PHÊ DUYỆT (% khối lượng từng thầu phụ): chưa chọn gì = thầu phụ đầu tiên 100%
const awardOf = (m: M, i: number) => (m.award ? m.award[i] ?? 0 : i === 0 ? 100 : 0);
const awardTotal = (m: M) => m.bids.reduce((s, _, i) => s + awardOf(m, i), 0);
const noTb = (t: Trio): Trio => ({ ...t, tb: undefined }); // MEP không có thiết bị
// ÁP DỤNG CHUNG 1 KHỐI LƯỢNG: mọi khối (CĐT, cơ sở, thầu phụ, đề xuất) đọc KL từ CÙNG 1 cột — cột KL của CĐT, chưa chọn thì cột KL đầu tiên đã chọn
const shareQty = (m: M): M => {
  const q = m.cdt.qty ?? m.base.qty ?? m.bids.find((b) => b.qty)?.qty ?? m.prop.qty;
  return q == null ? m : { ...m, cdt: { ...m.cdt, qty: q }, base: { ...m.base, qty: q }, prop: { ...m.prop, qty: q }, bids: m.bids.map((b) => ({ ...b, qty: q })) };
};
// nt = NỘI THẤT: thêm cột mô tả vật liệu; 3 cột kích thước giữ đúng vị trí Dài / Rộng / Cao (0 = không có)
const toMapping = (m: M, adj = false, mep = false, mepT = false, nt = false): SubMapping => ({
  hr: m.hr,
  first: m.first || m.hr + 2,
  colMap: { stt: m.stt, workName: m.workName, content: m.content, code: m.code, ...(mep ? { origin: m.origin } : {}), ...(nt ? { nt: true, material: m.material } : {}), unit: m.unit, note: m.note, dims: nt ? [0, 1, 2].map((i) => m.dims[i] || 0) : m.dims, mepT: mep && mepT ? true : undefined, cdt: mep && !mepT ? noTb(m.cdt) : mep ? m.cdt : { ...m.cdt, vt: undefined, nc: undefined }, base: mep && !mepT ? noTb(m.base) : m.base, prop: !adj && m.bids.length ? {} : mep && !mepT ? noTb(m.prop) : m.prop, ...(!adj && m.bids.length ? { award: m.bids.map((_, i) => ({ key: `C${i + 1}`, pct: awardOf(m, i) })).filter((a) => a.pct > 0) } : {}), hd: m.hd ?? {}, plAmount: m.plAmount, cdtHd: m.cdtHd ?? {}, baseHd: m.baseHd ?? {}, cdtPl: m.cdtPl, basePl: m.basePl, bids: Object.fromEntries(m.bids.map((b, i) => [`C${i + 1}`, { qty: b.qty, price: b.price, amount: b.amount, vt: b.vt, nc: b.nc, tb: mep && !mepT ? undefined : b.tb }])) },
  bidders: m.bids.map((b, i) => ({ key: `C${i + 1}`, name: b.name.trim() || `C${i + 1}` })),
});

// TỰ DÒ DÒNG TIÊU ĐỀ: dòng đầu tiên có ô "STT" / "TT" kèm ô NỘI DUNG / CÔNG VIỆC / HẠNG MỤC; dòng dữ liệu đầu tiên = dòng đầu tiên bên dưới có chữ ở cột STT (bỏ qua tiêu đề tầng 2, 3 lặp lại chữ STT)
const gk = (s: string) => normKey(s).replace(/[^a-z0-9]/g, "");
const isStt = (s: string) => /^(stt|tt|sott|sothutu)$/.test(gk(s));
// loại cột theo chữ tiêu đề (cho danh sách chọn cột): stt / work / content / unit / qty / price (kể cả "Đơn giá vật tư", "Nhân công"...) / amount / code / note / dims
const headKind = (s: string) => {
  const k = gk(s);
  if (!k || k.length > 60) return "";
  if (isStt(s)) return "stt";
  if (/^(motavatlieu|vatlieu|motavl)/.test(k)) return "material"; // nội thất (trước "mô tả" = nội dung)
  if (/^(hangmuc|tennhom|nhom|phanloai)/.test(k)) return "work";
  if (/^(noidung|congviec|congtac|diengiai|mota|ten)/.test(k)) return "content";
  if (/^(dvt|donvi|dv)$|^donvi/.test(k)) return "unit";
  if (/^(khoiluong|soluong|kl|sl)/.test(k)) return "qty";
  if (/^(thanhtien|giatri|tongtien)/.test(k)) return "amount";
  if (/^(dongia|dg)/.test(k) || /^(vattu|nhancong|thietbi|vt|nc|tb)$/.test(k)) return "price";
  if (/^(masp|masanpham|ma|mahang|mavattu)$|^mahieu/.test(k)) return "code";
  if (/^(nhanhieu|xuatxu)/.test(k)) return "origin";
  if (/^ghichu/.test(k)) return "note";
  if (/^kichthuoc/.test(k)) return "dims";
  return "";
};
const kindOfHead = (s: string) => {
  const k = gk(s);
  if (isStt(s)) return "stt";
  if (/^(noidung|congviec|congtac|hangmuc|diengiai|mota|ten)/.test(k)) return "content";
  if (/^(dvt|donvi)/.test(k)) return "unit";
  if (/^(khoiluong|soluong|kl|sl)/.test(k)) return "qty";
  if (/^(dongia|dg)/.test(k)) return "price";
  if (/^(thanhtien|giatri)/.test(k)) return "amount";
  return "";
};
const detectHeader = (p: SubSheetPreview): { hr: number; first: number; stt: number } | null => {
  let best: { hr: number; first: number; stt: number } | null = null;
  let bestScore = 0;
  for (let r = 0; r < Math.min(p.rows.length, 60); r++) {
    const row = p.rows[r];
    const sj = row.findIndex(isStt);
    if (sj < 0 || !row.some((c, j) => j !== sj && kindOfHead(c) === "content")) continue;
    // nhiều dòng thoả (bảng phụ ở cột xa cũng có STT / NỘI DUNG) → chọn dòng có nhiều loại cột nhất: STT, nội dung, ĐVT + KL / đơn giá / thành tiền ở dòng ngay dưới
    const kinds = new Set(row.map(kindOfHead).filter(Boolean));
    for (const c of p.rows[r + 1] ?? []) {
      const k = kindOfHead(c);
      if (k === "qty" || k === "price" || k === "amount") kinds.add(k);
    }
    if (kinds.size <= bestScore) continue;
    let first = r + 3; // không thấy thì mặc định cách tiêu đề 1 dòng (như trước)
    for (let k = r + 1; k < Math.min(p.rows.length, r + 9); k++) {
      const v = p.rows[k][sj];
      if (v && !isStt(v)) {
        first = k + 1;
        break;
      }
    }
    bestScore = kinds.size;
    best = { hr: r + 1, first, stt: sj + 1 };
  }
  return best;
};
const ROMAN_RE = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/;
const fmtCell =(s: string) => (/^-?\d{4,}$/.test(s) ? Number(s).toLocaleString("vi-VN") : s);
const isNumLike = (s: string) => /^-?[\d.,]+$/.test(s) && /\d/.test(s);

// chữ ký của bảng = chữ tiêu đề (2 dòng) → nhận ra file cùng mẫu
const signature = (p: SubSheetPreview, hr: number) => (hr > 0 ? normKey([p.rows[hr - 1]?.join("|") ?? "", p.rows[hr]?.join("|") ?? ""].join("#")).slice(0, 400) : "");

export default function SubImportWizard({ title, hint }: { title: string; hint: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // BẢNG CHỌN hiện ra khi bấm "Chọn file Excel" (trước khi chọn file): HĐTP mới / phụ lục, loại phụ lục, hình thức giao thầu
  const [choosing, setChoosing] = useState(false);
  const [choice, setChoice] = useState<SubImportChoice>({ proposalType: "", plKind: "", awardForm: "", vtValue: null, tbValue: null });
  const [fileName, setFileName] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [active, setActive] = useState("");
  const [sheets, setSheets] = useState<Record<string, SheetState>>({});
  const [showAllCols, setShowAllCols] = useState(false); // danh sách chọn cột: chỉ đúng loại cột (mặc định) hay tất cả cột

  const fd = () => {
    const f = new FormData();
    f.set("file", fileRef.current!);
    return f;
  };

  const loadSheet = async (name: string) => {
    setSheets((s) => ({ ...s, [name]: { ...s[name], loading: true } }));
    const r = await subSheetPreviewAction(fd(), name);
    if (!r.ok || !r.preview) {
      setSheets((s) => ({ ...s, [name]: { loading: false } }));
      return window.alert(r.ok ? "Không đọc được sheet" : r.error);
    }
    const pv = r.preview;
    let m = fromGuess(pv.guess);
    // nội thất: chỉ có cột HẠNG MỤC CÔNG VIỆC (không có NỘI DUNG riêng) → đó là cột nội dung
    if (choice.isNt && !m.content && m.workName) m = { ...m, content: m.workName, workName: undefined };
    // file cùng mẫu đã nhập trước đó → điền lại lựa chọn cũ
    try {
      const mem = JSON.parse(localStorage.getItem(REMEMBER) || "{}") as Record<string, M>;
      const sig = signature(pv, m.hr);
      if (sig && mem[sig]) m = { ...mem[sig], hr: m.hr || mem[sig].hr };
    } catch {}
    // phần mềm chưa đoán được dòng tiêu đề → tự dò theo ô STT / TT
    if (!m.hr) {
      const d = detectHeader(pv);
      if (d) m = { ...m, hr: d.hr, first: d.first, stt: m.stt ?? d.stt };
    }
    setSheets((s) => ({ ...s, [name]: { loading: false, preview: pv, m } }));
  };

  const onFile = (file: File) =>
    start(async () => {
      fileRef.current = file;
      setFileName(file.name);
      const r = await analyzeSubFileAction(fd());
      if (!r.ok || !r.names) return window.alert(r.ok ? "Không đọc được file" : r.error);
      setNames(r.names);
      setSheets({});
      const first = r.names[0];
      setPicked([first]);
      setActive(first);
      void loadSheet(first);
    });

  const togglePick = (n: string, on: boolean) => {
    setPicked((p) => (on ? [...p, n] : p.filter((x) => x !== n)));
    if (on) {
      setActive(n);
      if (!sheets[n]?.preview && !sheets[n]?.loading) void loadSheet(n);
    } else if (active === n) setActive(picked.find((x) => x !== n) ?? "");
  };

  const setM = (name: string, patch: (m: M) => M) => setSheets((s) => (s[name]?.m ? { ...s, [name]: { ...s[name], m: patch(s[name].m!) } } : s));

  // tổng % chia cho các thầu phụ được phê duyệt phải = 100%
  const awardOk = (mm?: M) => !mm || isAdjM(mm, choice.plKind) || !mm.bids.length || Math.abs(awardTotal(mm) - 100) < 1e-6;
  const ready = picked.length > 0 && picked.every((n) => sheets[n]?.m?.content && sheets[n]?.m?.hr && awardOk(sheets[n]?.m));
  const doImport = () =>
    start(async () => {
      const items: SubImportItem[] = picked.map((n) => ({ sheet: n, mapping: toMapping(choice.oneQty && !isAdjM(sheets[n].m!, choice.plKind) ? shareQty(sheets[n].m!) : sheets[n].m!, isAdjM(sheets[n].m!, choice.plKind), !!choice.isMep && !choice.isNt, !!choice.mepTemp, !!choice.isNt) }));
      const r = await uploadSubFileAction(fd(), items, choice);
      if (!r.ok) return window.alert(r.error);
      try {
        const mem = JSON.parse(localStorage.getItem(REMEMBER) || "{}") as Record<string, M>;
        for (const n of picked) {
          const pv = sheets[n].preview;
          const m = sheets[n].m!;
          const sig = pv ? signature(pv, m.hr) : "";
          if (sig) mem[sig] = m;
        }
        localStorage.setItem(REMEMBER, JSON.stringify(mem));
      } catch {}
      if (r.info) window.alert(r.info);
      setOpen(false);
      router.push(r.id ? `/gia-doi/thau-phu/${r.id}` : "/gia-doi/thau-phu");
      router.refresh();
    });

  const inp = "rounded border border-slate-300 px-2 py-1 text-sm";
  const cur = active ? sheets[active] : undefined;
  const pv = cur?.preview;
  const m = cur?.m;
  // PLHĐ điều chỉnh: theo bảng chọn (QSĐT) hoặc file có cột theo hợp đồng gốc
  const adj = choice.plKind === "DIEU_CHINH" || !!(m?.hd && (m.hd.qty || m.hd.price || m.hd.amount));
  // giá chi tiết (vật tư, nhân công, thiết bị): theo bảng chọn hoặc file có các cột này
  const ct = choice.priceMode === "CHITIET" || (!!choice.isMep && !!choice.mepTemp) || !!(m && (m.prop.vt || m.prop.nc || m.prop.tb || m.bids.some((b) => b.vt || b.nc || b.tb)));

  // THÔNG TIN TỪNG CỘT theo các dòng tiêu đề (từ dòng tiêu đề đến trước dòng dữ liệu đầu tiên): tầng thấp nhất có chữ loại cột = loại cột; các tầng trên = tên khối (CHỦ ĐẦU TƯ, tên thầu phụ...)
  const colInfo = (() => {
    const out = new Map<number, { kind: string; label: string }>();
    if (!pv || !m?.hr) return out;
    const from = m.hr - 1;
    const to = Math.max(from + 1, (m.first || m.hr + 1) - 1);
    for (let c = 1; c <= pv.cols; c++) {
      const tiers: string[] = [];
      for (let r = from; r < to; r++) {
        const t = pv.rows[r]?.[c - 1] ?? "";
        if (t && gk(t) !== gk(tiers[tiers.length - 1] ?? "")) tiers.push(t);
      }
      let fi = -1;
      for (let i = tiers.length - 1; i >= 0; i--) if (headKind(tiers[i])) { fi = i; break; }
      let kind = fi >= 0 ? headKind(tiers[fi]) : "";
      // tầng thấp nhất chỉ là "Vật tư / Nhân công / Thiết bị" → loại cột theo tầng TRÊN nó (VD "THÀNH TIỀN ĐIỀU CHỈNH" / "Nhân công" là cột THÀNH TIỀN, không phải đơn giá)
      if (fi > 0 && /^(vattu|nhancong|thietbi|vt|nc|tb)$/.test(gk(tiers[fi]))) {
        for (let j = fi - 1; j >= 0; j--) {
          const kj = headKind(tiers[j]);
          if (kj === "amount" || kj === "qty" || kj === "price") {
            kind = kj;
            break;
          }
        }
      }
      const block = tiers.filter((_, i) => i !== fi).join(" / ");
      out.set(c, { kind, label: `${letter(c)}: ${block ? `${block} · ` : ""}${fi >= 0 ? tiers[fi] : tiers.join(" / ") || "(trống)"}`.slice(0, 70) });
    }
    return out;
  })();
  // danh sách chọn cột: chỉ các cột ĐÚNG LOẠI (đơn giá → các cột đơn giá, thành tiền → các cột thành tiền...), nhãn = tên khối + tên cột; bật "Hiện tất cả cột" để chọn tự do
  const colOptions = (kinds: string[] | null, cur?: number) => {
    const out: { c: number; label: string }[] = [];
    for (const [c, info] of colInfo) if (!kinds || showAllCols || cur === c || kinds.includes(info.kind)) out.push({ c, label: info.label });
    if (!out.length && kinds) for (const [c, info] of colInfo) out.push({ c, label: info.label });
    return out;
  };
  const kindsForLabel = (label: string): string[] | null => {
    const k = gk(label);
    if (k.startsWith("khoiluong")) return ["qty"];
    if (k.startsWith("dongia")) return ["price"];
    if (k.startsWith("thanhtien")) return ["amount"];
    if (k.startsWith("stt")) return ["stt"];
    if (k.startsWith("noidung")) return ["content", "work"];
    if (k.startsWith("hangmuc")) return ["work", "content"];
    if (k.startsWith("dvt")) return ["unit"];
    if (k.startsWith("masanpham") || k.startsWith("mahieu")) return ["code"];
    if (k.startsWith("nhanhieu")) return ["origin"];
    if (k.startsWith("ghichu")) return ["note"];
    if (k.startsWith("mota")) return ["material", "content"];
    if (/^(dai|rong|cao)/.test(k)) return ["dims"];
    return null;
  };
  const Pick = ({ value, onChange, label, bare }: { value?: number; onChange: (v?: number) => void; label: string; bare?: boolean }) => (
    <label className="text-xs">
      {!bare && <span className="block text-slate-500">{label}</span>}
      <select title={bare ? label : undefined} className={`${inp} ${bare ? "w-full min-w-[120px]" : "w-44"} text-xs ${value == null ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"}`} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}>
        <option value="">— không có —</option>
        {colOptions(kindsForLabel(label), value).map((o) => (
          <option key={o.c} value={o.c}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const TrioPick = ({ t, onChange, comp }: { t: Trio; onChange: (t: Trio) => void; comp?: boolean }) => (
    <div className="flex flex-wrap items-end gap-2">
      <Pick label="Khối lượng" value={t.qty} onChange={(v) => onChange({ ...t, qty: v })} />
      {comp && (
        <>
          <Pick label="Đơn giá vật tư" value={t.vt} onChange={(v) => onChange({ ...t, vt: v })} />
          <Pick label="Đơn giá nhân công" value={t.nc} onChange={(v) => onChange({ ...t, nc: v })} />
          {(!choice.isMep || choice.mepTemp) && <Pick label={choice.mepTemp ? "Thuê vật tư (khấu hao %)" : "Đơn giá thiết bị"} value={t.tb} onChange={(v) => onChange({ ...t, tb: v })} />}
        </>
      )}
      <Pick label="Đơn giá" value={t.price} onChange={(v) => onChange({ ...t, price: v })} />
      <Pick label="Thành tiền" value={t.amount} onChange={(v) => onChange({ ...t, amount: v })} />
    </div>
  );

  // tô màu cột đã chọn trong bảng xem trước
  const roleOf = (() => {
    const map = new Map<number, { cls: string; tag: string }>();
    if (m) {
      const put = (c: number | undefined, cls: string, tag: string) => c != null && map.set(c, { cls, tag });
      put(m.stt, "bg-slate-200", "STT");
      put(m.workName, "bg-slate-200", "Hạng mục");
      put(m.content, "bg-sky-200", "NỘI DUNG");
      put(m.code, "bg-slate-200", choice.isMep ? "Mã hiệu" : "Mã");
      if (choice.isMep) put(m.origin, "bg-slate-200", "Nhãn hiệu");
      put(m.unit, "bg-slate-200", "ĐVT");
      put(m.note, "bg-slate-200", "Ghi chú");
      if (choice.isNt) {
        put(m.material, "bg-slate-200", "Vật liệu");
        ["Dài", "Rộng", "Cao"].forEach((t, i) => put(m.dims[i] || undefined, "bg-slate-200", t));
      }
      for (const [t, cls, tag] of [[m.cdt, "bg-amber-100", "CĐT"], [m.base, "bg-violet-100", "Cơ sở"], [m.prop, "bg-rose-100", "Duyệt"]] as [Trio, string, string][]) {
        put(t.qty, cls, `${tag} KL`);
        put(t.price, cls, `${tag} ĐG`);
        put(t.amount, cls, `${tag} TT`);
      }
      put(m.base.vt, "bg-violet-100", "Cơ sở VT");
      put(m.base.nc, "bg-violet-100", "Cơ sở NC");
      put(m.base.tb, "bg-violet-100", "Cơ sở TB");
      put(m.prop.vt, "bg-rose-100", "Duyệt VT");
      put(m.prop.nc, "bg-rose-100", "Duyệt NC");
      put(m.prop.tb, "bg-rose-100", "Duyệt TB");
      put(m.hd?.qty, "bg-orange-100", "HĐ KL");
      put(m.hd?.price, "bg-orange-100", "HĐ ĐG");
      put(m.hd?.amount, "bg-orange-100", "HĐ TT");
      put(m.plAmount, "bg-orange-100", "PL TT");
      put(m.cdtHd?.qty, "bg-amber-100", "CĐT HĐ KL");
      put(m.cdtHd?.price, "bg-amber-100", "CĐT HĐ ĐG");
      put(m.cdtHd?.amount, "bg-amber-100", "CĐT HĐ TT");
      put(m.cdtPl, "bg-amber-100", "CĐT PL TT");
      put(m.baseHd?.qty, "bg-violet-100", "Cơ sở HĐ KL");
      put(m.baseHd?.price, "bg-violet-100", "Cơ sở HĐ ĐG");
      put(m.baseHd?.amount, "bg-violet-100", "Cơ sở HĐ TT");
      put(m.basePl, "bg-violet-100", "Cơ sở PL TT");
      m.bids.forEach((b, i) => {
        put(b.qty, "bg-emerald-100", `TP${i + 1} KL`);
        put(b.price, "bg-emerald-100", `TP${i + 1} ĐG`);
        put(b.amount, "bg-emerald-100", `TP${i + 1} TT`);
        put(b.vt, "bg-emerald-100", `TP${i + 1} VT`);
        put(b.nc, "bg-emerald-100", `TP${i + 1} NC`);
        put(b.tb, "bg-emerald-100", `TP${i + 1} TB`);
      });
    }
    return map;
  })();

  // PLHĐ điều chỉnh: khối CĐT / cơ sở cũng có 7 trường — KL (hợp đồng | điều chỉnh), đơn giá (hợp đồng | điều chỉnh), thành tiền (hợp đồng | điều chỉnh | phụ lục)
  const sevenPicks = (k: "cdt" | "base") => {
    const hd = (k === "cdt" ? m!.cdtHd : m!.baseHd) ?? {};
    const pl = k === "cdt" ? m!.cdtPl : m!.basePl;
    const setHd = (p: Trio) => setM(active, (x) => (k === "cdt" ? { ...x, cdtHd: { ...(x.cdtHd ?? {}), ...p } } : { ...x, baseHd: { ...(x.baseHd ?? {}), ...p } }));
    const setAdj = (p: Trio) => setM(active, (x) => ({ ...x, [k]: { ...x[k], ...p } }));
    const setPl = (v?: number) => setM(active, (x) => (k === "cdt" ? { ...x, cdtPl: v } : { ...x, basePl: v }));
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-end gap-2">
          <Pick label="Khối lượng — Hợp đồng" value={hd.qty} onChange={(v) => setHd({ qty: v })} />
          <Pick label="Khối lượng — Điều chỉnh" value={m![k].qty} onChange={(v) => setAdj({ qty: v })} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Pick label="Đơn giá — Hợp đồng" value={hd.price} onChange={(v) => setHd({ price: v })} />
          <Pick label="Đơn giá — Điều chỉnh" value={m![k].price} onChange={(v) => setAdj({ price: v })} />
        </div>
        {ct && k === "base" && (
          <div className="flex flex-wrap items-end gap-2">
            <Pick label="Đơn giá vật tư (điều chỉnh)" value={m!.base.vt} onChange={(v) => setAdj({ vt: v })} />
            <Pick label="Đơn giá nhân công (điều chỉnh)" value={m!.base.nc} onChange={(v) => setAdj({ nc: v })} />
            {(!choice.isMep || choice.mepTemp) && <Pick label={choice.mepTemp ? "Thuê vật tư (khấu hao %)" : "Đơn giá thiết bị (điều chỉnh)"} value={m!.base.tb} onChange={(v) => setAdj({ tb: v })} />}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Pick label="Thành tiền — Hợp đồng" value={hd.amount} onChange={(v) => setHd({ amount: v })} />
          <Pick label="Thành tiền — Điều chỉnh" value={m![k].amount} onChange={(v) => setAdj({ amount: v })} />
          <Pick label="Thành tiền — Phụ lục" value={pl} onChange={setPl} />
        </div>
      </div>
    );
  };
  const addBid = () => setM(active, (x) => ({ ...x, bids: [...x.bids, { name: `Thầu phụ ${x.bids.length + 1}` }], award: x.award ? [...x.award, 0] : undefined }));
  const removeBid = (i: number) => setM(active, (x) => ({ ...x, bids: x.bids.filter((_, j) => j !== i), award: x.award?.filter((_, j) => j !== i) }));
  const setAward = (i: number, v: number) => setM(active, (x) => ({ ...x, award: x.bids.map((_, j) => (j === i ? v : awardOf(x, j))) }));
  // chọn / bỏ chọn 1 thầu phụ được giao: chia đều 100% cho các thầu phụ đang được chọn (người dùng sửa lại từng ô %)
  const toggleAward = (i: number, on: boolean) =>
    setM(active, (x) => {
      const sel = x.bids.map((_, j) => (j === i ? on : awardOf(x, j) > 0));
      const n = sel.filter(Boolean).length;
      if (!n) return x;
      const each = Math.floor((10000 / n)) / 100;
      let left = 100;
      let seen = 0;
      return { ...x, award: sel.map((s) => (s ? (++seen === n ? +left.toFixed(2) : ((left -= each), each)) : 0)) };
    });
  // BẢNG CHỌN CỘT GỘP (như tiêu đề trong file): mỗi hàng 1 khối giá (CĐT / cơ sở / từng thầu phụ), cột = khối lượng | [VT NC TB] | đơn giá | thành tiền
  const priceTable =
    m && !adj ? (
      <div className="space-y-2">
        <div className="overflow-x-auto rounded-lg border border-slate-300">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-left text-slate-600">
                <th className="px-2 py-1 font-semibold">Khối giá</th>
                <th className="px-1 py-1 font-semibold">Khối lượng</th>
                {ct && (
                  <>
                    <th className="px-1 py-1 font-semibold">Đơn giá vật tư</th>
                    <th className="px-1 py-1 font-semibold">Đơn giá nhân công</th>
                    {(!choice.isMep || choice.mepTemp) && <th className="px-1 py-1 font-semibold">{choice.mepTemp ? "Thuê vật tư (khấu hao %)" : "Đơn giá thiết bị"}</th>}
                  </>
                )}
                <th className="px-1 py-1 font-semibold">Đơn giá</th>
                <th className="px-1 py-1 font-semibold">Thành tiền</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["cdt", "CHỦ ĐẦU TƯ", "bg-amber-50 text-amber-800"],
                  ["base", "CƠ SỞ (theo DT-CP)", "bg-violet-50 text-violet-800"],
                  ...(m.bids.length ? [] : [["prop", "ĐỀ XUẤT / DUYỆT", "bg-rose-50 text-rose-800"]]),
                ] as [("cdt" | "base" | "prop"), string, string][]
              ).map(([k, label, cls]) => {
                const t = m[k];
                const set = (p: Trio) => setM(active, (x) => ({ ...x, [k]: { ...x[k], ...p } }));
                const comp = ct && (k !== "cdt" || !!choice.isMep); // MEP: CĐT cũng có đơn giá vật tư + nhân công
                return (
                  <tr key={k} className={`border-t border-slate-200 ${cls.split(" ")[0]}`}>
                    <td className={`px-2 py-1 font-semibold ${cls.split(" ")[1]}`}>{label}</td>
                    <td className="p-1"><Pick bare label="Khối lượng" value={t.qty} onChange={(v) => set({ qty: v })} /></td>
                    {ct &&
                      (comp ? (
                        <>
                          <td className="p-1"><Pick bare label="Đơn giá vật tư" value={t.vt} onChange={(v) => set({ vt: v })} /></td>
                          <td className="p-1"><Pick bare label="Đơn giá nhân công" value={t.nc} onChange={(v) => set({ nc: v })} /></td>
                          {(!choice.isMep || choice.mepTemp) && <td className="p-1"><Pick bare label={choice.mepTemp ? "Thuê vật tư (khấu hao %)" : "Đơn giá thiết bị"} value={t.tb} onChange={(v) => set({ tb: v })} /></td>}
                        </>
                      ) : (
                        <td colSpan={3} className="text-center text-slate-300">—</td>
                      ))}
                    <td className="p-1"><Pick bare label="Đơn giá" value={t.price} onChange={(v) => set({ price: v })} /></td>
                    <td className="p-1"><Pick bare label="Thành tiền" value={t.amount} onChange={(v) => set({ amount: v })} /></td>
                    <td />
                  </tr>
                );
              })}
              {m.bids.map((b, i) => (
                <tr key={`b${i}`} className="border-t border-slate-200 bg-emerald-50/60">
                  <td className="px-1 py-1">
                    <input className={`${inp} w-48 text-xs`} title={`Tên thầu phụ ${i + 1}`} value={b.name} onChange={(e) => setM(active, (x) => ({ ...x, bids: x.bids.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} />
                  </td>
                  <td className="p-1"><Pick bare label="Khối lượng" value={b.qty} onChange={(v) => setM(active, (x) => ({ ...x, bids: x.bids.map((y, j) => (j === i ? { ...y, qty: v } : y)) }))} /></td>
                  {ct && (
                    <>
                      <td className="p-1"><Pick bare label="Đơn giá vật tư" value={b.vt} onChange={(v) => setM(active, (x) => ({ ...x, bids: x.bids.map((y, j) => (j === i ? { ...y, vt: v } : y)) }))} /></td>
                      <td className="p-1"><Pick bare label="Đơn giá nhân công" value={b.nc} onChange={(v) => setM(active, (x) => ({ ...x, bids: x.bids.map((y, j) => (j === i ? { ...y, nc: v } : y)) }))} /></td>
                      {(!choice.isMep || choice.mepTemp) && <td className="p-1"><Pick bare label={choice.mepTemp ? "Thuê vật tư (khấu hao %)" : "Đơn giá thiết bị"} value={b.tb} onChange={(v) => setM(active, (x) => ({ ...x, bids: x.bids.map((y, j) => (j === i ? { ...y, tb: v } : y)) }))} /></td>}
                    </>
                  )}
                  <td className="p-1"><Pick bare label="Đơn giá" value={b.price} onChange={(v) => setM(active, (x) => ({ ...x, bids: x.bids.map((y, j) => (j === i ? { ...y, price: v } : y)) }))} /></td>
                  <td className="p-1"><Pick bare label="Thành tiền" value={b.amount} onChange={(v) => setM(active, (x) => ({ ...x, bids: x.bids.map((y, j) => (j === i ? { ...y, amount: v } : y)) }))} /></td>
                  <td className="px-1 text-center">
                    <button type="button" title="Bỏ thầu phụ này" onClick={() => removeBid(i)} className="text-red-600 hover:text-red-800">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-200 bg-rose-50/50 p-2">
          <button type="button" onClick={addBid} className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50">
            ＋ Thêm thầu phụ
          </button>
          {m.bids.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <b className="text-rose-800">Lựa chọn phê duyệt:</b>
              {m.bids.map((b, i) => {
                const p = awardOf(m, i);
                return (
                  <span key={i} className={`flex items-center gap-1 rounded border px-1.5 py-0.5 ${p > 0 ? "border-rose-300 bg-white" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                    <input type="checkbox" checked={p > 0} onChange={(e) => toggleAward(i, e.target.checked)} title="Giao thầu phụ này (chọn thêm thầu phụ thì chia đều %, sửa lại ô % bên cạnh)" />
                    {b.name || `Thầu phụ ${i + 1}`}
                    <NumInput decimals allowEmpty value={p || null} suffix="%" onCommit={(v) => setAward(i, Math.max(0, Math.min(100, v ?? 0)))} className="w-16 rounded border border-slate-300 px-1 text-right" />
                  </span>
                );
              })}
              <span className={Math.abs(awardTotal(m) - 100) < 1e-6 ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>
                Tổng {+awardTotal(m).toFixed(4)}%{Math.abs(awardTotal(m) - 100) < 1e-6 ? " ✓" : " — phải bằng 100%"}
              </span>
            </div>
          )}
          {m.bids.length > 0 && <p className="w-full text-[11px] text-slate-500">Giao 1 thầu phụ: để 100%. Giao nhiều thầu phụ: nhập % khối lượng chia cho từng thầu phụ — đơn giá đề xuất của mỗi dòng = bình quân theo % (sửa được trong hồ sơ).</p>}
        </div>
      </div>
    ) : null;
  const trioOf = (k: "cdt" | "base" | "prop") => (
    <TrioPick comp={(k === "prop" || k === "base" || !!choice.isMep) && ct} t={m![k]} onChange={(t) => setM(active, (x) => ({ ...x, [k]: t }))} />
  );

  return (
    <section className="rounded-lg border-2 border-dashed border-sky-300 bg-sky-50/50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-600">{hint}</p>
        </div>
        <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && (setOpen(true), onFile(e.target.files[0]), (e.target.value = ""))} />
        <button type="button" disabled={pending} onClick={() => setChoosing(true)} className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
          📎 Chọn file Excel
        </button>
      </div>

      {/* BẢNG CHỌN trước khi tải file: QSĐT chọn loại đề xuất trước, rồi mới chọn file Excel */}
      {choosing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setChoosing(false)}>
          <div className="w-full max-w-xl rounded-lg bg-white p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Trình giá thầu phụ — chọn loại đề xuất</h2>

            <div className="mb-3">
              <div className="mb-1 font-medium">1. Trình giá</div>
              <label className="mr-4">
                <input type="radio" name="sptype" checked={choice.proposalType === "HDTP"} onChange={() => setChoice({ ...choice, proposalType: "HDTP", plKind: "" })} /> Hợp đồng thầu phụ mới (HĐTP)
              </label>
              <label>
                <input type="radio" name="sptype" checked={choice.proposalType === "PL"} onChange={() => setChoice({ ...choice, proposalType: "PL" })} /> Phụ lục hợp đồng (PLHĐ)
              </label>
            </div>

            {choice.proposalType === "PL" && (
              <div className="mb-3 space-y-1 rounded border border-slate-200 p-2">
                <div className="font-medium">2. Loại phụ lục</div>
                {PL_KINDS.map((k) => (
                  <label key={k.value} className="block">
                    <input type="radio" name="splk" checked={choice.plKind === k.value} onChange={() => setChoice({ ...choice, plKind: k.value })} /> {k.label}
                  </label>
                ))}
                <p className="text-xs text-slate-500">Hợp đồng thầu phụ gốc của phụ lục chọn sau, ở đầu hồ sơ.</p>
              </div>
            )}

            <div className="mb-3 rounded border border-slate-200 p-2">
              <div className="mb-1 font-medium">{choice.proposalType === "PL" ? "3" : "2"}. Đơn giá</div>
              <label className="mr-4">
                <input type="radio" name="spm" checked={choice.priceMode !== "CHITIET"} onChange={() => setChoice({ ...choice, priceMode: "TONG" })} /> Giá tổng (1 đơn giá)
              </label>
              <label>
                <input type="radio" name="spm" checked={choice.priceMode === "CHITIET"} onChange={() => setChoice({ ...choice, priceMode: "CHITIET" })} /> Giá chi tiết (vật tư, nhân công, thiết bị)
              </label>
            </div>
            <div className="mb-3 space-y-2 rounded border border-slate-200 p-2">
              <div className="font-medium">{choice.proposalType === "PL" ? "4" : "3"}. Hình thức giao thầu</div>
              <select className="w-full rounded border border-slate-300 px-2 py-1" value={choice.awardForm} onChange={(e) => setChoice({ ...choice, awardForm: e.target.value })}>
                <option value="">— Chọn hình thức —</option>
                {AWARD_FORMS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              {awardNeed(choice.awardForm).includes("vt") && (
                <label className="block">
                  Tổng giá trị vật tư (đ) <NumInput allowEmpty showZero value={choice.vtValue} onCommit={(v) => setChoice({ ...choice, vtValue: v })} className="w-40 rounded border border-slate-300 px-1 text-right" />
                </label>
              )}
              {awardNeed(choice.awardForm).includes("tb") && (
                <label className="block">
                  Tổng giá trị thiết bị (đ) <NumInput allowEmpty showZero value={choice.tbValue} onCommit={(v) => setChoice({ ...choice, tbValue: v })} className="w-40 rounded border border-slate-300 px-1 text-right" />
                </label>
              )}
              {(awardNeed(choice.awardForm).length > 0) && <p className="text-xs text-slate-500">Có thể nhập giá trị này sau trong hồ sơ, nhưng bắt buộc có trước khi chuyển QSTT.</p>}
            </div>
            <div className="mb-3 rounded border border-slate-200 p-2">
              <div className="mb-1 font-medium">{choice.proposalType === "PL" ? "5" : "4"}. Loại thầu phụ</div>
              <label className="mr-4">
                <input type="radio" name="spmep" checked={!choice.isMep && !choice.isNt} onChange={() => setChoice({ ...choice, isMep: false, mepTemp: false, isNt: false })} /> Xây dựng
              </label>
              <label className="mr-4">
                <input type="radio" name="spmep" checked={!!choice.isMep && !choice.isNt} onChange={() => setChoice({ ...choice, isMep: true, isNt: false })} /> MEP (cơ điện)
              </label>
              <label>
                <input type="radio" name="spmep" checked={!!choice.isNt} onChange={() => setChoice({ ...choice, isMep: false, mepTemp: false, isNt: true })} /> Nội thất
              </label>
              {choice.isMep && !choice.isNt && <p className="mt-1 text-xs text-slate-500">MEP: khi chọn cột sẽ có thêm ô chọn cột <b>Mã hiệu sản phẩm</b> và <b>Nhãn hiệu - xuất xứ</b>.</p>}
              {choice.isNt && (
                <p className="mt-1 text-xs text-slate-500">
                  Nội thất: chọn cột <b>STT → Mã sản phẩm → Hạng mục công việc → Mô tả vật liệu → Dài / Rộng / Cao</b>; <b>hình ảnh</b> dán trong file tự lấy theo dòng. Dòng sản phẩm (VD 1) có các dòng phần việc bên dưới (1.1, 1.2…) thì
                  phần việc không có giá thầu phụ = <b>phần việc khác, không trình lần này</b> (chỉ tham khảo) — đổi lại được ở menu ▾ của dòng.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setChoosing(false)} className="rounded border border-slate-300 px-3 py-1.5">
                Huỷ
              </button>
              <button
                type="button"
                className="rounded bg-sky-700 px-3 py-1.5 font-medium text-white"
                onClick={() => {
                  const miss: string[] = [];
                  if (choice.proposalType !== "HDTP" && choice.proposalType !== "PL") miss.push("Trình giá HĐTP mới hay phụ lục");
                  if (choice.proposalType === "PL" && choice.plKind !== "CONG_GOP" && choice.plKind !== "DIEU_CHINH") miss.push("Loại phụ lục (cộng gộp / điều chỉnh)");
                  if (!choice.awardForm) miss.push("Hình thức giao thầu");
                  if (miss.length) return window.alert(`Cần chọn:\n- ${miss.join("\n- ")}`);
                  setChoosing(false);
                  inputRef.current?.click(); // mở hộp chọn file ngay sau khi chọn xong
                }}
              >
                Tiếp tục → chọn file Excel
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6" onClick={() => !pending && setOpen(false)}>
          <div className="w-full max-w-7xl rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Chọn cột để nhập file thầu phụ</h2>
              <span className="text-sm text-slate-500">{fileName}</span>
              <span className="flex-1" />
              <button type="button" onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-800">
                ✕
              </button>
            </div>
            {!names.length ? (
              <p className="mt-4 text-sm text-slate-500">{pending ? "Đang đọc file..." : "Chưa có dữ liệu"}</p>
            ) : (
              <div className="mt-3 space-y-4">
                <section>
                  <h3 className="text-sm font-semibold text-slate-800">1. Chọn sheet cần nhập (mỗi sheet thành 1 hồ sơ)</h3>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {names.map((n) => (
                      <label key={n} className={`flex items-center gap-1.5 rounded border px-2 py-1 text-sm ${picked.includes(n) ? "border-sky-400 bg-sky-50" : "border-slate-200"}`}>
                        <input type="checkbox" checked={picked.includes(n)} onChange={(e) => togglePick(n, e.target.checked)} />
                        {n}
                      </label>
                    ))}
                  </div>
                </section>

                {picked.length > 0 && (
                  <section>
                    <div className="flex flex-wrap gap-1 border-b border-slate-200">
                      {picked.map((n) => (
                        <button key={n} type="button" onClick={() => setActive(n)} className={`-mb-px rounded-t-md border px-3 py-1.5 text-sm ${active === n ? "border-slate-200 border-b-white bg-white font-medium" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                          {n} {sheets[n]?.m?.content ? <span className="text-emerald-600">✓</span> : <span className="text-amber-600">⚠</span>}
                        </button>
                      ))}
                    </div>

                    {cur?.loading && <p className="mt-3 text-sm text-slate-500">Đang đọc sheet...</p>}
                    {pv && m && (
                      <div className="mt-3 space-y-3">
                        <h3 className="text-sm font-semibold text-slate-800">2. Chỉ định cột — phần mềm đã gợi ý sẵn, anh/chị kiểm tra và sửa</h3>
                        <div className="flex flex-wrap items-end gap-3 text-xs">
                          <label>
                            <span className="block text-slate-500">Dòng tiêu đề (số dòng trong file)</span>
                            <input type="number" min={1} className={`${inp} w-24 text-xs`} value={m.hr || ""} onChange={(e) => setM(active, (x) => ({ ...x, hr: Number(e.target.value) || 0, first: x.first && x.first > (Number(e.target.value) || 0) ? x.first : (Number(e.target.value) || 0) + 2 }))} />
                          </label>
                          <label>
                            <span className="block text-slate-500">Dòng dữ liệu đầu tiên</span>
                            <input type="number" min={1} className={`${inp} w-24 text-xs`} value={m.first || ""} onChange={(e) => setM(active, (x) => ({ ...x, first: Number(e.target.value) || 0 }))} />
                          </label>
                          <button
                            type="button"
                            title="Tìm dòng đầu tiên có chữ STT (hoặc TT) cùng chữ NỘI DUNG / CÔNG VIỆC → đó là dòng tiêu đề; dòng dữ liệu đầu tiên là dòng có số thứ tự đầu tiên bên dưới"
                            onClick={() => {
                              const d = detectHeader(pv);
                              if (!d) return window.alert("Không thấy dòng nào có chữ STT (hoặc TT) kèm chữ NỘI DUNG / CÔNG VIỆC / HẠNG MỤC. Anh/chị nhập số dòng tiêu đề bằng tay.");
                              setM(active, (x) => ({ ...x, hr: d.hr, first: d.first, stt: x.stt ?? d.stt }));
                            }}
                            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                          >
                            🔍 Dò dòng tiêu đề theo STT / TT
                          </button>
                          <label className="flex items-center gap-1 text-xs text-slate-600" title="Mặc định ô chọn cột chỉ liệt kê đúng loại cột (đơn giá → chỉ các cột đơn giá...). Bật để chọn bất kỳ cột nào.">
                            <input type="checkbox" checked={showAllCols} onChange={(e) => setShowAllCols(e.target.checked)} /> Hiện tất cả cột khi chọn
                          </label>
                          <Pick label="STT" value={m.stt} onChange={(v) => setM(active, (x) => ({ ...x, stt: v }))} />
                          {choice.isNt ? (
                            <>
                              {/* NỘI THẤT: STT → Mã sản phẩm → Hạng mục công việc → Mô tả vật liệu → (Hình ảnh: tự lấy) → Dài / Rộng / Cao → ĐVT */}
                              <Pick label="Mã sản phẩm" value={m.code} onChange={(v) => setM(active, (x) => ({ ...x, code: v }))} />
                              <Pick label="Hạng mục công việc *" value={m.content} onChange={(v) => setM(active, (x) => ({ ...x, content: v }))} />
                              <Pick label="Mô tả vật liệu" value={m.material} onChange={(v) => setM(active, (x) => ({ ...x, material: v }))} />
                              {["Dài (mm)", "Rộng (mm)", "Cao (mm)"].map((t, di) => (
                                <Pick key={t} label={t} value={m.dims[di] || undefined} onChange={(v) => setM(active, (x) => ({ ...x, dims: [0, 1, 2].map((j) => (j === di ? (v ?? 0) : x.dims[j] || 0)) }))} />
                              ))}
                              <Pick label="ĐVT" value={m.unit} onChange={(v) => setM(active, (x) => ({ ...x, unit: v }))} />
                              <span className="self-center text-[11px] text-slate-500">Hình ảnh: tự lấy ảnh dán trong file theo dòng</span>
                            </>
                          ) : (
                            <>
                              <Pick label="NỘI DUNG CÔNG VIỆC *" value={m.content} onChange={(v) => setM(active, (x) => ({ ...x, content: v }))} />
                              <Pick label="Hạng mục / tên nhóm" value={m.workName} onChange={(v) => setM(active, (x) => ({ ...x, workName: v }))} />
                              <Pick label="ĐVT" value={m.unit} onChange={(v) => setM(active, (x) => ({ ...x, unit: v }))} />
                            </>
                          )}
                          {choice.isNt ? null : choice.isMep ? (
                            <>
                              <Pick label="Mã hiệu sản phẩm" value={m.code} onChange={(v) => setM(active, (x) => ({ ...x, code: v }))} />
                              <Pick label="Nhãn hiệu - xuất xứ" value={m.origin} onChange={(v) => setM(active, (x) => ({ ...x, origin: v }))} />
                            </>
                          ) : (
                            <Pick label="Mã sản phẩm" value={m.code} onChange={(v) => setM(active, (x) => ({ ...x, code: v }))} />
                          )}
                          <Pick label="Ghi chú" value={m.note} onChange={(v) => setM(active, (x) => ({ ...x, note: v }))} />
                          {!adj && (
                            <button
                              type="button"
                              title="Khối lượng chủ đầu tư, giá cơ sở và thầu phụ bằng nhau: mọi khối dùng chung cột khối lượng của CĐT (chưa chọn thì cột khối lượng đầu tiên đã chọn); bảng đề xuất chỉ hiện 1 cột khối lượng cho ngắn"
                              onClick={() => setChoice({ ...choice, oneQty: !choice.oneQty })}
                              className={`rounded border px-3 py-1.5 text-xs font-bold ${choice.oneQty ? "border-indigo-500 bg-indigo-600 text-white" : "border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50"}`}
                            >
                              Áp dụng chung 1 khối lượng{choice.oneQty ? " ✓" : ""}
                            </button>
                          )}
                          {choice.isMep && !choice.isNt && (
                            <button
                              type="button"
                              title="Gói MEP tạm: có thêm cột THUÊ VẬT TƯ (khấu hao %) — đơn giá tổng = đơn giá vật tư × khấu hao + đơn giá nhân công"
                              onClick={() => setChoice({ ...choice, mepTemp: !choice.mepTemp })}
                              className={`rounded border px-3 py-1.5 text-xs font-bold ${choice.mepTemp ? "border-rose-500 bg-rose-600 text-white" : "border-rose-300 bg-white text-rose-700 hover:bg-rose-50"}`}
                            >
                              MEP TẠM{choice.mepTemp ? " ✓" : ""}
                            </button>
                          )}
                        </div>

                        {priceTable}
                        <div className={`grid gap-3 lg:grid-cols-2 ${adj ? "" : "hidden"}`}>
                          <div className="rounded border border-amber-200 bg-amber-50/40 p-2">
                            <p className="text-xs font-semibold text-amber-800">Giá CHỦ ĐẦU TƯ</p>
                            {adj ? sevenPicks("cdt") : trioOf("cdt")}
                          </div>
                          <div className="rounded border border-violet-200 bg-violet-50/40 p-2">
                            <p className="text-xs font-semibold text-violet-800">Giá CƠ SỞ</p>
                            {adj ? sevenPicks("base") : trioOf("base")}
                          </div>
                          <div className="rounded border border-rose-200 bg-rose-50/40 p-2">
                            <p className="text-xs font-semibold text-rose-800">{adj ? "Giá PLHĐ ĐIỀU CHỈNH (theo hợp đồng gốc và điều chỉnh)" : "Giá ĐỀ XUẤT / DUYỆT"}</p>
                            {adj ? (
                              // PLHĐ điều chỉnh: khối lượng, đơn giá mỗi mục 2 cột (hợp đồng | điều chỉnh); thành tiền 3 cột (hợp đồng | điều chỉnh | phụ lục)
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-end gap-2">
                                  <Pick label="Khối lượng — Hợp đồng" value={m.hd?.qty} onChange={(v) => setM(active, (x) => ({ ...x, hd: { ...(x.hd ?? {}), qty: v } }))} />
                                  <Pick label="Khối lượng — Điều chỉnh" value={m.prop.qty} onChange={(v) => setM(active, (x) => ({ ...x, prop: { ...x.prop, qty: v } }))} />
                                </div>
                                <div className="flex flex-wrap items-end gap-2">
                                  <Pick label="Đơn giá — Hợp đồng" value={m.hd?.price} onChange={(v) => setM(active, (x) => ({ ...x, hd: { ...(x.hd ?? {}), price: v } }))} />
                                  <Pick label="Đơn giá — Điều chỉnh" value={m.prop.price} onChange={(v) => setM(active, (x) => ({ ...x, prop: { ...x.prop, price: v } }))} />
                                </div>
                                {ct && (
                                  <div className="flex flex-wrap items-end gap-2">
                                    <Pick label="Đơn giá vật tư (điều chỉnh)" value={m.prop.vt} onChange={(v) => setM(active, (x) => ({ ...x, prop: { ...x.prop, vt: v } }))} />
                                    <Pick label="Đơn giá nhân công (điều chỉnh)" value={m.prop.nc} onChange={(v) => setM(active, (x) => ({ ...x, prop: { ...x.prop, nc: v } }))} />
                                    <Pick label="Đơn giá thiết bị (điều chỉnh)" value={m.prop.tb} onChange={(v) => setM(active, (x) => ({ ...x, prop: { ...x.prop, tb: v } }))} />
                                  </div>
                                )}
                                <div className="flex flex-wrap items-end gap-2">
                                  <Pick label="Thành tiền — Hợp đồng" value={m.hd?.amount} onChange={(v) => setM(active, (x) => ({ ...x, hd: { ...(x.hd ?? {}), amount: v } }))} />
                                  <Pick label="Thành tiền — Điều chỉnh" value={m.prop.amount} onChange={(v) => setM(active, (x) => ({ ...x, prop: { ...x.prop, amount: v } }))} />
                                  <Pick label="Thành tiền — Phụ lục" value={m.plAmount} onChange={(v) => setM(active, (x) => ({ ...x, plAmount: v }))} />
                                </div>
                                <p className="text-[11px] text-slate-500">Thành tiền phụ lục phần mềm tự tính = điều chỉnh − hợp đồng; chọn cột để đối chiếu với file.</p>
                              </div>
                            ) : (
                              trioOf("prop")
                            )}
                          </div>
                        </div>

                        <div className={`space-y-2 rounded border border-emerald-200 bg-emerald-50/40 p-2 ${adj ? "" : "hidden"}`}>
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold text-emerald-800">THẦU PHỤ báo giá ({m.bids.length})</p>
                            <button type="button" onClick={addBid} className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-50">
                              ＋ Thêm thầu phụ
                            </button>
                          </div>
                          {m.bids.map((b, i) => (
                            <div key={i} className="flex flex-wrap items-end gap-2 rounded border border-emerald-100 bg-white p-2">
                              <label className="text-xs">
                                <span className="block text-slate-500">Tên thầu phụ {i + 1}</span>
                                <input className={`${inp} w-52 text-xs`} value={b.name} onChange={(e) => setM(active, (x) => ({ ...x, bids: x.bids.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} />
                              </label>
                              <TrioPick comp={ct} t={b} onChange={(t) => setM(active, (x) => ({ ...x, bids: x.bids.map((y, j) => (j === i ? { ...y, ...t } : y)) }))} />
                              <button type="button" onClick={() => removeBid(i)} className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                                Bỏ
                              </button>
                            </div>
                          ))}
                        </div>

                        <div>
                          <h3 className="text-sm font-semibold text-slate-800">Bảng xem trước — từ dòng tiêu đề STT trở xuống (cột đã chọn được tô màu ở đầu cột)</h3>
                          {(() => {
                            if (!m.hr) return <p className="mt-1 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">Chưa có dòng tiêu đề — bấm “🔍 Dò dòng tiêu đề theo STT / TT” hoặc nhập số dòng tiêu đề ở trên để xem bảng.</p>;
                            const hrI = m.hr - 1;
                            const firstI = Math.max(m.first || m.hr + 1, m.hr + 1) - 1;
                            const headRows = pv.rows.slice(hrI, firstI);
                            const body = pv.rows.slice(firstI).map((r, k) => ({ r, n: firstI + k + 1 })).filter((x) => x.r.some(Boolean));
                            const shown = body.slice(0, 40);
                            // chỉ giữ cột có chữ ở tiêu đề / dữ liệu hoặc đã được chọn vai trò
                            const colIdx: number[] = [];
                            for (let j = 0; j < pv.cols; j++) if (roleOf.has(j + 1) || headRows.some((r) => r[j]) || shown.some((x) => x.r[j])) colIdx.push(j);
                            const headText = (j: number) => {
                              const out: string[] = [];
                              for (const r of headRows) {
                                const t = r[j];
                                if (t && gk(t) !== gk(out[out.length - 1] ?? "")) out.push(t);
                              }
                              return out;
                            };
                            const sttI = m.stt ? m.stt - 1 : -1;
                            // độ rộng theo loại cột: STT / ĐVT / mã hẹp, nội dung rộng, số tiền vừa
                            const colStyle = (j: number): React.CSSProperties => {
                              const k = colInfo.get(j + 1)?.kind;
                              if (j + 1 === m.stt || k === "stt") return { width: 46, minWidth: 46, maxWidth: 56 };
                              if (j + 1 === m.unit || k === "unit" || k === "code") return { width: 60, minWidth: 56, maxWidth: 80 };
                              if (j + 1 === m.content || k === "content" || k === "work") return { width: 300, minWidth: 220, maxWidth: 380 };
                              if (k === "qty") return { width: 84, minWidth: 76, maxWidth: 100 };
                              if (k === "price" || k === "amount") return { width: 112, minWidth: 100, maxWidth: 140 };
                              return { width: 120, minWidth: 80, maxWidth: 200 };
                            };
                            return (
                              <>
                                <div className="mt-1 max-h-[50vh] overflow-auto rounded-lg border border-slate-300 shadow-sm">
                                  <table className="border-collapse text-[12px]">
                                    <thead className="sticky top-0 z-10">
                                      <tr className="bg-slate-100">
                                        <th className="w-8 border-b border-slate-300 px-1 py-1 text-center text-[10px] font-normal text-slate-400">dòng</th>
                                        {colIdx.map((j) => {
                                          const r = roleOf.get(j + 1);
                                          const ht = headText(j);
                                          return (
                                            <th key={j} style={colStyle(j)} className={`border-b border-l border-slate-300 px-1.5 py-1 text-left align-top ${r?.cls ?? ""}`}>
                                              <span className="flex items-center gap-1">
                                                <span className="rounded bg-white/70 px-1 text-[10px] font-normal text-slate-500">{letter(j + 1)}</span>
                                                {r && <span className="rounded bg-slate-700 px-1 text-[9px] font-semibold text-white">{r.tag}</span>}
                                              </span>
                                              {ht.map((t, i) => (
                                                <span key={i} className={`block leading-tight ${i === 0 ? "font-semibold text-slate-800" : "text-[11px] font-normal text-slate-600"}`}>
                                                  {t}
                                                </span>
                                              ))}
                                            </th>
                                          );
                                        })}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {shown.map(({ r, n }) => {
                                        const st = ((sttI >= 0 ? r[sttI] : r[0]) ?? "").trim();
                                        const lvl = ROMAN_RE.test(st) ? "SUB" : /^[A-Z]$/.test(st) ? "GROUP" : "ITEM";
                                        return (
                                          <tr key={n} className={lvl === "SUB" ? "bg-yellow-200 font-bold" : lvl === "GROUP" ? "bg-yellow-100 font-bold" : "odd:bg-white even:bg-slate-50/60"}>
                                            <td className="border-t border-slate-200 px-1 text-center text-[10px] text-slate-400">{n}</td>
                                            {colIdx.map((j) => {
                                              const c = r[j] ?? "";
                                              return (
                                                <td key={j} title={c} style={colStyle(j)} className={`overflow-hidden border-l border-t border-slate-200 px-1.5 py-0.5 align-top ${isNumLike(c) ? "text-right tabular-nums" : "truncate"}`}>
                                                  {fmtCell(c)}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  Hiện {shown.length}/{body.length} dòng đầu, bỏ dòng và cột trống. Nền vàng đậm = đầu mục cấp 1 (I, II), vàng nhạt = đầu mục cấp 2 (A, B). Phần điều khoản, Prelim, VAT dưới bảng vẫn được đọc tự động; đến dòng TỔNG CỘNG thì dừng đọc công việc.
                                </p>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </section>
                )}

                <div className="flex items-center gap-3 border-t border-slate-100 pt-3">
                  <button type="button" disabled={pending || !ready} onClick={doImport} className="rounded-md bg-emerald-700 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50">
                    {pending ? "Đang nhập..." : `Nhập ${picked.length} sheet`}
                  </button>
                  {!ready && <span className="text-xs text-red-600">Mỗi sheet cần chọn dòng tiêu đề, cột NỘI DUNG CÔNG VIỆC và tổng % lựa chọn phê duyệt = 100%</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
