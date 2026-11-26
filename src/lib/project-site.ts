import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import type { PriceUser } from "@/lib/gia-doi";
import { contractKey, nameKey, normName, parseAliases, similarSites, siteByName, splitContractLine, type SiteOpt } from "@/lib/project-site-calc";
import { SUB_STATUS } from "@/lib/thau-phu-calc";
import { PRICE_STATUS } from "@/lib/gia-doi-calc";
import { DTCP_STATUS } from "@/lib/dtcp-approval";

export * from "@/lib/project-site-calc";

// DANH MỤC DỰ ÁN (server): nạp danh mục, gắn tên cũ, đổi tên / gộp dự án, nhập từ file Excel "BẢNG TT DỰ ÁN".
// Nguyên tắc: bản ghi nào có siteId thì TÊN DỰ ÁN trên bản ghi đó = tên chuẩn của dự án (syncSite) → mọi cây / danh sách
// đang gom theo tên tự gom đúng, không phải sửa từng chỗ.

// quản lý danh mục (xác nhận dự án mới, sửa mã / tên, gộp): quản trị hoặc QSTT (tổ đội hoặc thầu phụ)
export const canManageSites = (u: PriceUser | null) => !!u && (u.isAdmin || u.roles.has("QSTT") || u.sub.has("QSTT"));

export const toSiteOpt = (s: { id: string; code: string; name: string; area: string; status: string; aliases: string; cluster?: string; clusterName?: string }): SiteOpt => ({
  id: s.id,
  code: s.code,
  name: s.name,
  area: s.area,
  status: s.status,
  aliases: parseAliases(s.aliases),
  cluster: s.cluster ?? "",
  clusterName: s.clusterName ?? "",
});

export async function loadSites(): Promise<SiteOpt[]> {
  const rows = await prisma.projectSite.findMany({ orderBy: [{ area: "asc" }, { cluster: "asc" }, { code: "asc" }, { name: "asc" }] });
  return rows.map(toSiteOpt);
}

export async function siteOf(id: string | null | undefined) {
  return id ? prisma.projectSite.findUnique({ where: { id } }) : null;
}

// ghi tên chuẩn (và mã) của dự án lên mọi bản ghi đã gắn; hồ sơ có hợp đồng thì theo dự án của hợp đồng
export async function syncSite(siteId: string) {
  const s = await prisma.projectSite.findUnique({ where: { id: siteId } });
  if (!s) return;
  const code = s.code ? { projectCode: s.code } : {};
  await prisma.$transaction([
    prisma.costContract.updateMany({ where: { siteId }, data: { name: s.name } }),
    prisma.project.updateMany({ where: { siteId }, data: { name: s.name } }),
    prisma.subProposal.updateMany({ where: { contract: { is: { siteId } } }, data: { siteId } }),
    prisma.priceSubmission.updateMany({ where: { contract: { is: { siteId } } }, data: { siteId } }),
    prisma.subProposal.updateMany({ where: { siteId }, data: { projectName: s.name, ...code } }),
    prisma.priceSubmission.updateMany({ where: { siteId }, data: { projectName: s.name, ...code } }),
  ]);
}

// thêm tên gọi khác (bỏ trùng, bỏ tên trùng tên chuẩn)
export function mergeAliases(name: string, ...lists: string[][]): string[] {
  const seen = new Set([nameKey(name)]);
  const out: string[] = [];
  for (const n of lists.flat()) {
    const k = nameKey(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n.trim());
  }
  return out;
}

export async function addAliases(siteId: string, names: string[]) {
  const s = await prisma.projectSite.findUnique({ where: { id: siteId } });
  if (!s) return;
  const next = mergeAliases(s.name, parseAliases(s.aliases), names);
  await prisma.projectSite.update({ where: { id: siteId }, data: { aliases: JSON.stringify(next) } });
}

