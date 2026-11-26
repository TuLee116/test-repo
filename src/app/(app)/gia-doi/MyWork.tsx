import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtMoney } from "@/lib/proc";
import { apprAmountOf, asSub, canSeePrice, canSeeSub, categoryLabel, contractAreaWhere, KIND_LABEL, PRICE_STATUS, savedTotals, siteAmountOf, subAreaWhere, type PriceUser } from "@/lib/gia-doi";
import { priceTaskWhere } from "@/lib/my-tasks";
import { amt, apprPriceOf, BRANCH_LABEL, extraSum, noMgmtFlags, parseExtras, parseJson, parseSavedTotals, parseVatRows, propQtyOf, SUB_STATUS, SUB_TODO_DT_WAIT_MAIL, SUB_TRACK_LABEL, subTodoOf, subTrackOf, totalsOf, withSaved } from "@/lib/thau-phu-calc";
import { toNums } from "@/lib/thau-phu";
import { Badge, Empty, td, th } from "../mua-vat-tu/ui";
import { SiteTag } from "../du-an/SiteBits";

// "VIỆC CỦA TÔI" dùng chung trang Trình giá đội + Trình giá thầu phụ (anh chốt 25/11/2026), mỗi trang chỉ hồ sơ của trang đó, chia theo VAI TRÒ:
// - QSTT giá đội: A. đã duyệt chưa phát hành · B. chờ Trưởng phòng duyệt · C. việc khác
// - QSTT thầu phụ: A. đã duyệt chưa phát hành · B. chờ Phó Tổng duyệt · C. chờ Trưởng phòng duyệt · D. việc khác
// - Trưởng phòng: giá đội 1 danh sách chờ duyệt · thầu phụ: 1 nhánh B (giữ đến khi Phó Tổng duyệt) · 2 nhánh A
// - Phó Tổng: hồ sơ thầu phụ chờ phê duyệt / xem để nắm
// - QSĐT: giữ như cũ (việc phải làm + theo dõi A/B/C hồ sơ mình đã trình)

// ---------- HỒ SƠ GIÁ ĐỘI ----------
// open = chỉ lấy hồ sơ còn việc (dùng khi trang khác cần nạp thêm cho "Việc của tôi")
const PRICE_OPEN = { OR: [{ status: { in: ["DRAFT", "SUBMITTED"] } }, { status: { in: ["APPROVED", "REJECTED"] }, mailSentAt: null }, { status: "APPROVED", dtcpLater: true, contractId: null }] };
export function loadPriceRows(u: PriceUser, open = false) {
  return prisma.priceSubmission.findMany({
    where: open ? { AND: [contractAreaWhere(u), PRICE_OPEN] } : contractAreaWhere(u),
    orderBy: { createdAt: "desc" },
    select: {
      id: true, imported: true, code: true, contractNo: true, kind: true, projectName: true, itemName: true, batch: true, batchDate: true, category: true, status: true, fileName: true, crewName: true, revision: true,
      contractId: true,
      dtcpLater: true,
      contract: { select: { name: true, contractNo: true, appendixNo: true, packageName: true, area: true } },
      site: { select: { id: true, code: true, name: true, status: true, area: true, cluster: true, clusterName: true } }, // DANH MỤC DỰ ÁN
      createdById: true, createdByName: true, createdAt: true, submittedAt: true, reviewedByName: true, reviewedAt: true, mailSentAt: true,
      totalAmounts: true,
      lines: { select: { level: true, qty: true, basePrice: true, siteOpinion: true, sitePrice: true, ptOpinion: true, ptPrice: true, tpPrice: true, tpOk: true, formulas: true, siteAmount: true, tpAmount: true } },
    },
  });
}
export type PriceRow = Awaited<ReturnType<typeof loadPriceRows>>[number];

// giá trị hồ sơ: dùng TỔNG CỘNG đã lưu (kể cả công thức QSTT / Trưởng phòng sửa tay); hồ sơ cũ chưa lưu thì cộng lại từ các dòng
export const priceValueOf = (x: PriceRow, approved: boolean) => {
  const saved = savedTotals(x.totalAmounts)[approved ? "appr" : "site"];
  if (saved != null) return saved;
  return x.lines.filter((l) => l.level === "ITEM").reduce((a, l) => a + ((approved ? apprAmountOf(x.kind, l) : siteAmountOf(x.kind, l)) ?? 0), 0);
};

