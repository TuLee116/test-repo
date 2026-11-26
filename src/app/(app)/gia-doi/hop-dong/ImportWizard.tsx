"use client";

import { useRef, useState, useTransition } from "react";
import type { NormRow } from "@/lib/dtcp-normalize";
import { useRouter } from "next/navigation";
import { analyzeDtcpFileAction, dtcpLinksAction, importDtcpAction, previewStandardizeAction, sheetColumnsAction, sheetInfoAction } from "@/lib/hop-dong-actions";
import type { Analysis, ColMap, LinkReport, Role, SheetInfo } from "@/lib/hop-dong-excel";
import type { CostKind, Version } from "@/lib/hop-dong-calc";
import SitePicker from "@/app/(app)/du-an/SitePicker";
import { siteByName, type SiteOpt } from "@/lib/project-site-calc";

// Nhập file DT-CP Excel CŨ của hợp đồng: phần mềm tự đoán sheet / cột / thời điểm → người dùng xác nhận hoặc chọn lại → nhập.
// Lựa chọn sheet được NHỚ (theo tên sheet) cho lần nhập sau.
// ĐỦ 7 SHEET CƠ BẢN: DT-CP, BOQ (có thể nhiều sheet), CHI TIẾT, TH Vật Tư, TH Nhân Công, TH Thiết Bị, TH Thầu Phụ.
// Mọi chi phí ở sheet DT-CP phải link từ 6 sheet còn lại — link ra sheet khác = chưa tổng hợp đầy đủ → QSTT sửa file DT-CP rồi nhập lại.
type OneRole = Exclude<Role, "BOQ">;
const ROLE_ROWS: { value: Role; label: string }[] = [
  { value: "DTCP", label: "DT-CP (bảng tổng hợp)" },
  { value: "BOQ", label: "BOQ (chọn 1 hoặc nhiều sheet)" },
  { value: "CT", label: "CHI TIẾT" },
  { value: "VT", label: "TH Vật Tư" },
  { value: "NC", label: "TH Nhân Công" },
  { value: "TB", label: "TH Thiết Bị" },
  { value: "TP", label: "TH Thầu Phụ" },
];
const EMPTY_ROLES: Record<OneRole, string> = { DTCP: "", CT: "", NC: "", TP: "", VT: "", TB: "" };
const REMEMBER = "dtcp-import-roles";
const normName = (s: string) => s.normalize("NFC").trim().toLowerCase();
// so tên sheet không phân biệt hoa thường / dấu (giống phía máy chủ)
const normSheet = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
const colLetter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

