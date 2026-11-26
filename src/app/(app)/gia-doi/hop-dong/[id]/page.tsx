import { Fragment } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { fmtDate } from "@/lib/proc";
import { canPrice, getPriceUser, inPriceAreas, isTP, KIND_LABEL, PRICE_STATUS } from "@/lib/gia-doi";
import CostEdit from "./CostEdit";
import { canManageContracts, loadLedger, parseVersions, type LedgerRow } from "@/lib/hop-dong";
import { COST_KINDS, lineKeyOf, normText, priceAt } from "@/lib/hop-dong-calc";
import { Badge, Empty, Section, td, th } from "../../../mua-vat-tu/ui";
import { ContractInfo } from "../ContractButtons";
import OldPriceImport from "../../OldPriceImport";
import { loadOutside } from "@/lib/doi-chieu";
import DoiChieu from "./DoiChieu";
import { loadCumulative } from "@/lib/luy-ke";
import OldSheetView, { toSnap } from "./OldSheetView";
import RebuildSheetsButton from "./RebuildSheetsButton";
import { loadSites } from "@/lib/project-site";
import { loadOverviews } from "@/lib/hd-overview";
import Overview from "./Overview";

const fm = (n: number | null | undefined) => (n ? Math.round(n).toLocaleString("vi-VN") : "");
const fq = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("vi-VN", { maximumFractionDigits: 2 }));
const STATUS: Record<LedgerRow["status"], { label: string; cls: string }> = {
  APPROVED: { label: "🟢 Đã duyệt", cls: "bg-emerald-100 text-emerald-800" },
  PENDING: { label: "🟡 Chờ duyệt", cls: "bg-amber-100 text-amber-800" },
  REJECTED: { label: "🔴 Cần trình lại", cls: "bg-red-100 text-red-700" },
  NONE: { label: "⚪ Chưa trình", cls: "bg-slate-100 text-slate-600" },
};