// gộp các dự án sources vào target: mọi bản ghi chuyển sang target, tên của dự án bị gộp thành tên gọi khác của target
export async function mergeSites(targetId: string, sourceIds: string[]) {
  const ids = sourceIds.filter((x) => x && x !== targetId);
  const [t, srcs] = await Promise.all([prisma.projectSite.findUnique({ where: { id: targetId } }), prisma.projectSite.findMany({ where: { id: { in: ids } } })]);
  if (!t) throw new Error("Không tìm thấy dự án gộp vào");
  const aliases = mergeAliases(t.name, parseAliases(t.aliases), ...srcs.map((s) => [s.name, ...parseAliases(s.aliases)]));
  const src = srcs.map((s) => s.id);
  await prisma.$transaction([
    prisma.project.updateMany({ where: { siteId: { in: src } }, data: { siteId: targetId } }),
    prisma.costContract.updateMany({ where: { siteId: { in: src } }, data: { siteId: targetId } }),
    prisma.priceSubmission.updateMany({ where: { siteId: { in: src } }, data: { siteId: targetId } }),
    prisma.subProposal.updateMany({ where: { siteId: { in: src } }, data: { siteId: targetId } }),
    prisma.siteContract.updateMany({ where: { siteId: { in: src } }, data: { siteId: targetId } }), // hợp đồng theo bảng đi theo
    prisma.projectSite.update({ where: { id: targetId }, data: { aliases: JSON.stringify(aliases), ...(!t.code ? { code: srcs.find((s) => s.code)?.code ?? "" } : {}), ...(!t.area ? { area: srcs.find((s) => s.area)?.area ?? "" } : {}) } }),
    prisma.projectSite.deleteMany({ where: { id: { in: src } } }),
  ]);
  await syncSite(targetId);
}

// ===== TÊN DỰ ÁN CŨ CHƯA GẮN DANH MỤC (gom theo tên GIỮ DẤU — Hùng ≠ Hưng) =====
// items: từng hồ sơ / hợp đồng / DT-CP mang tên đó (để mở xem nội dung trước khi gắn mã)
export type LooseItem = { kind: "dtcp" | "contract" | "price" | "sub"; id: string; href: string; title: string; detail: string; status: string; at: string };
export type LooseGroup = {
  key: string; // nameKey
  names: string[]; // các cách viết gặp
  area: string;
  counts: { dtcp: number; contract: number; price: number; sub: number };
  suggest: { id: string; label: string; score: number }[];
  items: LooseItem[];
};

const vnDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "");
const join = (...xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(" · ");

async function looseRecords() {
  const [contracts, projects, subs, prices] = await Promise.all([
    prisma.costContract.findMany({ where: { siteId: null }, select: { id: true, name: true, area: true, contractNo: true, appendixNo: true, packageName: true, source: true, fileName: true, importedAt: true } }),
    // DT-CP đang lập để đấu thầu (chưa trình) chưa cần gắn dự án
    prisma.project.findMany({ where: { siteId: null, dtcpStatus: { not: "DRAFT" } }, select: { id: true, name: true, area: true, packageName: true, contractNo: true, dtcpStatus: true, updatedAt: true } }),
    prisma.subProposal.findMany({
      where: { siteId: null, contractId: null, projectName: { not: "" } },
      select: { id: true, code: true, projectName: true, area: true, itemName: true, subName: true, cdtContract: true, hdNo: true, status: true, createdByName: true, createdAt: true, fileName: true },
    }),
    prisma.priceSubmission.findMany({
      where: { siteId: null, contractId: null, projectName: { not: "" } },
      select: { id: true, code: true, projectName: true, itemName: true, crewName: true, contractNo: true, batch: true, status: true, createdByName: true, createdAt: true, fileName: true },
    }),
  ]);
  type Rec = { name: string; area: string } & LooseItem;
  const out: Rec[] = [
    ...contracts.map((x): Rec => ({ kind: "contract", id: x.id, name: x.name, area: x.area, href: `/gia-doi/hop-dong/${x.id}`, title: `Hợp đồng ${x.contractNo || "(chưa có số)"}${x.appendixNo ? ` — ${x.appendixNo}` : ""}`, detail: join(x.packageName, x.source === "APP" ? "DT-CP phần mềm" : x.fileName && `File: ${x.fileName}`), status: "", at: vnDate(x.importedAt) })),
    ...projects.map((x): Rec => ({ kind: "dtcp", id: x.id, name: x.name, area: x.area, href: `/projects/${x.id}`, title: `DT-CP ${x.packageName || "(chưa đặt tên gói thầu)"}`, detail: join(x.contractNo && `HĐ ${x.contractNo}`), status: DTCP_STATUS[x.dtcpStatus]?.label ?? x.dtcpStatus, at: vnDate(x.updatedAt) })),
    ...subs.map((x): Rec => ({ kind: "sub", id: x.id, name: x.projectName, area: x.area, href: `/gia-doi/thau-phu/${x.id}`, title: `${x.code} — thầu phụ`, detail: join(x.itemName, x.subName && `Thầu phụ: ${x.subName}`, x.cdtContract && `HĐ CĐT: ${x.cdtContract}`, x.hdNo && `HĐTP: ${x.hdNo}`, x.createdByName && `Người lập: ${x.createdByName}`, x.fileName && `File: ${x.fileName}`), status: SUB_STATUS[x.status]?.label ?? x.status, at: vnDate(x.createdAt) })),
    ...prices.map((x): Rec => ({ kind: "price", id: x.id, name: x.projectName, area: "", href: `/gia-doi/${x.id}`, title: `${x.code} — giá đội`, detail: join(x.itemName, x.crewName && `Đội: ${x.crewName}`, x.batch && `Đợt ${x.batch}`, x.contractNo && `HĐ CĐT: ${x.contractNo}`, x.createdByName && `QSTT: ${x.createdByName}`, x.fileName && `File: ${x.fileName}`), status: PRICE_STATUS[x.status]?.label ?? x.status, at: vnDate(x.createdAt) })),
  ];
  return out.filter((r) => nameKey(r.name));
}

export async function looseGroups(sites: SiteOpt[]): Promise<LooseGroup[]> {
  const map = new Map<string, LooseGroup>();
  for (const r of await looseRecords()) {
    const key = nameKey(r.name);
    const g: LooseGroup = map.get(key) ?? { key, names: [], area: "", counts: { dtcp: 0, contract: 0, price: 0, sub: 0 }, suggest: [], items: [] };
    if (!g.names.includes(r.name.trim())) g.names.push(r.name.trim());
    if (!g.area && r.area) g.area = r.area;
    g.counts[r.kind]++;
    g.items.push({ kind: r.kind, id: r.id, href: r.href, title: r.title, detail: r.detail, status: r.status, at: r.at });
    map.set(key, g);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    const exact = siteByName(g.names[0], sites);
    g.suggest = (exact ? [{ site: exact, score: 1 }] : similarSites(g.names[0], sites, g.area, 3, 0.4)).map((x) => ({ id: x.site.id, label: `${x.site.code ? `${x.site.code} · ` : ""}${x.site.name}`, score: Math.round(x.score * 100) }));
  }
  return groups.sort((a, b) => (b.suggest[0]?.score ?? 0) - (a.suggest[0]?.score ?? 0) || a.key.localeCompare(b.key));
}

// gắn mọi bản ghi mang tên (khoá giữ dấu) = key vào dự án siteId; ids: chỉ gắn các bản ghi được chọn (trống = cả nhóm); tên cũ thành tên gọi khác
export async function linkLooseGroup(key: string, siteId: string, only?: string[]) {
  const recs = (await looseRecords()).filter((r) => nameKey(r.name) === key && (!only?.length || only.includes(r.id)));
  if (!recs.length) return 0;
  const ids = (k: string) => recs.filter((r) => r.kind === k).map((r) => r.id);
  await prisma.$transaction([
    prisma.costContract.updateMany({ where: { id: { in: ids("contract") } }, data: { siteId } }),
    prisma.project.updateMany({ where: { id: { in: ids("dtcp") } }, data: { siteId } }),
    prisma.subProposal.updateMany({ where: { id: { in: ids("sub") } }, data: { siteId } }),
    prisma.priceSubmission.updateMany({ where: { id: { in: ids("price") } }, data: { siteId } }),
  ]);
  // gắn MỘT PHẦN (tên chung chung, các hồ sơ thuộc nhiều dự án): KHÔNG lấy tên này làm tên gọi khác, tránh file sau tự nhận nhầm
  if (!only?.length) await addAliases(siteId, [...new Set(recs.map((r) => r.name.trim()))]);
  await syncSite(siteId);
  return recs.length;
}

// gắn 1 bản ghi vào dự án (dùng khi QSĐT / QSTT chọn dự án trên hồ sơ, DT-CP): trả về tên / mã chuẩn để ghi lên bản ghi
export async function pickSite(siteId: string | null | undefined) {
  if (!siteId) return null;
  const s = await prisma.projectSite.findUnique({ where: { id: siteId } });
  if (!s) throw new Error("Không tìm thấy dự án trong Danh mục dự án — tải lại trang rồi chọn lại");
  return s;
}

// DỰ ÁN GHI LÊN HỒ SƠ khi lưu: hợp đồng đã gắn dự án thì theo hợp đồng; hợp đồng chưa gắn mà người dùng chọn dự án → gắn luôn hợp đồng.
// siteId === undefined (nơi gọi không gửi) → không đổi gì. Trả về các trường cần ghi: { siteId, projectName, projectCode }
export async function siteFields(siteId: string | null | undefined, contractId: string | null | undefined, fallback: { projectName: string; projectCode: string }) {
  if (siteId === undefined) return {};
  let id = siteId || null;
  if (contractId) {
    const c = await prisma.costContract.findUnique({ where: { id: contractId }, select: { siteId: true } });
    if (c?.siteId) id = c.siteId;
    else if (c && id && (await prisma.projectSite.findUnique({ where: { id } }))) {
      await prisma.costContract.update({ where: { id: contractId }, data: { siteId: id } });
      await syncSite(id);
    }
  }
  const s = await pickSite(id);
  return s ? { siteId: s.id, projectName: s.name, projectCode: s.code || fallback.projectCode } : { siteId: null, ...fallback };
}

// tên công trình đọc từ file Excel trùng tên / tên gọi khác của 1 dự án → chọn sẵn dự án đó (tên / mã theo chuẩn)
export function siteFromName(name: string | null | undefined, sites: SiteOpt[]) {
  const s = siteByName(name ?? "", sites);
  return s ? { siteId: s.id, projectName: s.name, ...(s.code ? { projectCode: s.code } : {}) } : {};
}

export const SITE_MISSING = "Chưa chọn DỰ ÁN trong Danh mục dự án (gõ mã / tên để chọn; chưa có thì bấm “Đề nghị dự án mới”)";

// MÃ HỢP ĐỒNG theo BẢNG TT DỰ ÁN, tra bằng số HĐ: contractKey(số HĐ) → mã (VD "324/2026/PCC" → "KV4-SB-02.04") — để danh sách hồ sơ hiện mã hợp đồng
export async function loadContractCodes(): Promise<Map<string, string>> {
  return new Map([...(await loadContractInfo())].map(([k, v]) => [k, v.code]));
}
// mã + nội dung hợp đồng theo BẢNG TT DỰ ÁN, tra bằng số HĐ
export async function loadContractInfo(): Promise<Map<string, { code: string; title: string }>> {
  const rows = await prisma.siteContract.findMany({ where: { noKey: { not: "" }, code: { not: "" } }, select: { noKey: true, code: true, title: true }, orderBy: { code: "asc" } });
  const m = new Map<string, { code: string; title: string }>();
  for (const r of rows) if (!m.has(r.noKey)) m.set(r.noKey, { code: r.code, title: r.title });
  return m;
}

// ===== NHẬP TỪ FILE EXCEL "BẢNG TT DỰ ÁN" =====
// Cột: STT | ... | KÝ HIỆU DT-CP (F) | KÝ HIỆU DT-CP MỚI- CHIA KHU (G) | TÊN CÔNG TRÌNH. Mã = G, G trống thì F. Dòng "KHU VỰC I. ĐÀ NẴNG" (STT La Mã) = khu vực; dòng STT là số nguyên = DỰ ÁN;
// dòng STT "3.01" = HỢP ĐỒNG của dự án ngay trên ("HĐ số … - nội dung", mã VD KV4-SB-02.04). Mục La Mã không phải "KHU VỰC ..." (VD "CHI PHÍ TRIỂN KHAI THUÊ NGOÀI") thì bỏ qua.
// CẤP CỤM: dòng có mã cột G dạng "KV4-SB" (không có số thứ tự cuối), VD "SÂN BAY PHÚ QUỐC" = CỤM DỰ ÁN; các dự án bên dưới thuộc cụm đó
// tới dòng cụm / khu vực kế tiếp. Khu vực → Cụm (KV4-SB) → Dự án (KV4-SB-01) → Hợp đồng (KV4-SB-01.01).
export type ContractRow = { code: string; contractNo: string; title: string; category: string; company: string };
export type SiteRow = { code: string; name: string; area: string; cluster: string; clusterName: string; contracts: ContractRow[] };
const isClusterCode = (g: string) => /^KV\d+-[A-ZĐ]+$/i.test(g);

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return v.result == null ? "" : String(v.result);
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v);
};