// nút "Cần làm": việc phải làm = nền xanh; đang chờ người khác ("Chờ ...") = viền xám
const todoBtn = (href: string, label: string) => (
  <Link
    href={href}
    className={`inline-block whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${label.startsWith("Chờ ") ? "bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50" : "bg-sky-700 text-white hover:bg-sky-800"}`}
  >
    {label} →
  </Link>
);

export function priceTable(rows: PriceRow[], o: { todo?: (s: PriceRow) => string; inContract?: boolean; delForm?: string } = {}) {
  const { todo, inContract = false, delForm = "" } = o;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            {delForm && <th className={`${th} w-8`} />}
            <th className={th}>Số</th>
            {todo && <th className={th}>Cần làm</th>}
            <th className={th}>Công trình / Hạng mục / Đợt</th>
            <th className={th}>Người trình</th>
            <th className={th}>Loại</th>
            <th className={`${th} text-right`}>Giá trị đề xuất</th>
            <th className={`${th} text-right`}>Giá trị duyệt</th>
            <th className={th}>Trưởng phòng</th>
            <th className={th}>Trạng thái</th>
            <th className={th}>Mail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const prop = priceValueOf(s, false);
            const appr = priceValueOf(s, true);
            const reviewed = s.status === "APPROVED" || s.status === "REJECTED";
            return (
              <tr key={s.id} className="border-t border-slate-100">
                {delForm && (
                  <td className={td}>
                    <input type="checkbox" form={delForm} value={s.id} aria-label={`Chọn xoá ${s.code}`} />
                  </td>
                )}
                <td className={td}>
                  <Link href={`/gia-doi/${s.id}`} className="font-medium text-sky-700 hover:underline">
                    {s.code}
                  </Link>
                  <span className="block text-xs text-slate-400">{fmtDate(s.createdAt)}</span>
                </td>
                {todo && <td className={td}>{todoBtn(`/gia-doi/${s.id}`, todo(s))}</td>}
                <td className={td}>
                  <span className="font-medium text-slate-800">{s.projectName || <i className="text-amber-700">chưa có tên công trình</i>}</span>
                  <SiteTag site={s.site} />
                  <span className="block text-xs text-slate-500">{[s.itemName, s.batch && `Đợt ${s.batch}${s.batchDate ? ` (${s.batchDate})` : ""}`, `Lần ${s.revision}`, s.crewName && `Đội: ${s.crewName}`].filter(Boolean).join(" · ")}</span>
                  {!inContract && <span className={`block text-xs ${s.contract ? "text-violet-700" : "text-amber-700"}`}>{s.contract ? `HĐ: ${s.contract.name}${s.contract.contractNo ? ` (${s.contract.contractNo})` : ""}` : s.dtcpLater ? "⏳ chưa có DT-CP — bổ sung sau" : "chưa gắn hợp đồng"}</span>}
                  <span className="block text-xs text-slate-400">{s.fileName}</span>
                </td>
                <td className={`${td} text-xs`}>
                  {s.createdByName}
                  {s.submittedAt && <span className="block text-slate-500">{fmtDate(s.submittedAt)}</span>}
                </td>
                <td className={`${td} text-xs`}>{KIND_LABEL[s.kind]}</td>
                <td className={`${td} text-right`}>{fmtMoney(prop)}</td>
                <td className={`${td} text-right font-medium`}>{reviewed ? fmtMoney(appr) : ""}</td>
                <td className={`${td} text-xs`}>
                  {categoryLabel(s.category)}
                  {s.reviewedByName && <span className="block text-slate-500">{s.reviewedByName} · {fmtDate(s.reviewedAt)}</span>}
                </td>
                <td className={td}>
                  <Badge map={PRICE_STATUS} status={s.status} />
                  {s.imported && <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200">hồ sơ cũ</span>}
                </td>
                <td className={`${td} text-xs`}>{s.mailSentAt ? <span className="text-emerald-700">✓ {fmtDate(s.mailSentAt)}</span> : reviewed ? <span className="text-amber-700">chưa soạn mail</span> : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- HỒ SƠ THẦU PHỤ ----------
const SUB_OPEN = { OR: [{ status: { notIn: ["APPROVED", "REJECTED"] } }, { status: "REJECTED" }, { status: "APPROVED", OR: [{ hdNo: "" }, { mailSentAt: null }, { ptgAt: null }] }] };
export function loadSubRows(u: PriceUser, open = false) {
  return prisma.subProposal.findMany({
    where: open ? { AND: [subAreaWhere(u), SUB_OPEN] } : subAreaWhere(u),
    orderBy: { createdAt: "desc" },
    select: {
      id: true, code: true, projectName: true, itemName: true, subName: true, selectedBidder: true, category: true, branch: true, status: true, revision: true, parentId: true,
      prelim: true, vat: true, extraRows: true, vatRows: true, totalAmounts: true, tpByName: true, ptgByName: true, ptgAt: true, effectiveAt: true, hdNo: true, mailSentAt: true, createdAt: true, createdById: true, createdByName: true, fileName: true, area: true, cdtContract: true,
      contract: { select: { id: true, name: true, contractNo: true, appendixNo: true, packageName: true, area: true } },
      site: { select: { id: true, code: true, name: true, status: true, area: true, cluster: true, clusterName: true } }, // DANH MỤC DỰ ÁN
      lines: { orderBy: { orderIndex: "asc" }, select: { level: true, noMgmt: true, cdtQty: true, cdtPrice: true, baseQty: true, basePrice: true, bids: true, propQty: true, propPrice: true, tpPrice: true, tpOk: true } },
    },
  });
}
export type SubRow = Awaited<ReturnType<typeof loadSubRows>>[number];

// GIÁ TRỊ DUYỆT = giá trị SAU THUẾ: TỔNG CỘNG duyệt + chi phí thêm + Prelim + VAT (+ thuế bổ sung)
export const subValueOf = (p: SubRow) => {
  const skip = noMgmtFlags(p.lines);
  let sum = 0;
  let noPrelim = 0;
  p.lines.forEach((l, i) => {
    if (l.level !== "ITEM") return;
    const a = amt(propQtyOf(toNums(l), p.selectedBidder), apprPriceOf(toNums(l), p.selectedBidder)) ?? 0;
    sum += a;
    if (skip[i]) noPrelim += a;
  });
  const prelim = parseJson<Record<string, number>>(p.prelim, {});
  const vat = parseJson<Record<string, number>>(p.vat, {});
  // dòng tổng có công thức (làm tròn...) → số đã lưu lúc duyệt
  return withSaved(totalsOf(sum, prelim.D ?? 0, vat.D ?? 0, extraSum(parseExtras(p.extraRows), "D"), parseVatRows(p.vatRows), "D", noPrelim), (({ R, D }) => R ?? D)(parseSavedTotals(p.totalAmounts))).afterVat; // chưa duyệt: số đề xuất đã lưu
};

export function subTable(rows: SubRow[], o: { todo?: (p: SubRow) => string } = {}) {
  const { todo } = o;
  const now = Date.now();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className={th}>Số</th>
            {todo && <th className={th}>Cần làm</th>}
            <th className={th}>Công trình / Hạng mục / Thầu phụ</th>
            <th className={th}>Nhánh</th>
            <th className={`${th} text-right`}>Giá trị duyệt</th>
            <th className={th}>Trưởng phòng</th>
            <th className={th}>Trạng thái</th>
            <th className={th}>HĐ/PLHĐ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const value = subValueOf(p);
            const waiting = p.status === "APPROVED" && p.effectiveAt && p.effectiveAt.getTime() > now;
            return (
              <tr key={p.id} className="border-t border-slate-100">
                <td className={td}>
                  <Link href={`/gia-doi/thau-phu/${p.id}`} className="font-medium text-sky-700 hover:underline">
                    {p.code}
                  </Link>
                  <span className="block text-xs text-slate-400">
                    {fmtDate(p.createdAt)} · lần {p.revision || "?"}
                  </span>
                </td>
                {todo && <td className={td}>{todoBtn(`/gia-doi/thau-phu/${p.id}`, todo(p))}</td>}
                <td className={td}>
                  <span className="font-medium text-slate-800">{p.projectName || <i className="text-amber-700">chưa có tên công trình</i>}</span>
                  <SiteTag site={p.site} />
                  <span className="block text-xs text-slate-500">{[p.itemName, p.subName && `Thầu phụ: ${p.subName}`].filter(Boolean).join(" · ")}</span>
                  <span className={`block text-xs ${p.contract ? "text-violet-700" : "text-amber-700"}`}>{p.contract ? `HĐ: ${p.contract.name}${p.contract.contractNo ? ` (${p.contract.contractNo})` : ""}` : "chưa gắn hợp đồng"}</span>
                </td>
                <td className={`${td} text-xs`}>{p.branch ? BRANCH_LABEL[p.branch].split(" · ")[0] : ""}</td>
                <td className={`${td} text-right`}>{fmtMoney(value)}</td>
                <td className={`${td} text-xs`}>
                  {categoryLabel(p.category)}
                  {p.tpByName && <span className="block text-slate-500">{p.tpByName}</span>}
                  {p.ptgByName && <span className="block text-slate-500">PTG: {p.ptgByName}</span>}
                </td>
                <td className={td}>
                  <Badge map={SUB_STATUS} status={p.status} />
                  {waiting && <span className="mt-0.5 block text-xs text-amber-700">hiệu lực từ {p.effectiveAt!.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</span>}
                </td>
                <td className={`${td} text-xs`}>{p.hdNo ? <span className="text-emerald-700">✓ {p.hdNo}</span> : p.status === "APPROVED" ? <span className="text-amber-700">chưa lên</span> : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- KHUNG "VIỆC CỦA TÔI" ----------
type Part = { title: string; n: number; body: React.ReactNode };
const badge = (n: number, strong = true) => (
  <span className={`rounded-full px-2 text-xs font-semibold ${n ? (strong ? "bg-red-600 text-white" : "bg-sky-100 text-sky-800") : "bg-slate-200 text-slate-600"}`}>{n}</span>
);
const block = (title: string, cls: string, parts: Part[], empty: string, strong = true) => {
  const n = parts.reduce((a, p) => a + p.n, 0);
  return (
    <div key={title} className={`rounded-lg border border-slate-200 border-l-4 bg-white ${cls}`}>
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {badge(n, strong)}
      </div>
      <div className="space-y-3 p-3">
        {!n ? (
          <Empty>{empty}</Empty>
        ) : (
          parts.map((p) =>
            p.title ? (
              <div key={p.title} className="space-y-1">
                <div className="flex items-center gap-2 px-1 text-sm font-semibold text-slate-700">
                  {p.title} {badge(p.n, strong)}
                </div>
                {p.n ? p.body : <p className="px-1 pb-1 text-xs text-slate-400">Không có hồ sơ.</p>}
              </div>
            ) : (
              <div key="_">{p.body}</div>
            ),
          )
        )}
      </div>
    </div>
  );
};
const pPart = (title: string, rows: PriceRow[], todo: (s: PriceRow) => string): Part => ({ title, n: rows.length, body: rows.length ? priceTable(rows, { todo }) : null });
const sPart = (title: string, rows: SubRow[], todo: (p: SubRow) => string): Part => ({ title, n: rows.length, body: rows.length ? subTable(rows, { todo }) : null });

// mode: trang Trình giá đội chỉ hiện việc giá đội, trang Trình giá thầu phụ chỉ hiện việc thầu phụ (anh chốt 25/11/2026 — bỏ chia I/II)
// price / sub: danh sách trang đang có sẵn (đỡ nạp lại); thiếu thì tự nạp các hồ sơ còn việc
export default async function MyWork({ pu, mode, price, sub }: { pu: PriceUser; mode: "price" | "sub"; price?: PriceRow[]; sub?: SubRow[] }) {
  const su = asSub(pu);
  const pr = priceTaskWhere(pu); // vai trò ở giá đội
  const sr = priceTaskWhere(su); // vai trò ở thầu phụ
  const ptg = su.roles.has("PTG");
  const dt = su.roles.has("QSDT");
  const seeP = mode === "price" && canSeePrice(pu) && (pr.qs || pr.myCats.length > 0);
  const seeS = mode === "sub" && canSeeSub(pu) && (sr.qs || sr.myCats.length > 0 || ptg || dt);
  const [ps, ss, parentRows] = await Promise.all([
    seeP ? (price ?? loadPriceRows(pu, true)) : [],
    seeS ? (sub ?? loadSubRows(su, true)) : [],
    seeS ? prisma.subProposal.findMany({ where: { parentId: { not: null } }, select: { parentId: true } }) : [],
  ]);
  const parents = new Set(parentRows.map((p) => p.parentId));
  const sx = (p: SubRow) => ({ ...p, superseded: parents.has(p.id) });
  const uid = pu.id;
  const own = (s: PriceRow) => s.createdById === uid;
  // việc thầu phụ theo TỪNG vai trò (không trộn)
  const qsTodo = (p: SubRow) => subTodoOf(sx(p), { qs: true, ptg: false, cats: [], uid });
  const ptgTodo = (p: SubRow) => subTodoOf(sx(p), { qs: false, ptg: true, cats: [], uid });
  const dtTodo = (p: SubRow) => {
    const t = subTodoOf(sx(p), { qs: false, ptg: false, cats: [], dt: true, uid });
    return t === SUB_TODO_DT_WAIT_MAIL ? "" : t; // nhắc thụ động "chưa gửi mail" đã nằm ở nhóm theo dõi C
  };
  const priceTodo = (s: PriceRow): string => {
    if (s.status === "SUBMITTED" && pr.myCats.includes(s.category)) return "Duyệt hồ sơ";
    if (!own(s)) return "";
    if (s.status === "SUBMITTED") return "Chờ Trưởng phòng duyệt";
    if (s.status === "DRAFT") return "Kiểm tra & trình Trưởng phòng";
    if ((s.status === "APPROVED" || s.status === "REJECTED") && !s.mailSentAt) return "Soạn mail gửi kết quả";
    if (s.status === "APPROVED" && s.dtcpLater && !s.contractId) return "Bổ sung DT-CP (hợp đồng)";
    return "";
  };

  const groups: { role: string; nodes: React.ReactNode[] }[] = [];
  let todoN = 0; // số việc PHẢI LÀM (không tính hồ sơ đang chờ người khác)

  // ===== QSTT =====
  const qsP = seeP && pr.qs;
  const qsS = seeS && sr.qs;
  if (qsP || qsS) {
    const aI = qsP ? ps.filter((s) => own(s) && (s.status === "APPROVED" || s.status === "REJECTED") && !s.mailSentAt) : [];
    const aII = qsS ? ss.filter((p) => p.status === "APPROVED" && qsTodo(p)) : [];
    const b = qsS ? ss.filter((p) => p.status === "PTG_PENDING") : [];
    const cI = qsP ? ps.filter((s) => own(s) && s.status === "SUBMITTED") : [];
    const cII = qsS ? ss.filter((p) => p.status === "SUBMITTED") : [];
    const dI = qsP ? ps.filter((s) => own(s) && !aI.includes(s) && (s.status === "DRAFT" || (s.status === "APPROVED" && s.dtcpLater && !s.contractId))) : [];
    const dII = qsS ? ss.filter((p) => p.status !== "APPROVED" && qsTodo(p)) : [];
    // mỗi trang chỉ 1 loại hồ sơ → mỗi mục 1 bảng (không chia I/II)
    const one = (P: Part | null, S: Part | null) => [P ?? S].filter((x): x is Part => !!x);
    const waitTp = () => "Chờ Trưởng phòng duyệt";
    todoN += aI.length + aII.length + dI.length + dII.length;
    // giá đội: B = chờ Trưởng phòng (không có bước Phó Tổng); thầu phụ: B = chờ Phó Tổng, C = chờ Trưởng phòng
    const nodes = [
      block("A. Hồ sơ đã duyệt, chưa phát hành", "border-l-emerald-500", one(qsP ? pPart("", aI, priceTodo) : null, qsS ? sPart("", aII, qsTodo) : null), "Không có hồ sơ nào cần phát hành 👍"),
      ...(qsS ? [block("B. Hồ sơ đã trình, chờ Phó Tổng duyệt", "border-l-orange-500", [sPart("", b, () => "Chờ Phó Tổng phê duyệt")], "Không có hồ sơ thầu phụ nào đang chờ Phó Tổng duyệt", false)] : []),
      block(`${qsS ? "C" : "B"}. Hồ sơ đã trình, chờ Trưởng phòng duyệt`, "border-l-sky-500", one(qsP ? pPart("", cI, waitTp) : null, qsS ? sPart("", cII, waitTp) : null), "Không có hồ sơ nào đang chờ Trưởng phòng duyệt", false),
    ];
    if (dI.length + dII.length) nodes.push(block(`${qsS ? "D" : "C"}. Việc khác (${qsS ? "kiểm tra & trình, bổ sung, trình lại" : "hồ sơ nháp cần trình, cần bổ sung DT-CP"})`, "border-l-amber-500", one(qsP ? pPart("", dI, priceTodo) : null, qsS ? sPart("", dII, qsTodo) : null), ""));
    groups.push({ role: "QSTT", nodes });
  }

  // ===== TRƯỞNG PHÒNG =====
  const tpP = seeP && pr.myCats.length > 0;
  const tpS = seeS && sr.myCats.length > 0;
  if (tpP || tpS) {
    const nodes: React.ReactNode[] = [];
    if (tpP) {
      const rows = ps.filter((s) => s.status === "SUBMITTED" && pr.myCats.includes(s.category));
      todoN += rows.length;
      nodes.push(block("Hồ sơ giá đội chờ Trưởng phòng duyệt", "border-l-sky-500", [pPart("", rows, () => "Duyệt hồ sơ")], "Không có hồ sơ giá đội nào chờ bạn duyệt 👍"));
    }
    if (tpS) {
      const isB = (p: SubRow) => p.branch === "B" || p.status === "PTG_PENDING";
      const mineCat = (p: SubRow) => sr.myCats.includes(p.category);
      // nhánh B: còn nằm ở việc của Trưởng phòng đến khi Phó Tổng duyệt
      const nB = ss.filter((p) => mineCat(p) && ((p.status === "SUBMITTED" && isB(p)) || p.status === "PTG_PENDING"));
      const nA = ss.filter((p) => mineCat(p) && p.status === "SUBMITTED" && !isB(p));
      todoN += nB.filter((p) => p.status === "SUBMITTED").length + nA.length;
      nodes.push(
        block(
          "Hồ sơ thầu phụ chờ Trưởng phòng duyệt",
          "border-l-violet-500",
          [
            sPart("1. Nhánh B — Phó Tổng phê duyệt (còn ở đây đến khi Phó Tổng duyệt)", nB, (p) => (p.status === "SUBMITTED" ? "Trưởng phòng duyệt" : "Chờ Phó Tổng phê duyệt")),
            sPart("2. Nhánh A — Trưởng phòng duyệt", nA, () => "Trưởng phòng duyệt"),
          ],
          "Không có hồ sơ thầu phụ nào chờ bạn duyệt 👍",
        ),
      );
    }
    groups.push({ role: "Trưởng phòng", nodes });
  }

  // ===== PHÓ TỔNG =====
  if (seeS && ptg) {
    const rows = ss.filter((p) => ptgTodo(p));
    todoN += rows.length;
    groups.push({ role: "Phó Tổng", nodes: [block("Hồ sơ thầu phụ chờ Phó Tổng phê duyệt / xem để nắm", "border-l-orange-500", [sPart("", rows, ptgTodo)], "Không có hồ sơ thầu phụ nào chờ bạn 👍")] });
  }

  // ===== QSĐT (giữ như cũ) =====
  if (seeS && dt) {
    const mine = ss.filter((p) => dtTodo(p));
    const track = (p: SubRow) => (dtTodo(p) ? "" : subTrackOf(sx(p), { dt: true, uid }));
    const tracks = (["A", "B", "C"] as const).map((k) => ({ k, label: SUB_TRACK_LABEL[k], rows: ss.filter((p) => track(p) === k) }));
    const trackN = tracks.reduce((a, t) => a + t.rows.length, 0);
    todoN += mine.length;
    groups.push({
      role: "QSĐT",
      nodes: [
        <div key="dt" className="space-y-4">
          {mine.length ? subTable(mine, { todo: dtTodo }) : !trackN ? <Empty>Không có hồ sơ thầu phụ nào đang chờ bạn 👍</Empty> : null}
          {trackN > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">Hồ sơ tôi đã trình — đang theo dõi</h3>
              {tracks.map((t) => (
                <details key={t.k} open={t.rows.length > 0} className="group rounded-md border border-slate-200 bg-white">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 hover:bg-slate-50">
                    <span className="text-slate-400 transition group-open:rotate-90">▶</span>
                    <span className="flex-1 font-medium text-slate-800">{t.label}</span>
                    <span className={`rounded-full px-2 text-xs font-semibold ${t.rows.length ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-500"}`}>{t.rows.length}</span>
                  </summary>
                  <div className="border-t border-slate-100 px-2 pb-2">{t.rows.length ? subTable(t.rows, {}) : <Empty>Không có hồ sơ.</Empty>}</div>
                </details>
              ))}
            </div>
          )}
        </div>,
      ],
    });
  }

  return (
    <section className={`rounded-lg border-2 ${todoN ? "border-amber-300 bg-amber-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="font-semibold text-slate-900">🔔 Việc của tôi</h2>
        {todoN > 0 && <span className="rounded-full bg-red-600 px-2 text-xs font-semibold text-white">{todoN}</span>}
      </div>
      <div className="space-y-4 p-4">
        {!groups.length ? (
          <Empty>Không có việc nào đang chờ bạn 👍</Empty>
        ) : (
          groups.map((g) => (
            <div key={g.role} className="space-y-3">
              {groups.length > 1 && <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Vai trò {g.role}</h3>}
              {g.nodes}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