// Hợp đồng (DT-CP): SỔ GIÁ ĐỘI trên TH Nhân Công (trạng thái từng giá, giá duyệt theo đội, lịch sử), các sheet TH khác, hồ sơ trình
// 3 sheet chỉ xem (bản chụp từ file DT-CP Excel cũ) + 4 sheet TH = 7 SHEET CƠ BẢN của DT-CP
const SNAP_TABS = [
  { value: "DTCP", label: "DT-CP" },
  { value: "BOQ", label: "BOQ" },
  { value: "CT", label: "CHI TIẾT" },
];
const isNumCell = (v: unknown): v is number => typeof v === "number";

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; st?: string; q?: string; sheet?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const u = (await getPriceUser())!;
  const tpEdit = isTP(u); // Trưởng phòng được điều chỉnh dòng DT-CP (tránh QSTT / QSĐT sửa file Excel DT-CP trước khi tải lên)
  // TỔNG QUAN QUẢN LÝ (QL) là tab mặc định: bấm vào hợp đồng là thấy ngay giá trị theo DT-CP / đã duyệt / dự kiến quyết toán từng khoản
  const tab = ["QL", "NC", "TP", "VT", "TB", "HS", "DC", "LK", "DTCP", "BOQ", "CT"].includes(sp.tab ?? "") ? sp.tab! : "QL";
  const isSnap = tab === "DTCP" || tab === "BOQ" || tab === "CT";
  const led = await loadLedger(id, tab === "QL" || tab === "HS" || tab === "DC" || tab === "LK" || isSnap ? "NC" : tab);
  const snapCounts = await prisma.costSheet.groupBy({ by: ["role"], where: { contractId: id }, _count: true });
  const snapN = (r: string) => snapCounts.find((x) => x.role === r)?._count ?? 0;
  const snaps = isSnap ? await prisma.costSheet.findMany({ where: { contractId: id, role: tab }, orderBy: { orderIndex: "asc" } }) : [];
  const snap = snaps.find((s) => s.name === sp.sheet) ?? snaps[0];
  let linkRefs: { sheet: string; external: boolean; count: number }[] = [];
  try {
    linkRefs = JSON.parse(led?.contract.linkInfo || "[]");
  } catch {}
  const lk = tab === "LK" ? await loadCumulative(id) : null;
  // tổng quan tính theo HỢP ĐỒNG GỐC (gồm các phụ lục); đang xem phụ lục thì hiện tổng quan của hợp đồng gốc
  const ovId = tab === "QL" ? (led?.contract.appendixOfId ?? id) : "";
  const ov = ovId ? (await loadOverviews([ovId])).get(ovId) : undefined;
  if (!led) notFound();
  const c = led.contract;
  // hợp đồng GỐC có thể chọn làm hợp đồng của phụ lục (không gồm chính nó; hợp đồng đang có phụ lục gắn vào thì không thể thành phụ lục)
  const hasAppendix = (await prisma.costContract.count({ where: { appendixOfId: id } })) > 0;
  const parents = hasAppendix ? [] : await prisma.costContract.findMany({ where: { id: { not: id }, appendixOfId: null }, orderBy: { name: "asc" }, select: { id: true, name: true, area: true, contractNo: true, packageName: true } });
  if (!inPriceAreas(u, c.area)) redirect("/gia-doi/hop-dong");
  const versions = parseVersions(c.versions);
  const counts = await prisma.costLine.groupBy({ by: ["kind"], where: { contractId: id, level: "ITEM" }, _count: true });
  const cnt = (k: string) => counts.find((x) => x.kind === k)?._count ?? 0;
  const dc = tab === "DC" ? await loadOutside(id) : null;
  // số công việc giá đội đã duyệt chưa gắn DT-CP (hiện trên nhãn tab Đối chiếu)
  const outsideN = new Set((await prisma.approvedPrice.findMany({ where: { contractId: id, kind: "NC", lineKey: "" }, select: { name: true, unit: true } })).map((a) => lineKeyOf(a.name, a.unit))).size;
  const subs = tab === "HS" ? await prisma.priceSubmission.findMany({ where: { contractId: id }, orderBy: { createdAt: "desc" }, select: { id: true, imported: true, code: true, kind: true, crewName: true, batch: true, revision: true, status: true, createdAt: true, reviewedByName: true } }) : [];

  // lọc sổ giá
  const q = normText(sp.q ?? "");
  const st = sp.st ?? "";
  const items = led.rows.filter((r) => r.level === "ITEM");
  const shown = led.rows.filter((r) => {
    if (r.level !== "ITEM") return !q && !st; // đầu mục chỉ hiện khi không lọc
    if (st && r.status !== st && !(st === "PENDING" && r.pending)) return false;
    return !q || normText(r.name).includes(q);
  });
  const vCols = versions.length ? versions : [{ n: 0, label: "Đơn giá", approved: true }];
  const tabLink = (t: string, label: string, n?: number) => (
    <Link key={t} href={`/gia-doi/hop-dong/${id}?tab=${t}`} className={`-mb-px rounded-t-md border px-3 py-1.5 text-sm ${tab === t ? "border-slate-200 border-b-white bg-white font-medium" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
      {label}
      {n != null && <span className="ml-1 text-xs text-slate-400">({n})</span>}
    </Link>
  );
  const stLink = (s: string, label: string, n: number) => (
    <Link key={s} href={`/gia-doi/hop-dong/${id}?tab=${tab}${s ? `&st=${s}` : ""}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} className={`rounded-full px-3 py-1 text-xs ${st === s ? "bg-slate-800 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
      {label} ({n})
    </Link>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/gia-doi/hop-dong" className="text-sm text-slate-500 hover:underline">
          ← Hợp đồng
        </Link>
        <span className="text-sm text-slate-600">
          <b>{c.name}</b>
          {c.packageName && ` — ${c.packageName}`} {c.contractNo && `· HĐ ${c.contractNo}`}{c.appendixNo && ` · ${c.appendixNo}`} · {c.source === "APP" ? "DT-CP phần mềm" : `Excel: ${c.fileName}`} · cập nhật {fmtDate(c.importedAt)}
        </span>
      </div>

      <Section title="Thông tin hợp đồng">
        <ContractInfo id={id} sites={await loadSites()} init={{ area: c.area, siteId: c.siteId ?? "", name: c.name, packageName: c.packageName, contractNo: c.contractNo, appendixNo: c.appendixNo, appendixOfId: c.appendixOfId ?? "", approvedVersion: c.approvedVersion }} parents={parents} versions={versions} source={c.source} canEdit={canManageContracts(u)} isAdmin={u.isAdmin} />
      </Section>

      <nav className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabLink("QL", "Tổng quan quản lý")}
        {SNAP_TABS.map((t) => tabLink(t.value, c.source === "APP" ? t.label : snapN(t.value) ? t.label : `⚠ ${t.label}`, c.source === "APP" ? undefined : snapN(t.value)))}
        {COST_KINDS.map((k) => tabLink(k.value, k.value === "NC" ? "TH Nhân Công" : k.value === "TP" ? "TH Thầu Phụ" : `TH ${k.label}`, cnt(k.value)))}
        {tabLink("DC", outsideN ? "⚠ Đối chiếu sổ giá với DT-CP" : "Đối chiếu sổ giá với DT-CP", outsideN)}
        {tabLink("LK", "Lũy kế các đợt duyệt")}
        {tabLink("HS", "Hồ sơ trình giá")}
      </nav>

      {tab === "QL" && ov && (
        <section className="space-y-2">
          {ovId !== id && (
            <p className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              Đây là phụ lục — tổng quan tính chung cho hợp đồng gốc.{" "}
              <Link href={`/gia-doi/hop-dong/${ovId}`} className="font-medium underline">
                Mở hợp đồng gốc →
              </Link>
            </p>
          )}
          <Overview ov={ov} canEdit={canManageContracts(u) && ovId === id} />
        </section>
      )}

      {isSnap && (
        <section className="space-y-3">
          {c.source === "APP" ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
              DT-CP lập trên phần mềm — xem sheet <b>{SNAP_TABS.find((t) => t.value === tab)?.label}</b> ngay trong dự án{c.projectId ? "" : " (hợp đồng chưa gắn dự án)"}.{" "}
              {c.projectId && (
                <Link href={`/projects/${c.projectId}`} className="font-medium text-sky-700 underline">
                  Mở DT-CP của dự án →
                </Link>
              )}
            </div>
          ) : !snap ? (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              ⚠ Hợp đồng này nhập DT-CP Excel trước khi có sheet <b>{SNAP_TABS.find((t) => t.value === tab)?.label}</b> trên phần mềm. QSTT bấm <b>📥 Nhập lại file DT-CP</b> (ở phần Thông tin hợp đồng) để nhập đủ các sheet cơ bản.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>
                  Bản chụp từ file Excel &quot;{c.fileName}&quot; (chỉ xem; số dòng, số cột, nội dung đúng như file).
                </span>
                {snaps.length > 1 &&
                  snaps.map((x) => (
                    <Link key={x.id} href={`/gia-doi/hop-dong/${id}?tab=${tab}&sheet=${encodeURIComponent(x.name)}`} className={`rounded-full px-3 py-1 text-xs ${x.id === snap.id ? "bg-slate-800 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
                      {x.name}
                    </Link>
                  ))}
                {canManageContracts(u) && <RebuildSheetsButton contractId={id} />}
              </div>
              {tab === "DTCP" && linkRefs.length > 0 && (
                <p className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  Liên kết ghi nhận của sheet DT-CP: {linkRefs.map((r) => `${r.external ? "file ngoài " : ""}${r.sheet} (${r.count})`).join(" · ")}
                </p>
              )}
              <OldSheetView
                snap={toSnap(JSON.parse(snap.rows || "[]"))}
                page={Number(sp.page) || 1}
                pageHref={(p) => `/gia-doi/hop-dong/${id}?tab=${tab}&sheet=${encodeURIComponent(snap.name)}&page=${p}`}
                letterhead={tab === "DTCP"}
                sheetName={snap.name}
                sheetId={snap.id}
                canEdit={canManageContracts(u)}
              />
            </>
          )}
        </section>
      )}

      {tab === "LK" && lk && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <h2 className="font-semibold text-slate-900">Tổng hợp lũy kế các đợt duyệt đơn giá tổ đội</h2>
              <p className="text-xs text-slate-500">
                Mỗi dòng = 1 công việc × 1 đội; mỗi đợt duyệt = 1 nhóm cột. Tính các hồ sơ đã duyệt (kể cả hồ sơ cũ nhập vào); hồ sơ đã trình lại và lần sau đã duyệt thì chỉ tính lần sau.
                KL còn lại = KL DT-CP − lũy kế KL của mọi đội trên cùng dòng (âm = vượt, tô đỏ).
              </p>
            </div>
            {lk.rows.length > 0 && (
              <a href={`/gia-doi/hop-dong/${id}/luy-ke`} className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
                ⬇ Tải Excel lũy kế
              </a>
            )}
          </div>
          {lk.rows.length === 0 ? (
            <Empty>Chưa có đợt duyệt đơn giá nào cho hợp đồng này.</Empty>
          ) : (
            <div className="xfreeze rounded border border-slate-200" style={{ "--fz1": "40px", "--fz2": "280px", "--fzh": "52px" } as React.CSSProperties}>
              <table className="border-collapse text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th rowSpan={2} className="border border-slate-200 px-1.5 py-1">STT</th>
                    <th rowSpan={2} className="min-w-[280px] max-w-[280px] border border-slate-200 px-1.5 text-left">Nội dung</th>
                    <th rowSpan={2} className="border border-slate-200 px-1.5">ĐVT</th>
                    <th rowSpan={2} className="border border-slate-200 px-1.5">Đội</th>
                    <th rowSpan={2} className="border border-slate-200 px-1.5">KL DT-CP</th>
                    <th rowSpan={2} className="border border-slate-200 px-1.5">ĐG DT-CP (kiểm soát)</th>
                    {lk.batches.map((b) => (
                      <th key={b.key} colSpan={3} className="border border-slate-200 bg-sky-50 px-1.5 text-sky-900">
                        {b.label} <span className="font-normal text-slate-500">({b.date})</span>
                      </th>
                    ))}
                    <th colSpan={3} className="border border-slate-200 bg-emerald-50 px-1.5 text-emerald-900">LŨY KẾ</th>
                  </tr>
                  <tr>
                    {lk.batches.map((b) => (
                      <Fragment key={b.key}>
                        <th className="min-w-[80px] border border-slate-200 px-1.5 font-normal">KL</th>
                        <th className="min-w-[80px] border border-slate-200 px-1.5 font-normal">Đơn giá duyệt</th>
                        <th className="min-w-[80px] border border-slate-200 px-1.5 font-normal">Thành tiền</th>
                      </Fragment>
                    ))}
                    <th className="border border-slate-200 bg-emerald-50 px-1.5 font-normal">KL</th>
                    <th className="border border-slate-200 bg-emerald-50 px-1.5 font-normal">Thành tiền</th>
                    <th className="border border-slate-200 bg-emerald-50 px-1.5 font-normal">KL còn lại theo DT-CP</th>
                  </tr>
                </thead>
                <tbody>
                  {lk.rows.map((r, i) => {
                    const left = !r.outside && r.dtQty != null ? r.dtQty - (lk.lineQty.get(r.lineKey) ?? 0) : null;
                    const firstOutside = r.outside && !lk.rows[i - 1]?.outside;
                    return (
                      <Fragment key={r.key}>
                        {firstOutside && (
                          <tr className="bg-yellow-50 font-semibold">
                            <td className="border border-slate-200 px-1.5" />
                            <td className="min-w-[280px] max-w-[280px] border border-slate-200 px-1.5">CÔNG VIỆC NGOÀI DT-CP</td>
                            <td className="border border-slate-200 px-1.5" colSpan={7 + lk.batches.length * 3} />
                          </tr>
                        )}
                        <tr className="align-top">
                          <td className="border border-slate-200 px-1.5 text-center">{r.stt}</td>
                          <td className="min-w-[280px] max-w-[280px] border border-slate-200 px-1.5">{r.name}</td>
                          <td className="border border-slate-200 px-1.5 text-center">{r.unit}</td>
                          <td className="border border-slate-200 px-1.5">{r.crew || <span className="text-slate-400">(chưa có đội)</span>}</td>
                          <td className="border border-slate-200 px-1.5 text-right">{fq(r.dtQty)}</td>
                          <td className="border border-slate-200 px-1.5 text-right">{fm(r.dtPrice)}</td>
                          {lk.batches.map((b) => {
                            const c = r.cells[b.key];
                            const over = c && r.dtPrice != null && c.price > r.dtPrice + 0.5;
                            return (
                              <Fragment key={b.key}>
                                <td className="border border-slate-200 px-1.5 text-right">{c ? fq(c.qty) : ""}</td>
                                <td className={`border border-slate-200 px-1.5 text-right ${over ? "font-semibold text-red-600" : ""}`} title={over ? "Cao hơn đơn giá DT-CP" : undefined}>
                                  {c ? fm(c.price) : ""}
                                </td>
                                <td className="border border-slate-200 px-1.5 text-right">{c ? fm(c.amount) : ""}</td>
                              </Fragment>
                            );
                          })}
                          <td className="border border-slate-200 bg-emerald-50/40 px-1.5 text-right font-semibold">{fq(r.qty)}</td>
                          <td className="border border-slate-200 bg-emerald-50/40 px-1.5 text-right font-semibold">{fm(r.amount)}</td>
                          <td className={`border border-slate-200 bg-emerald-50/40 px-1.5 text-right ${left != null && left < -1e-6 ? "font-bold text-red-600" : ""}`}>{left == null ? "" : fq(left)}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                  <tr className="bg-slate-100 font-bold">
                    <td className="border border-slate-200 px-1.5" />
                    <td className="min-w-[280px] max-w-[280px] border border-slate-200 px-1.5">TỔNG CỘNG</td>
                    <td className="border border-slate-200 px-1.5" colSpan={4} />
                    {lk.batches.map((b) => (
                      <Fragment key={b.key}>
                        <td className="border border-slate-200 px-1.5" colSpan={2} />
                        <td className="border border-slate-200 px-1.5 text-right">{fm(lk.rows.reduce((t, r) => t + (r.cells[b.key]?.amount ?? 0), 0))}</td>
                      </Fragment>
                    ))}
                    <td className="border border-slate-200 px-1.5" />
                    <td className="border border-slate-200 px-1.5 text-right text-emerald-800">{fm(lk.rows.reduce((t, r) => t + r.amount, 0))}</td>
                    <td className="border border-slate-200 px-1.5" />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {(tab === "NC" || tab === "TP") && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            {stLink("", "Tất cả", items.length)}
            {stLink("APPROVED", STATUS.APPROVED.label, items.filter((r) => r.status === "APPROVED").length)}
            {stLink("PENDING", STATUS.PENDING.label, items.filter((r) => r.pending).length)}
            {stLink("REJECTED", STATUS.REJECTED.label, items.filter((r) => r.status === "REJECTED").length)}
            {stLink("NONE", STATUS.NONE.label, items.filter((r) => r.status === "NONE").length)}
            <form className="ml-auto flex gap-1">
              <input type="hidden" name="tab" value={tab} />
              {st && <input type="hidden" name="st" value={st} />}
              <input name="q" defaultValue={sp.q ?? ""} placeholder={tab === "TP" ? "Tìm công việc thầu phụ..." : "Tìm nhân công (không cần dấu)..."} className="w-64 rounded border border-slate-300 px-2 py-1 text-sm" />
              <button className="rounded border border-slate-300 px-3 py-1 text-sm">Tìm</button>
            </form>
          </div>
          {tpEdit && <p className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-800">Trưởng phòng: bấm vào tên, ĐVT, khối lượng hoặc đơn giá của dòng để điều chỉnh DT-CP (Enter lưu, Esc huỷ). Mọi thay đổi được ghi nhật ký.</p>}
          <p className="text-xs text-slate-500">
            Đơn giá kiểm soát = thời điểm <b>{vCols.find((v) => v.n === led.version)?.label ?? "đã duyệt"}</b>. Giá duyệt ghi theo từng {tab === "TP" ? "thầu phụ" : "đội"}, áp dụng từ ngày hiệu lực (giá cũ vẫn giữ trong lịch sử).
          </p>
          <div className="xfreeze rounded border border-slate-200" style={{ "--fz1": "40px", "--fz2": "280px", "--fzh": "40px" } as React.CSSProperties}>
            <table className="w-full min-w-[1300px] border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="border border-slate-200 px-1.5 py-1.5">STT</th>
                  <th className="border border-slate-200 px-1.5 py-1.5 text-left">{tab === "TP" ? "Công việc thầu phụ" : "Nhân công"}</th>
                  <th className="border border-slate-200 px-1.5">ĐVT</th>
                  <th className="border border-slate-200 px-1.5">KL DT-CP</th>
                  {vCols.map((v) => (
                    <th key={v.n} className={`border border-slate-200 px-1.5 ${v.n === led.version ? "bg-emerald-50 text-emerald-800" : ""}`}>
                      {v.n ? `ĐG TĐ${v.n}` : "Đơn giá"}
                      {v.n === led.version && " (kiểm soát)"}
                    </th>
                  ))}
                  <th className="border border-slate-200 px-1.5">VAT %</th>
                  <th className="border border-slate-200 px-1.5">Thành tiền DT-CP (sau VAT)</th>
                  <th className="border border-slate-200 px-1.5">Trạng thái</th>
                  <th className="border border-slate-200 px-1.5 text-left">Giá đã duyệt theo {tab === "TP" ? "thầu phụ" : "đội"} (hiện hành)</th>
                  <th className="border border-slate-200 px-1.5">Lũy kế KL đã trình / KL DT-CP</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) =>
                  r.level !== "ITEM" ? (
                    <tr key={r.key} className="bg-yellow-50 font-semibold">
                      <td className="border border-slate-200 px-1.5 text-center">{r.stt}</td>
                      <td className="border border-slate-200 px-1.5" colSpan={8 + vCols.length}>
                        {r.name}
                      </td>
                    </tr>
                  ) : (
                    <tr key={r.key} className="align-top">
                      <td className="border border-slate-200 px-1.5 text-center">{r.stt}</td>
                      <td className="border border-slate-200 px-1.5">
                        {tpEdit ? <CostEdit contractId={id} lineKey={r.key} field="name" value={r.name} text={r.name} align="left" wide /> : r.name}
                        {r.extra && <span className="ml-1 rounded bg-violet-50 px-1 text-[10px] text-violet-700 ring-1 ring-violet-200" title="Dòng phát sinh bổ sung từ sổ giá (không có trong DT-CP gốc)">phát sinh</span>}
                      </td>
                      <td className="border border-slate-200 px-1.5 text-center">{tpEdit ? <CostEdit contractId={id} lineKey={r.key} field="unit" value={r.unit} text={r.unit} align="center" /> : r.unit}</td>
                      <td className="border border-slate-200 px-1.5 text-right">{tpEdit ? <CostEdit contractId={id} lineKey={r.key} field="qty" value={r.qty} text={fq(r.qty)} /> : fq(r.qty)}</td>
                      {vCols.map((v) => (
                        <td key={v.n} className={`border border-slate-200 px-1.5 text-right ${v.n === led.version ? "bg-emerald-50 font-semibold" : "text-slate-500"}`}>
                          {tpEdit ? <CostEdit contractId={id} lineKey={r.key} field="price" ver={v.n} value={v.n ? (r.prices[String(v.n)] ?? null) : priceAt(r.prices, 0)} text={fm(v.n ? r.prices[String(v.n)] : priceAt(r.prices, 0))} /> : fm(v.n ? r.prices[String(v.n)] : priceAt(r.prices, 0))}
                        </td>
                      ))}
                      {/* dòng khoán gọn (lot) chỉ có thành tiền: lấy thẳng từ file Excel; còn lại = KL × đơn giá kiểm soát */}
                      <td className="border border-slate-200 px-1.5 text-center text-slate-500">{r.vatPct ? `${r.vatPct}%` : ""}</td>
                      <td className="border border-slate-200 px-1.5 text-right">{fm((r.amount ?? (r.qty != null && priceAt(r.prices, led.version) != null ? r.qty * (priceAt(r.prices, led.version) as number) : null)) != null ? ((r.amount ?? r.qty! * (priceAt(r.prices, led.version) as number)) * (1 + (r.vatPct ?? 0) / 100)) : null)}</td>
                      <td className="border border-slate-200 px-1.5 text-center">
                        <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                        {r.status === "APPROVED" && r.pending && <span className="mt-0.5 block text-amber-700">+ đang trình thêm</span>}
                      </td>
                      <td className="border border-slate-200 px-1.5">
                        {r.crews.map((cr) => (
                          <div key={cr.crew}>
                            <b className={r.price != null && cr.price > r.price + 0.5 ? "text-red-600" : "text-emerald-800"}>{fm(cr.price)}</b> — {cr.crew || "(chưa có đội)"}{" "}
                            <span className="text-slate-400">
                              từ {cr.date} · {cr.code} lần {cr.revision}
                            </span>
                          </div>
                        ))}
                        {r.future.map((f, i) => (
                          <div key={`f${i}`} className="text-amber-700">
                            ⏳ <b>{fm(f.price)}</b> — {f.crew || "(chưa có)"} · hiệu lực từ {f.date} · {f.code}
                          </div>
                        ))}
                        {r.history.length > r.crews.length && (
                          <details className="text-slate-500">
                            <summary className="cursor-pointer">Lịch sử ({r.history.length})</summary>
                            {r.history.map((h, i) => (
                              <div key={i}>
                                {h.date}: {fm(h.price)} — {h.crew || "(chưa có đội)"} · {h.code} lần {h.revision} · {h.by}
                              </div>
                            ))}
                          </details>
                        )}
                      </td>
                      <td className={`border border-slate-200 px-1.5 text-right ${r.qty != null && r.cumQty > r.qty + 1e-6 ? "font-semibold text-red-600" : ""}`}>
                        {r.cumQty ? fq(r.cumQty) : "—"} / {fq(r.qty)}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          {tab === "TP" && led.outside.length > 0 && (
            <div>
              <h3 className="mt-2 text-sm font-semibold text-slate-800">Giá thầu phụ đã duyệt NGOÀI DT-CP (chỉ lưu ở hồ sơ)</h3>
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {led.outside.map((a) => (
                    <tr key={a.id} className="border-t border-slate-100">
                      <td className="py-1">{a.name}</td>
                      <td>{a.unit}</td>
                      <td className="text-right font-semibold">{fm(a.price)}</td>
                      <td>{a.crew || "(chưa có)"}</td>
                      <td className="text-slate-500">
                        từ {fmtDate(a.approvedAt)} · {a.submissionCode} lần {a.revision}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "NC" && outsideN > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              ⚠ Có <b>{outsideN}</b> công việc đã duyệt giá đội ({led.outside.length} lần duyệt) chưa gắn vào dòng TH Nhân Công.{" "}
              <Link href={`/gia-doi/hop-dong/${id}?tab=DC`} className="font-semibold underline">
                Đối chiếu với DT-CP →
              </Link>
            </div>
          )}
        </section>
      )}

      {(tab === "VT" || tab === "TB") && (
        <Section title={`TH ${COST_KINDS.find((k) => k.value === tab)?.label} (từ DT-CP, chỉ xem)`}>
          {led.rows.length === 0 ? (
            <Empty>Không có dữ liệu sheet này (chưa chọn khi nhập DT-CP).</Empty>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="border border-slate-200 px-1.5 py-1">STT</th>
                  <th className="border border-slate-200 px-1.5 text-left">Nội dung</th>
                  <th className="border border-slate-200 px-1.5">ĐVT</th>
                  <th className="border border-slate-200 px-1.5">Khối lượng</th>
                  <th className="border border-slate-200 px-1.5">Đơn giá (kiểm soát)</th>
                  <th className="border border-slate-200 px-1.5">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {led.rows.map((r) => (
                  <tr key={r.key} className={r.level !== "ITEM" ? "bg-yellow-50 font-semibold" : ""}>
                    <td className="border border-slate-200 px-1.5 text-center">{r.stt}</td>
                    <td className="border border-slate-200 px-1.5">{r.name}</td>
                    <td className="border border-slate-200 px-1.5 text-center">{r.unit}</td>
                    <td className="border border-slate-200 px-1.5 text-right">{fq(r.qty)}</td>
                    <td className="border border-slate-200 px-1.5 text-right">{fm(r.price)}</td>
                    <td className="border border-slate-200 px-1.5 text-right">{fm(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {tab === "DC" && dc && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <DoiChieu contractId={id} rows={dc.rows} options={dc.options} isApp={c.source === "APP"} canEdit={canPrice(u, "QSTT")} />
        </section>
      )}

      {tab === "HS" && (
        <Section title="Hồ sơ trình giá của hợp đồng">
          {canPrice(u, "QSTT") && (
            <div className="mb-3">
              <OldPriceImport contractId={id} contracts={[{ id, name: c.name, packageName: c.packageName, contractNo: c.contractNo }]} />
            </div>
          )}
          {subs.length === 0 ? (
            <Empty>Chưa có hồ sơ nào gắn với hợp đồng này.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Số</th>
                  <th className={th}>Đội</th>
                  <th className={th}>Đợt / Lần</th>
                  <th className={th}>Loại</th>
                  <th className={th}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className={td}>
                      <Link href={`/gia-doi/${s.id}`} className="font-medium text-sky-700 hover:underline">
                        {s.code}
                      </Link>
                      <span className="block text-xs text-slate-400">{fmtDate(s.createdAt)}</span>
                    </td>
                    <td className={td}>{s.crewName || "(chưa có đội)"}</td>
                    <td className={td}>
                      Đợt {s.batch || "?"} · lần {s.revision}
                    </td>
                    <td className={`${td} text-xs`}>{KIND_LABEL[s.kind]}</td>
                    <td className={td}>
                      <Badge map={PRICE_STATUS} status={s.status} />
                      {s.imported && <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200">hồ sơ cũ</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}
    </div>
  );
}