const STATUS_CLS: Record<string, string> = { ok: "bg-white", copied: "bg-emerald-50", converted: "bg-sky-50", lot: "bg-amber-50", warn: "bg-red-50", fixed: "bg-white" };
const STATUS_TXT: Record<string, string> = { ok: "✅ Đã chuẩn", copied: "🔄 Đã copy chi tiết", converted: "🔄 Đã mở chi tiết", lot: "▣ Khoán gọn", warn: "⚠ Cảnh báo", fixed: "" };
const KIND_TXT: Record<string, string> = { TP: "Thầu phụ", NC: "Nhân công", VT: "Vật tư", TB: "Thiết bị" };
function NormReport({ norm }: { norm: { report: NormRow[]; added: number } }) {
  const n = (s: string) => norm.report.filter((x) => x.status === s).length;
  const th = "border border-slate-200 px-1.5 py-1 text-left font-medium";
  const td = "border border-slate-200 px-1.5";
  return (
    <section className="mt-3">
      <h3 className="text-sm font-semibold text-slate-800">Kết quả kiểm tra theo sheet DT-CP</h3>
      <p className="mt-1 text-xs text-slate-600">
        ✅ {n("ok")} đã chuẩn · 🔄 {n("copied") + n("converted")} đã đưa chi tiết về TH (thêm {norm.added} dòng) · ▣ {n("lot")} khoán gọn · <b className="text-red-700">⚠ {n("warn")} cảnh báo</b>. Bấm &quot;Nhập DT-CP đã làm chuẩn&quot; để lưu.
      </p>
      <div className="mt-2 max-h-96 overflow-auto rounded border border-slate-200">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-100">
            <tr>
              {["Dòng DT-CP", "STT", "Nội dung", "Mục", "Giá trị DT-CP", "Tổng chi tiết (sau VAT)", "Kết quả"].map((t) => (
                <th key={t} className={th}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {norm.report.map((x, i) => (
              <tr key={i} className={STATUS_CLS[x.status]}>
                <td className={`${td} text-center`}>{x.dtRow}</td>
                <td className={td}>{x.stt}</td>
                <td className={td}>{x.name}</td>
                <td className={`${td} text-center`}>{x.kind ? KIND_TXT[x.kind] : ""}</td>
                <td className={`${td} text-right`}>{x.dtAmount == null ? "" : Math.round(x.dtAmount).toLocaleString("vi-VN")}</td>
                <td className={`${td} text-right`}>{x.got == null ? "" : Math.round(x.got).toLocaleString("vi-VN")}</td>
                <td className={td}>
                  <b>{STATUS_TXT[x.status]}</b> {x.message}
                  {x.source && <span className="block text-slate-400">{x.source}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ParentContract = { id: string; name: string; area: string; contractNo: string; packageName: string };
export default function ImportWizard({ contractId, onClose, sites = [], init, parents = [] }: { contractId?: string; onClose: () => void; sites?: SiteOpt[]; init?: { area: string; name: string; siteId?: string }; parents?: ParentContract[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [a, setA] = useState<Analysis | null>(null);
  const [sheets, setSheets] = useState<Record<string, SheetInfo>>({});
  const [roles, setRoles] = useState<Record<OneRole, string>>(EMPTY_ROLES);
  const [boq, setBoq] = useState<string[]>([]);
  const [links, setLinks] = useState<LinkReport | null>(null); // sheet DT-CP đang link tới những sheet nào
  const [meta, setMeta] = useState({ name: "", packageName: "", contractNo: "", appendixNo: "" });
  const [area, setArea] = useState(init?.area ?? "");
  // DANH MỤC DỰ ÁN: chọn dự án theo mã (tên hợp đồng = tên chuẩn); tên công trình trong file trùng tên / tên gọi khác thì tự chọn
  const [siteId, setSiteId] = useState(init?.siteId ?? "");
  // PHỤ LỤC: chọn hợp đồng GỐC trong danh sách (cùng khu vực đã chọn) → phụ lục gom về đúng hợp đồng đó
  const [asPl, setAsPl] = useState(false);
  const [parentId, setParentId] = useState("");
  const parentList = parents.filter((p) => !!area && p.area === area);
  const pickParent = (id: string) => {
    setParentId(id);
    const p = parents.find((x) => x.id === id);
    if (p) setMeta((m) => ({ ...m, name: p.name, contractNo: p.contractNo || m.contractNo }));
  };
  const [versions, setVersions] = useState<Version[]>([]);
  const [approved, setApproved] = useState(0);
  const [fileName, setFileName] = useState("");
  const [standardize, setStandardize] = useState(true); // "Làm chuẩn 7 sheet": mặc định bật
  const [norm, setNorm] = useState<{ report: NormRow[]; added: number } | null>(null); // báo cáo "Làm chuẩn 7 sheet" (bước kiểm tra trước khi nhập)

  // sheet chỉ có 1 cột "ĐƠN GIÁ" (không ghi thời điểm) mà DT-CP có thời điểm → gán sẵn cho thời điểm kiểm soát (người dùng sửa lại được)
  const verRef = useRef<{ keys: string[]; approved: number }>({ keys: [], approved: 0 });
  const fitInfo = (s: SheetInfo): SheetInfo => {
    const { keys, approved: ap } = verRef.current;
    const p = s.colMap.prices;
    if (!keys.length || p["0"] == null || keys.some((k) => p[k] != null)) return s;
    const { ["0"]: c, ...rest } = p;
    return { ...s, colMap: { ...s.colMap, prices: { ...rest, [String(ap || keys[keys.length - 1])]: c } } };
  };

  const fd = () => {
    const f = new FormData();
    f.set("file", fileRef.current!);
    return f;
  };

  // đọc công thức của sheet DT-CP: trỏ tới sheet nào (kể cả file Excel ngoài)
  const loadLinks = (sheet: string) => {
    setLinks(null);
    if (!sheet || !fileRef.current) return;
    void dtcpLinksAction(fd(), sheet).then((r) => {
      if (r.ok) setLinks(r.report);
    });
  };

  // Sheet chưa đọc nội dung (không đoán được từ tên): đọc riêng sheet đó khi người dùng chọn dùng — phần mềm không đọc các sheet khác
  const ensureInfo = async (name: string) => {
    if (!name || !fileRef.current) return;
    const r = await sheetInfoAction(fd(), name);
    if (r.ok) setSheets((m) => (m[name]?.lazy ? { ...m, [name]: fitInfo({ ...r.info, lazy: false }) } : m));
    else window.alert(r.error);
  };

  const analyze = (file: File) =>
    start(async () => {
      fileRef.current = file;
      setFileName(file.name);
      const r = await analyzeDtcpFileAction(fd());
      if (!r.ok) return window.alert(r.error);
      const an = r.analysis;
      setA(an);
      // đoán + lựa chọn đã nhớ lần trước (theo tên sheet)
      let mem: Record<string, Role> = {};
      try {
        mem = JSON.parse(localStorage.getItem(REMEMBER) || "{}");
      } catch {}
      const next: Record<OneRole, string> = { ...EMPTY_ROLES };
      let boqNext: string[] = [];
      for (const s of an.sheets) {
        if (s.guess === "BOQ") boqNext.push(s.name);
        else if (s.guess && !next[s.guess]) next[s.guess] = s.name;
      }
      for (const s of an.sheets) {
        const m = mem[normName(s.name)];
        if (!m) continue;
        for (const k of Object.keys(next) as OneRole[]) if (next[k] === s.name) next[k] = "";
        boqNext = boqNext.filter((x) => x !== s.name);
        if (m === "BOQ") boqNext.push(s.name);
        else next[m] = s.name;
      }
      setRoles(next);
      setBoq(boqNext);
      // sheet đã nhớ từ lần trước nhưng chưa đọc nội dung → đọc riêng các sheet đó
      for (const k of ["NC", "TP", "VT", "TB"] as const) if (next[k] && an.sheets.find((x) => x.name === next[k])?.lazy) void ensureInfo(next[k]);
      loadLinks(next.DTCP);
      setMeta(init?.name ? { ...an.head, name: init.name, appendixNo: "" } : { ...an.head, appendixNo: "" });
      if (!init?.siteId) {
        const s = siteByName(an.head.name, sites);
        if (s) {
          setSiteId(s.id);
          if (!area && s.area) setArea(s.area);
        }
      }
      // thời điểm: theo sheet DT-CP; không có thì theo các cột "ĐƠN GIÁ TĐn" của sheet Nhân Công
      let vs = an.versions;
      if (!vs.length) {
        const nc = an.sheets.find((s) => s.name === next.NC);
        vs = Object.keys(nc?.colMap.prices ?? {})
          .map(Number)
          .filter((n) => n > 0)
          .sort((x, y) => x - y)
          .map((n) => ({ n, label: `Thời điểm ${n}`, approved: false }));
      }
      const ap = vs.find((v) => v.approved)?.n ?? vs[vs.length - 1]?.n ?? 0;
      setVersions(vs);
      setApproved(ap);
      verRef.current = { keys: vs.map((v) => String(v.n)), approved: ap };
      setSheets(Object.fromEntries(an.sheets.map((s) => [s.name, fitInfo(s)])));
    });

  const setCol = (sheet: string, patch: Partial<ColMap>) => setSheets((m) => ({ ...m, [sheet]: { ...m[sheet], colMap: { ...m[sheet].colMap, ...patch } } }));
  const changeHeader = (sheet: string, hr: number) =>
    start(async () => {
      const r = await sheetColumnsAction(fd(), sheet, hr);
      if (!r.ok) return window.alert(r.error);
      setSheets((m) => ({ ...m, [sheet]: fitInfo({ ...m[sheet], headerRow: hr, columns: r.columns, colMap: r.colMap, preview: r.preview }) }));
    });

  // 6 sheet bắt buộc (DT-CP, BOQ, CHI TIẾT, TH Vật Tư, TH Nhân Công, TH Thầu Phụ); TH Thiết Bị có thể không có → chọn "Không có / bỏ qua"
  const missingSheets = [
    !roles.DTCP && "DT-CP",
    !boq.length && "BOQ",
    !roles.CT && "CHI TIẾT",
    !roles.VT && "TH Vật Tư",
    !roles.NC && "TH Nhân Công",
    !roles.TP && "TH Thầu Phụ",
  ].filter(Boolean) as string[];
  const allowedSheets = new Set([...boq, roles.CT, roles.VT, roles.NC, roles.TB, roles.TP].filter(Boolean).map(normSheet));
  const badLinks = (links?.refs ?? []).filter((r) => r.external || !allowedSheets.has(normSheet(r.sheet)));
  const plOk = !asPl || (!!parentId && !!meta.appendixNo.trim());
  const canImport = !!area && !missingSheets.length && plOk && (asPl || !!siteId); // liên kết DT-CP chỉ ghi nhận, không chặn nhập

  const buildMeta = () => {
    const choices: Partial<Record<CostKind, { sheet: string; headerRow: number; colMap: ColMap }>> = {};
    for (const k of ["NC", "TP", "VT", "TB"] as CostKind[]) {
      const s = roles[k] && sheets[roles[k]];
      if (s) choices[k] = { sheet: s.name, headerRow: s.headerRow, colMap: s.colMap };
    }
    return {
        contractId,
        area,
        ...meta,
        siteId,
        appendixNo: !contractId && asPl ? meta.appendixNo.trim() : "",
        appendixOfId: !contractId && asPl ? parentId : "",
        versions: versions.map((v) => ({ ...v, approved: v.n === approved })),
        approvedVersion: approved,
        choices,
        dtcpSheet: roles.DTCP,
        boqSheets: boq,
        ctSheet: roles.CT,
        standardize,
    };
  };
  const doCheck = () =>
    start(async () => {
      setNorm(null);
      const r = await previewStandardizeAction(fd(), buildMeta());
      if (!r.ok) return window.alert(r.error);
      setNorm({ report: r.report, added: r.added });
    });
  const doImport = () =>
    start(async () => {
      const r = await importDtcpAction(fd(), buildMeta());
      if (!r.ok) return window.alert(r.error);
      try {
        const mem = JSON.parse(localStorage.getItem(REMEMBER) || "{}");
        for (const k of Object.keys(roles) as OneRole[]) if (roles[k]) mem[normName(roles[k])] = k;
        for (const n of boq) mem[normName(n)] = "BOQ";
        localStorage.setItem(REMEMBER, JSON.stringify(mem));
      } catch {}
      window.alert(`Đã nhập DT-CP.\n${r.info}\n\nĐối chiếu nhanh với tổng tiền các sheet trong file Excel.`);
      onClose();
      router.push(`/gia-doi/hop-dong/${r.id}`);
      router.refresh();
    });

  const inp = "rounded border border-slate-300 px-2 py-1 text-sm";
  const sheetNames = a?.sheets.map((s) => s.name) ?? [];

  const colSelect = (sheet: SheetInfo, field: "name" | "unit" | "qty" | "amount" | "stt", label: string) => (
    <label className="text-xs">
      <span className="block text-slate-500">{label}</span>
      <select className={`${inp} w-44 text-xs`} value={sheet.colMap[field] ?? ""} onChange={(e) => setCol(sheet.name, { [field]: e.target.value ? Number(e.target.value) : undefined })}>
        <option value="">— không có —</option>
        {sheet.columns.map((c) => (
          <option key={c.col} value={c.col}>
            {colLetter(c.col)}: {c.text.slice(0, 30)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6" onClick={onClose}>
      <div className="w-full max-w-6xl rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900">{contractId ? "Nhập lại file DT-CP Excel cho hợp đồng" : "Nhập DT-CP Excel của hợp đồng cũ"}</h2>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-800">
            ✕
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-md border-2 border-dashed border-sky-300 bg-sky-50/50 p-3">
          <p className="flex-1 text-sm text-slate-700">{fileName ? <b>{fileName}</b> : "Chọn file DT-CP (.xlsx) của hợp đồng — phần mềm tự đoán các sheet, anh/chị kiểm tra lại rồi bấm Nhập."}</p>
          <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])} />
          <button type="button" disabled={pending} onClick={() => inputRef.current?.click()} className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
            {pending && !a ? "Đang đọc file..." : a ? "Chọn file khác" : "📎 Chọn file Excel"}
          </button>
        </div>

        {a && (
          <div className="mt-4 space-y-4">
            <section className="grid gap-3 sm:grid-cols-4">
              <label className="text-sm">
                <span className="font-medium text-slate-700">Khu vực *</span>
                <select className={`${inp} mt-1 w-full ${!area ? "border-red-400 bg-red-50" : ""}`} value={area} onChange={(e) => { setArea(e.target.value); if (parentId && parents.find((p) => p.id === parentId)?.area !== e.target.value) setParentId(""); }}>
                  <option value="">— Chọn —</option>
                  {["1", "2", "3", "4", "5"].map((k) => (
                    <option key={k} value={k}>
                      Khu vực {k}
                    </option>
                  ))}
                </select>
              </label>
              {(
                [
                  ["packageName", "Gói thầu"],
                  ["contractNo", "Số hợp đồng"],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="text-sm">
                  <span className="font-medium text-slate-700">{l}</span>
                  <input className={`${inp} mt-1 w-full`} value={meta[k]} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} />
                </label>
              ))}
              <div className="text-sm sm:col-span-4">
                <span className="font-medium text-slate-700">Dự án * (chọn trong Danh mục dự án theo mã — các hợp đồng cùng dự án tự ghép 1 nhánh cây)</span>
                <SitePicker
                  sites={sites}
                  value={siteId}
                  area={area}
                  invalid={!asPl}
                  disabled={asPl}
                  className="mt-1 rounded border border-slate-300 py-1"
                  title={asPl ? "Phụ lục: theo dự án của hợp đồng gốc" : undefined}
                  placeholder={meta.name ? `Trong file ghi “${meta.name}” — chọn dự án tương ứng` : undefined}
                  onChange={(s) => {
                    setSiteId(s?.id ?? "");
                    if (s) setMeta((m) => ({ ...m, name: s.name }));
                    if (s?.area && !area) setArea(s.area);
                  }}
                />
              </div>
            </section>

            {!contractId && (
              <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="font-medium text-slate-700">DT-CP này là:</span>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="dtcp-kind"
                      checked={!asPl}
                      onChange={() => {
                        setAsPl(false);
                        setParentId("");
                        setMeta((m) => ({ ...m, appendixNo: "" }));
                      }}
                    />
                    Hợp đồng gốc
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="dtcp-kind" checked={asPl} onChange={() => setAsPl(true)} />
                    Phụ lục của một hợp đồng
                  </label>
                </div>
                {asPl && (
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <label className="sm:col-span-2">
                      <span className="font-medium text-slate-700">Chọn hợp đồng (các hợp đồng đã có trong Khu vực {area || "…"}) *</span>
                      <select className={`${inp} mt-1 w-full ${!parentId ? "border-red-400 bg-red-50" : ""}`} value={parentId} onChange={(e) => pickParent(e.target.value)} disabled={!area}>
                        <option value="">{area ? "— Chọn hợp đồng gốc —" : "— Chọn Khu vực ở trên trước —"}</option>
                        {parentList.map((p) => (
                          <option key={p.id} value={p.id}>
                            {[p.contractNo ? `HĐ ${p.contractNo}` : "HĐ (chưa có số)", p.packageName, p.name].filter(Boolean).join(" — ")}
                          </option>
                        ))}
                      </select>
                      {area && !parentList.length && <span className="mt-1 block text-xs text-amber-700">Khu vực này chưa có hợp đồng gốc nào — nhập hợp đồng gốc trước, hoặc đổi Khu vực.</span>}
                    </label>
                    <label>
                      <span className="font-medium text-slate-700">Tên phụ lục (PL01, PL02…) *</span>
                      <input className={`${inp} mt-1 w-full ${!meta.appendixNo.trim() ? "border-red-400 bg-red-50" : ""}`} value={meta.appendixNo} onChange={(e) => setMeta({ ...meta, appendixNo: e.target.value })} placeholder="PL04" />
                    </label>
                  </div>
                )}
              </section>
            )}

            <section>
              <h3 className="text-sm font-semibold text-slate-800">1. Sheet nào là gì?</h3>
              <table className="mt-1 w-full text-sm">
                <tbody>
                  {ROLE_ROWS.map((r) => {
                    // BOQ: chọn nhiều sheet bằng ô tick
                    if (r.value === "BOQ")
                      return (
                        <tr key="BOQ" className="border-t border-slate-100 align-top">
                          <td className="w-48 py-2 font-medium">
                            {r.label}
                            <span className="text-red-600"> *</span>
                          </td>
                          <td className="py-2">
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              {sheetNames.map((n) => (
                                <label key={n} className={`flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${boq.includes(n) ? "border-emerald-400 bg-emerald-50" : "border-slate-200"}`}>
                                  <input type="checkbox" checked={boq.includes(n)} onChange={(e) => setBoq(e.target.checked ? [...boq, n] : boq.filter((x) => x !== n))} />
                                  {n}
                                </label>
                              ))}
                            </div>
                            {!boq.length && <span className="text-xs text-red-600">Chưa chọn sheet BOQ</span>}
                          </td>
                        </tr>
                      );
                    const one = r.value as OneRole;
                    const s = roles[one] ? sheets[roles[one]] : null;
                    const sure = s?.guess === r.value && s.sure;
                    return (
                      <tr key={r.value} className="border-t border-slate-100 align-top">
                        <td className="w-48 py-2 font-medium">
                          {r.label}
                          {one === "TB" ? <span className="ml-1 text-xs font-normal text-slate-500">(không bắt buộc)</span> : <span className="text-red-600"> *</span>}
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              className={`${inp} ${s ? (sure ? "border-emerald-400 bg-emerald-50" : "border-amber-400 bg-amber-50") : one === "TB" ? "border-slate-300 bg-white" : "border-red-400 bg-red-50"}`}
                              value={roles[one]}
                              onChange={(e) => {
                                setRoles({ ...roles, [one]: e.target.value });
                                if (one === "DTCP") loadLinks(e.target.value);
                                if (["NC", "TP", "VT", "TB"].includes(one) && e.target.value) void ensureInfo(e.target.value);
                              }}
                            >
                              <option value="">— Không có / bỏ qua —</option>
                              {sheetNames.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                            {s && <span className={`text-xs ${sure ? "text-emerald-700" : "text-amber-700"}`}>{sure ? "✓ phần mềm nhận đúng" : "⚠ kiểm tra lại sheet / cột"}</span>}
                          </div>
                          {s && ["NC", "TP", "VT", "TB"].includes(r.value) && (
                            <div className="mt-2 space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
                              <div className="flex flex-wrap items-end gap-3">
                                <label className="text-xs">
                                  <span className="block text-slate-500">Dòng tiêu đề</span>
                                  <input type="number" min={1} className={`${inp} w-20 text-xs`} defaultValue={s.headerRow || ""} key={`${s.name}-${s.headerRow}`} onBlur={(e) => Number(e.target.value) !== s.headerRow && Number(e.target.value) > 0 && changeHeader(s.name, Number(e.target.value))} />
                                </label>
                                {colSelect(s, "stt", "Cột STT")}
                                {colSelect(s, "name", "Cột NỘI DUNG *")}
                                {colSelect(s, "unit", "Cột ĐVT")}
                                {colSelect(s, "qty", "Cột khối lượng")}
                                {colSelect(s, "amount", "Cột thành tiền")}
                              </div>
                              {/* Cột đơn giá: mỗi THỜI ĐIỂM 1 ô chọn cột (DT-CP không chia thời điểm: 1 ô "Đơn giá") */}
                              <div className="flex flex-wrap items-end gap-3 text-xs">
                                {(versions.length ? versions.map((v) => ({ key: String(v.n), label: `Đơn giá ${v.label || `Thời điểm ${v.n}`}` })) : [{ key: "0", label: "Cột đơn giá" }]).map((pv) => {
                                  const cur = s.colMap.prices[pv.key];
                                  const clash = cur != null && (cur === s.colMap.qty || cur === s.colMap.amount);
                                  return (
                                    <label key={pv.key} className="text-xs">
                                      <span className={`block ${pv.key === String(approved) ? "font-semibold text-emerald-700" : "text-slate-500"}`}>
                                        {pv.label}
                                        {versions.length > 0 && pv.key === String(approved) && " (kiểm soát)"}
                                      </span>
                                      <select
                                        className={`${inp} w-60 text-xs ${cur == null ? "border-amber-400 bg-amber-50" : clash ? "border-red-400 bg-red-50" : ""}`}
                                        value={cur ?? ""}
                                        onChange={(e) => {
                                          const rest = Object.fromEntries(Object.entries(s.colMap.prices).filter(([k]) => k !== pv.key));
                                          setCol(s.name, { prices: e.target.value ? { ...rest, [pv.key]: Number(e.target.value) } : rest });
                                        }}
                                      >
                                        <option value="">— không có —</option>
                                        {s.columns.map((c) => (
                                          <option key={c.col} value={c.col}>
                                            {colLetter(c.col)}: {c.text.slice(0, 36)}
                                          </option>
                                        ))}
                                      </select>
                                      {clash && <span className="block text-red-600">⚠ trùng cột {cur === s.colMap.qty ? "khối lượng" : "thành tiền"}</span>}
                                    </label>
                                  );
                                })}
                              </div>
                              <div className="overflow-x-auto">
                                <table className="text-[11px] text-slate-600">
                                  <tbody>
                                    {(() => {
                                      // tô cột đang chọn: khối lượng (xanh dương), đơn giá (xanh lá), thành tiền (vàng)
                                      const priceCols = new Set(Object.values(s.colMap.prices));
                                      const tone = (col: number) => (priceCols.has(col) ? "bg-emerald-50" : col === s.colMap.qty ? "bg-sky-50" : col === s.colMap.amount ? "bg-amber-50" : "bg-white");
                                      const width = Math.max(0, ...s.preview.map((r) => r.length));
                                      return (
                                        <>
                                          <tr className="text-center text-[10px] text-slate-400">
                                            {Array.from({ length: width }, (_, j) => (
                                              <td key={j} className={`border border-slate-200 px-1 ${tone(j + 1)}`}>
                                                {colLetter(j + 1)}
                                                {priceCols.has(j + 1) ? " · đơn giá" : j + 1 === s.colMap.qty ? " · KL" : j + 1 === s.colMap.amount ? " · TT" : ""}
                                              </td>
                                            ))}
                                          </tr>
                                          {s.preview.map((row, i) => (
                                            <tr key={i} className={i === 0 ? "font-semibold" : ""}>
                                              {row.map((c, j) => (
                                                <td key={j} className={`whitespace-nowrap border border-slate-200 px-1 ${tone(j + 1)}`}>
                                                  {c}
                                                </td>
                                              ))}
                                            </tr>
                                          ))}
                                        </>
                                      );
                                    })()}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            {/* KIỂM TRA LIÊN KẾT: mọi chi phí ở sheet DT-CP phải link từ 6 sheet cơ bản còn lại */}
            <section className={`rounded-lg border-2 p-3 ${missingSheets.length ? "border-red-300 bg-red-50" : badLinks.length ? "border-amber-300 bg-amber-50" : links ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
              <h3 className="text-sm font-semibold text-slate-800">Ghi nhận liên kết của sheet DT-CP (để kiểm soát, không chặn nhập)</h3>
              {!roles.DTCP ? (
                <p className="mt-1 text-sm text-red-700">Chưa chọn sheet DT-CP.</p>
              ) : !links ? (
                <p className="mt-1 text-sm text-slate-500">Đang đọc công thức của sheet DT-CP…</p>
              ) : (
                <div className="mt-1 space-y-2 text-sm">
                  {missingSheets.length > 0 && (
                    <p className="text-red-700">
                      ⛔ Thiếu sheet cơ bản: <b>{missingSheets.join(", ")}</b>. File DT-CP phải có đủ 6 sheet bắt buộc (DT-CP, BOQ, CHI TIẾT, TH Vật Tư, TH Nhân Công, TH Thầu Phụ; TH Thiết Bị có thể không có) — bổ sung vào file rồi chọn lại.
                    </p>
                  )}
                  {badLinks.length > 0 ? (
                    <div className="text-amber-800">
                      <p>
                        ℹ Sheet DT-CP có công thức trỏ tới sheet <b>ngoài 6 sheet cơ bản</b> (phần mềm ghi nhận lại để kiểm soát, vẫn nhập bình thường):
                      </p>
                      <ul className="mt-1 list-disc pl-5 text-xs">
                        {badLinks.map((b) => (
                          <li key={`${b.external}-${b.sheet}`}>
                            {b.external ? <b>File Excel ngoài ({b.sheet})</b> : <>Sheet <b>&quot;{b.sheet}&quot;</b></>} — {b.count} công thức, VD ô {b.cells.slice(0, 4).join(", ")}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    !missingSheets.length && <p className="text-emerald-800">✓ Công thức của sheet DT-CP chỉ link từ 6 sheet cơ bản ({links.refs.length ? links.refs.map((r) => r.sheet).join(", ") : "không có link sang sheet khác"}).</p>
                  )}
                  {links.consts.length > 0 && (
                    <p className="text-xs text-amber-800">
                      ⚠ Có {links.consts.length} ô THÀNH TIỀN trong DT-CP là số gõ tay (không có công thức, không link từ sheet nào): {links.consts.slice(0, 8).map((c) => c.cell).join(", ")}
                      {links.consts.length > 8 ? "…" : ""} — nên kiểm tra lại (không chặn nhập).
                    </p>
                  )}
                </div>
              )}
            </section>

            <section>
              <h3 className="text-sm font-semibold text-slate-800">2. Thời điểm DT-CP — chọn thời điểm &quot;Đã duyệt&quot; dùng để kiểm soát giá</h3>
              {versions.length ? (
                <div className="mt-1 flex flex-wrap gap-3 text-sm">
                  {versions.map((v) => (
                    <label key={v.n} className={`flex items-center gap-1.5 rounded border px-2 py-1 ${approved === v.n ? "border-emerald-400 bg-emerald-50" : "border-slate-200"}`}>
                      <input type="radio" checked={approved === v.n} onChange={() => setApproved(v.n)} />
                      {v.label}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500">File chỉ có 1 cột đơn giá — dùng đơn giá đó để kiểm soát.</p>
              )}
            </section>

            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-sm text-violet-800" title="Đưa chi tiết từ các sheet ngoài 7 sheet cơ bản (hoặc sheet TH chỉ có dòng tổng) về đúng sheet TH, lấy sheet DT-CP làm chuẩn">
                <input type="checkbox" checked={standardize} onChange={(e) => { setStandardize(e.target.checked); setNorm(null); }} />
                🧹 Làm chuẩn 7 sheet
              </label>
              {standardize && (
                <button type="button" disabled={pending || !canImport} onClick={doCheck} className="rounded-md bg-violet-700 px-5 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50">
                  {pending && !norm ? "Đang kiểm tra..." : "🔍 Kiểm tra & làm chuẩn"}
                </button>
              )}
              <button type="button" disabled={pending || !canImport || (standardize && !norm)} onClick={doImport} className="rounded-md bg-emerald-700 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50">
                {pending && (!standardize || norm) ? "Đang nhập..." : standardize ? "Nhập DT-CP đã làm chuẩn" : contractId ? "Nhập lại (thay dữ liệu DT-CP, giữ sổ giá đã duyệt)" : "Nhập DT-CP"}
              </button>
              {missingSheets.length > 0 && <span className="text-xs text-red-600">Thiếu sheet: {missingSheets.join(", ")}</span>}
              {!area && <span className="text-xs text-red-600">Cần chọn Khu vực</span>}
            </div>
            {standardize && norm && <NormReport norm={norm} />}
          </div>
        )}
      </div>
    </div>
  );
}