export async function parseSiteExcel(buf: ArrayBuffer): Promise<SiteRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out: SiteRow[] = [];
  for (const ws of wb.worksheets) {
    // tìm dòng tiêu đề: có ô "TÊN CÔNG TRÌNH"
    let cName = 0, cStt = 0, cCode = 0, cOld = 0, cCompany = 0, cCat = 0;
    for (let r = 1; r <= Math.min(30, ws.rowCount) && !cName; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= Math.min(40, row.cellCount); c++) {
        const t = normName(cellText(row.getCell(c).value));
        if (t === "ten cong trinh") cName = c;
        else if (t === "stt") cStt = c;
        else if (t.startsWith("ky hieu dt cp moi")) cCode = c;
        else if (t.startsWith("ky hieu dt cp")) cOld = c;
        else if (t === "cong ty") cCompany = c;
        else if (t === "hang muc") cCat = c;
      }
    }
    if (!cName || !cStt) continue;
    let area = "";
    let cluster = { code: "", name: "" };
    let cur: SiteRow | null = null; // dự án đang đọc — các dòng hợp đồng bên dưới thuộc dự án này
    ws.eachRow((row) => {
      const stt = cellText(row.getCell(cStt).value).trim();
      const name = cellText(row.getCell(cName).value).replace(/\s+/g, " ").trim();
      // mã = cột "KÝ HIỆU DT-CP MỚI (- CHIA KHU)" nếu có, không thì cột "KÝ HIỆU DT-CP" (cột cuối cùng mang tên đó)
      const g = cCode ? cellText(row.getCell(cCode).value).trim() : "";
      const f = cOld ? cellText(row.getCell(cOld).value).trim() : "";
      if (/^[IVX]+$/.test(stt)) {
        const m = /^KHU VỰC\s+([IVX]+)\b/i.exec(name);
        area = m && ROMAN[m[1].toUpperCase()] ? String(ROMAN[m[1].toUpperCase()]) : "";
        cluster = { code: "", name: "" };
        cur = null;
        return;
      }
      // dòng HỢP ĐỒNG của dự án ngay trên: STT "40.02", hoặc (dòng quên ghi STT) mã con "KV4-HT-12.04" / chữ "HĐ số …"
      const childCode = !!cur?.code && [g, f].some((x) => x.startsWith(`${cur!.code}.`));
      if (cur && name && !/^\d+$/.test(stt) && (/^\d+\.\d+$/.test(stt) || childCode || /^H[ĐD]\s*s[ốo]\b/i.test(name))) {
        const { contractNo, title } = splitContractLine(name);
        const code = /^KV/i.test(g) ? g : /^KV/i.test(f) ? f : "";
        const cell = (c: number) => (c ? cellText(row.getCell(c).value).trim() : "");
        cur.contracts.push({ code, contractNo, title, category: cell(cCat), company: cell(cCompany) });
        return;
      }
      if (!area || !/^\d+$/.test(stt) || !name) return;
      // dòng CỤM (VD "BÀ NÀ" mã KV1-BN) không phải dự án: ghi nhận cụm cho các dự án bên dưới
      if (isClusterCode(g)) {
        cluster = { code: g, name };
        cur = null;
        return;
      }
      const code = /^KV/i.test(g) ? g : f;
      cur = { code: /^KV/i.test(code) ? code : "", name, area: Number(area) <= 5 ? area : "", cluster: cluster.code, clusterName: cluster.name, contracts: [] };
      out.push(cur);
    });
  }
  return out;
}

// cập nhật danh mục theo file: khớp theo MÃ (chưa có mã thì theo tên không dấu + khu vực); đổi tên thì tên cũ thành tên gọi khác.
// File có dòng cụm thì cập nhật luôn cụm của từng dự án (file kiểu cũ không có cụm thì giữ nguyên cụm đang có).
export async function importSites(rows: SiteRow[], byName: string) {
  const all = await prisma.projectSite.findMany();
  const sites = all.map(toSiteOpt);
  const withCluster = rows.some((r) => r.cluster);
  const withContracts = rows.some((r) => r.contracts.length); // file có dòng hợp đồng → nạp lại danh mục hợp đồng của từng dự án
  let created = 0, updated = 0, contracts = 0;
  const saveContracts = async (siteId: string, list: ContractRow[]) => {
    if (!withContracts) return;
    await prisma.$transaction([
      prisma.siteContract.deleteMany({ where: { siteId } }),
      prisma.siteContract.createMany({ data: list.map((c, i) => ({ siteId, ...c, noKey: contractKey(c.contractNo), orderIndex: i })) }),
    ]);
    contracts += list.length;
  };
  const touched: string[] = [];
  for (const r of rows) {
    const hit = (r.code && sites.find((s) => s.code === r.code)) || sites.find((s) => (!s.code || !r.code) && (!s.area || s.area === r.area) && siteByName(r.name, [s]));
    const cl = withCluster ? { cluster: r.cluster, clusterName: r.clusterName } : {};
    if (hit) {
      const renamed = normName(hit.name) !== normName(r.name);
      const sameInfo = hit.code === (r.code || hit.code) && hit.area === (r.area || hit.area) && hit.name === r.name;
      const sameCluster = !withCluster || (hit.cluster === r.cluster && hit.clusterName === r.clusterName);
      await saveContracts(hit.id, r.contracts);
      if (sameInfo && sameCluster && hit.status === "ACTIVE") continue;
      const aliases = renamed ? mergeAliases(r.name, hit.aliases, [hit.name]) : hit.aliases;
      await prisma.projectSite.update({ where: { id: hit.id }, data: { name: r.name, code: r.code || hit.code, area: r.area || hit.area, ...cl, aliases: JSON.stringify(aliases), status: "ACTIVE", ...(hit.status !== "ACTIVE" ? { confirmedByName: byName } : {}) } });
      Object.assign(hit, { name: r.name, code: r.code || hit.code, area: r.area || hit.area, ...cl, aliases, status: "ACTIVE" });
      if (!sameInfo) touched.push(hit.id); // chỉ đổi cụm thì không cần ghi lại tên / mã lên hồ sơ
      updated++;
    } else {
      const s = await prisma.projectSite.create({ data: { code: r.code, name: r.name, area: r.area, ...cl, status: "ACTIVE", createdByName: byName, confirmedByName: byName } });
      sites.push(toSiteOpt(s));
      await saveContracts(s.id, r.contracts);
      created++;
    }
  }
  for (const id of touched) await syncSite(id);
  return { created, updated, total: rows.length, contracts };
}
