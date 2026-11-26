import { prisma } from "@/lib/prisma";
import { getGridLinkValues } from "@/lib/grid-links";
import { computeSheetLinks, computeProjectTotals, getGridSources } from "@/lib/sheet-links";
import { createEvaluator } from "@/lib/grid-formula";
import { applyManualFormulas } from "@/lib/field-formulas";
import { DTCP_AMOUNT_COL, dtcpExtraColIndex, dtcpLayout } from "@/lib/dtcp-layout";


type SeedNode = { name: string; unit?: string; link?: string; children?: SeedNode[] };

const DEFAULT_A: SeedNode[] = [{ name: "Hợp đồng (sau VAT)", unit: "VNĐ", link: "boq_quoted_vat" }];

const DEFAULT_B: SeedNode[] = [
  {
    name: "CHI PHÍ TRỰC TIẾP",
    children: [
      {
        name: "Vật tư chính",
        unit: "VNĐ",
        children: [
          { name: "Vật tư chính mua từ Hợp Nhân", unit: "VNĐ", link: "vts:A" },
          { name: "Vật tư chính mua từ đối tác khác", unit: "VNĐ", link: "vts:B" },
        ],
      },
      {
        name: "Vật tư phụ",
        unit: "VNĐ",
        children: [
          { name: "Vật tư phụ công trình đề xuất bộ phận kế toán mua", unit: "VNĐ" },
          { name: "Vật tư phụ công trình mua", unit: "VNĐ" },
        ],
      },
      {
        name: "Thiết bị",
        unit: "VNĐ",
        children: [
          { name: "Thiết Bị Thi Công", unit: "VNĐ", link: "tbs:A" },
          { name: "Thiết Bị Khác", unit: "VNĐ", link: "tbs:B" },
        ],
      },
      {
        name: "Thầu phụ",
        unit: "VNĐ",
        children: [
          { name: "Thầu phụ theo CHI TIẾT", unit: "VNĐ", link: "tp_boq" },
          { name: "Thầu phụ bổ sung", unit: "VNĐ" },
        ],
      },
      {
        name: "Nhân công",
        unit: "VNĐ",
        children: [
          { name: "Nhân công giao khoán", unit: "VNĐ", link: "nc" },
          {
            name: "Nhân công khác",
            unit: "VNĐ",
            children: [
              { name: "Chi phí công nhật & nhân công tiện ích" },
              { name: "Chi phí nhân công vận chuyển, sắp xếp thiết bị" },
              { name: "Chi phí dự trù trượt giá nhân công 5%" },
              { name: "Chi phí hỗ trợ đội thi công/công nhân" },
            ],
          },
        ],
      },
      {
        name: "Chi phí tổ chức thi công",
        unit: "VNĐ",
        children: [
          { name: "Văn phòng, kho bãi (tính chi phí vận hành)", unit: "VNĐ" },
          { name: "Chi phí điện nước thi công", unit: "VNĐ" },
          { name: "Chi phí an toàn, an ninh, vệ sinh công trường", unit: "VNĐ" },
        ],
      },
    ],
  },
];

async function seedNodes(projectId: string, section: "A" | "B", nodes: SeedNode[], parentId: string | null) {
  let i = 0;
  for (const n of nodes) {
    const row = await prisma.dtcpLine.create({
      data: { projectId, section, parentId, name: n.name, unit: n.unit ?? "", linkSource: n.link ?? "", orderIndex: i++ },
    });
    if (n.children) await seedNodes(projectId, section, n.children, row.id);
  }
}

export async function ensureDtcpDefaults(projectId: string) {
  const count = await prisma.dtcpLine.count({ where: { projectId } });
  if (count > 0) return;
  await seedNodes(projectId, "A", DEFAULT_A, null);
  await seedNodes(projectId, "B", DEFAULT_B, null);
}

// Dự án tạo trước khi có TH Thiết Bị / TH Thầu Phụ đồng bộ theo đầu mục lớn: "Thiết bị" và "Thầu phụ"
// khi đó vẫn là 1 dòng đơn (link công thức cũ "m" / "subcontractor"), chưa có dòng con để đồng bộ vào.
// Tự bổ sung 1 lần duy nhất 2 dòng con còn thiếu (idempotent, an toàn để gọi lại nhiều lần).
async function ensureDtcpStructure(projectId: string) {
  // Sửa lỗi cũ: dòng "Hợp đồng (sau VAT)" từng liên kết thẳng tổng Báo giá CĐT (giá TRƯỚC VAT) → đổi sang nguồn sau VAT.
  // Chỉ đổi đúng dòng mặc định (tên có "sau VAT", đang liên kết boq_quoted, không dùng công thức riêng).
  await prisma.dtcpLine.updateMany({
    where: { projectId, section: "A", linkSource: "boq_quoted", formula: "", name: { contains: "sau VAT", mode: "insensitive" } },
    data: { linkSource: "boq_quoted_vat" },
  });
  const lines = await prisma.dtcpLine.findMany({ where: { projectId, section: "B" } });
  const byName = new Map(lines.map((l) => [l.name, l]));
  const childrenOf = (id: string) => lines.filter((l) => l.parentId === id);

  const tb = byName.get("Thiết bị");
  if (tb && childrenOf(tb.id).length === 0) {
    await prisma.dtcpLine.create({ data: { projectId, section: "B", parentId: tb.id, name: "Thiết Bị Thi Công", unit: "VNĐ", linkSource: "tbs:A", orderIndex: 0 } });
    await prisma.dtcpLine.create({ data: { projectId, section: "B", parentId: tb.id, name: "Thiết Bị Khác", unit: "VNĐ", linkSource: "tbs:B", orderIndex: 1 } });
  }

  const tp = byName.get("Thầu phụ");
  if (tp && childrenOf(tp.id).length === 0) {
    await prisma.dtcpLine.create({ data: { projectId, section: "B", parentId: tp.id, name: "Thầu phụ theo CHI TIẾT", unit: "VNĐ", linkSource: "tp_boq", orderIndex: 0 } });
    await prisma.dtcpLine.create({ data: { projectId, section: "B", parentId: tp.id, name: "Thầu phụ bổ sung", unit: "VNĐ", linkSource: "", orderIndex: 1 } });
  }
}

export type DtcpRow = {
  id: string;
  parentId: string | null;
  section: "A" | "B";
  depth: number;
  code: string;
  name: string;
  unit: string;
  linkSource: string;
  isLeaf: boolean;
  manualAmount: number;
  formula: string; // công thức Thành tiền (bắt đầu bằng =), "" = không có
  amount: number;
  amountErr: string; // mã lỗi của công thức (VD #NAME?), "" = không lỗi
  exRow: number; // số dòng như trong Excel / trên giao diện
  note: string;
  cells: Record<string, number>; // columnId -> giá trị (dòng cha = tổng các dòng con)
  cellFormulas: Record<string, string>; // columnId -> công thức của ô (chỉ dòng lá)
  cellErrs: Record<string, string>;
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export type LinkTotals = Record<string, number>;

type LineRec = {
  id: string;
  parentId: string | null;
  section: string;
  name: string;
  unit: string;
  linkSource: string;
  manualAmount: number;
  formula: string;
  note: string;
  orderIndex: number;
  cells: { columnId: string; value: number; formula: string }[];
};

export function buildDtcpRows(lines: LineRec[], links: LinkTotals, columns: { id: string }[] = [], vatRate = 0): DtcpRow[] {
  const byParent = new Map<string | null, LineRec[]>();
  for (const l of lines) {
    if (!byParent.has(l.parentId)) byParent.set(l.parentId, []);
    byParent.get(l.parentId)!.push(l);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.orderIndex - b.orderIndex);

  const rows: DtcpRow[] = [];
  const kidsOf = new Map<string, string[]>();
  const lineOf = new Map(lines.map((l) => [l.id, l]));
  // Dựng cây dòng (thứ tự, mã số); số tiền tính sau bằng bộ công thức Excel để dòng nào cũng có thể là công thức
  const walk = (line: LineRec, depth: number, path: number[]) => {
    const kids = byParent.get(line.id) ?? [];
    const section = line.section as "A" | "B";
    // B: cấp 0 đánh số La Mã (I, II..), các cấp dưới bỏ cấp 0 → "1", "1.1", "1.2.1"; A: 1, 1.1...
    const code =
      section === "B" && depth === 0
        ? ROMAN[path[0]] ?? String(path[0] + 1)
        : (section === "B" ? path.slice(1) : path).map((n) => n + 1).join(".");
    rows.push({
      id: line.id,
      parentId: line.parentId,
      section,
      depth,
      code,
      name: line.name,
      unit: line.unit,
      linkSource: line.linkSource,
      isLeaf: kids.length === 0,
      manualAmount: line.manualAmount,
      formula: line.formula,
      amount: 0,
      amountErr: "",
      exRow: 0,
      note: line.note,
      cells: {},
      cellFormulas: {},
      cellErrs: {},
    });
    kidsOf.set(line.id, kids.map((k) => k.id));
    kids.forEach((k, i) => walk(k, depth + 1, [...path, i]));
  };
  for (const sec of ["A", "B"]) {
    (byParent.get(null) ?? [])
      .filter((l) => l.section === sec)
      .forEach((l, i) => walk(l, 0, [i]));
  }

  // Bảng tính ảo đúng vị trí dòng / cột như trong Excel: công thức của người dùng tham chiếu ô theo địa chỉ (VD D15, F20)
  const lay = dtcpLayout(rows);
  const grid = new Map<string, string>();
  const put = (exRow: number, col: number, v: string) => grid.set(`${exRow - 1}:${col}`, v);
  const colName = (c: number) => String.fromCharCode(65 + c);
  const ref = (id: string, col: number) => `${colName(col)}${lay.rowOf.get(id)}`;
  const sumOfKids = (ids: string[], col: number) => (ids.length ? `=SUM(${ids.map((k) => ref(k, col)).join(",")})` : "=0");
  for (const r of rows) {
    const line = lineOf.get(r.id) as LineRec;
    const kids = kidsOf.get(r.id) as string[];
    r.exRow = lay.rowOf.get(r.id) as number;
    if (kids.length) put(r.exRow, DTCP_AMOUNT_COL, sumOfKids(kids, DTCP_AMOUNT_COL));
    else if (line.formula.trim().startsWith("=")) put(r.exRow, DTCP_AMOUNT_COL, line.formula.trim());
    else put(r.exRow, DTCP_AMOUNT_COL, `=${line.linkSource ? links[line.linkSource] ?? 0 : line.manualAmount}`);
    columns.forEach((c, i) => {
      const col = dtcpExtraColIndex(i);
      const cell = line.cells.find((x) => x.columnId === c.id);
      if (kids.length) put(r.exRow, col, sumOfKids(kids, col));
      else if (cell && cell.formula.trim().startsWith("=")) put(r.exRow, col, cell.formula.trim());
      else put(r.exRow, col, `=${cell?.value ?? 0}`);
    });
  }
  const topOf = (sec: "A" | "B") => rows.filter((r) => r.section === sec && r.depth === 0).map((r) => r.id);
  for (const sec of ["A", "B"] as const) {
    put(lay.secRow[sec], DTCP_AMOUNT_COL, sumOfKids(topOf(sec), DTCP_AMOUNT_COL));
    columns.forEach((_, i) => put(lay.secRow[sec], dtcpExtraColIndex(i), sumOfKids(topOf(sec), dtcpExtraColIndex(i))));
  }
  put(lay.vatRow, DTCP_AMOUNT_COL, `=D${lay.secRow.A}-D${lay.secRow.A}/(1+${vatRate})`);
  put(lay.beforeVatRow, DTCP_AMOUNT_COL, `=D${lay.secRow.A}/(1+${vatRate})`);
  const ev = createEvaluator((r, c) => grid.get(`${r}:${c}`) ?? "", lay.rowOf.size + 40, 5 + columns.length + 1, links);
  const read = (exRow: number, col: number): { v: number; err: string } => {
    const v = ev.valueOf(exRow - 1, col);
    if (typeof v === "number") return { v, err: "" };
    if (typeof v === "string" && /^#/.test(v)) return { v: 0, err: v };
    return { v: 0, err: "" };
  };
  for (const r of rows) {
    const a = read(r.exRow, DTCP_AMOUNT_COL);
    r.amount = a.v;
    r.amountErr = a.err;
    columns.forEach((c, i) => {
      const x = read(r.exRow, dtcpExtraColIndex(i));
      r.cells[c.id] = x.v;
      if (x.err) r.cellErrs[c.id] = x.err;
      const own = (lineOf.get(r.id) as LineRec).cells.find((k) => k.columnId === c.id);
      if (r.isLeaf && own && own.formula.trim().startsWith("=")) r.cellFormulas[c.id] = own.formula.trim();
    });
  }
  return rows;
}

type ProjectForDtcp = NonNullable<Awaited<ReturnType<typeof import("@/lib/project-data").getProjectWithBoq>>>;

// Dùng chung cho trang DT-CP và xuất Excel: dựng cây dòng + tổng A/B từ dữ liệu dự án.
// Đồng bộ các đầu mục lớn của sheet TH Vật Tư / TH Nhân Công / TH Thiết Bị / TH Thầu Phụ thành dòng
// con (chỉ tên + tổng giá trị) trong DT-CP, dưới dòng cha tương ứng. Đổi tên/xoá đầu mục bên sheet gốc
// thì DT-CP theo. Đầu mục tắt "Thể hiện qua DT-CP" (showInDtcp=false) thì gộp chung vào "chưa phân nhóm".
const UNGROUPED_LABEL: Record<string, string> = {
  VT: "Vật tư chưa phân nhóm",
  NC: "Nhân công chưa phân nhóm",
  TB: "Thiết bị chưa phân nhóm",
  TP: "Thầu phụ chưa phân nhóm",
};

const SYNC_TARGETS: { kind: "VT" | "NC" | "TB" | "TP"; prefix: "vt" | "nt" | "tb" | "tp"; section: "A" | "B"; parentName: string; oldLink: string }[] = [
  { kind: "VT", prefix: "vt", section: "A", parentName: "Vật tư chính mua từ Hợp Nhân", oldLink: "" },
  { kind: "VT", prefix: "vt", section: "B", parentName: "Vật tư chính mua từ đối tác khác", oldLink: "vl" },
  { kind: "NC", prefix: "nt", section: "A", parentName: "Nhân công giao khoán", oldLink: "nc" },
  { kind: "NC", prefix: "nt", section: "B", parentName: "Nhân công khác", oldLink: "" },
  { kind: "TB", prefix: "tb", section: "A", parentName: "Thiết Bị Thi Công", oldLink: "" },
  { kind: "TB", prefix: "tb", section: "B", parentName: "Thiết Bị Khác", oldLink: "" },
  // Thầu phụ: đầu mục lớn của TH Thầu Phụ đồng bộ riêng (syncSubGroups) - cùng cấp với "Công tác chính", có đủ dòng con
];

// Đầu mục lớn đồng bộ vào DT-CP nằm ở đâu trong cây là do người dùng TỰ KÉO THẢ quyết định (xem
// moveDtcpLineAction) - hàm này chỉ tạo dòng còn thiếu / xoá dòng đã tắt hoặc đã xoá đầu mục gốc, còn
// dòng ĐANG CÓ thì giữ nguyên vị trí (parentId/orderIndex) dù người dùng đã kéo đi chỗ khác, tuyệt đối
// không tự "kéo về" home mặc định mỗi lần đồng bộ lại.
async function syncSheetLines(projectId: string, groups: { id: string; kind: string; section: string; name: string; showInDtcp: boolean }[]) {
  const lines = await prisma.dtcpLine.findMany({ where: { projectId, section: "B" } });
  const byLinkSource = new Map(lines.filter((l) => l.linkSource).map((l) => [l.linkSource, l]));
  for (const t of SYNC_TARGETS) {
    const parent = lines.find((l) => l.name === t.parentName);
    if (!parent) continue;
    const key = `${t.prefix}s:${t.section}`;
    if (parent.linkSource === "" || parent.linkSource === t.oldLink) {
      await prisma.dtcpLine.update({ where: { id: parent.id }, data: { linkSource: key } });
    }
    const secGroups = groups.filter((g) => g.kind === t.kind && g.section === t.section);
    const shownGroups = secGroups.filter((g) => g.showInDtcp);
    const wanted = shownGroups.map((g) => ({ key: `${t.prefix}g:${g.id}`, name: g.name }));
    if (secGroups.length > 0) wanted.push({ key: `${t.prefix}u:${t.section}`, name: UNGROUPED_LABEL[t.kind] });
    const wantedKeys = new Set(wanted.map((w) => w.key));

    // Các khoá CÓ THỂ thuộc target này (đang bật hoặc đã tắt) - dùng để dò dòng "thừa" (nhóm bị tắt/xoá)
    // mà không đụng tới khoá của target khác dù trùng tiền tố (VD "nt" dùng chung cho cả NC mục A/B).
    const candidateKeys = new Set([...secGroups.map((g) => `${t.prefix}g:${g.id}`), `${t.prefix}u:${t.section}`]);
    for (const ck of candidateKeys) {
      if (wantedKeys.has(ck)) continue;
      const existing = byLinkSource.get(ck);
      if (existing) {
        await prisma.dtcpLine.delete({ where: { id: existing.id } });
        byLinkSource.delete(ck);
      }
    }

    let order = lines.filter((l) => l.parentId === parent.id).reduce((m, c) => Math.max(m, c.orderIndex), -1) + 1;
    for (const w of wanted) {
      const existing = byLinkSource.get(w.key);
      if (!existing) {
        const created = await prisma.dtcpLine.create({
          data: { projectId, section: "B", parentId: parent.id, name: w.name, unit: "VNĐ", linkSource: w.key, orderIndex: order++ },
        });
        byLinkSource.set(w.key, created);
      } else if (!existing.nameLocked && existing.name !== w.name && w.key.startsWith(`${t.prefix}g:`)) {
        await prisma.dtcpLine.update({ where: { id: existing.id }, data: { name: w.name } });
      }
      // existing tìm thấy ở BẤT KỲ đâu trong cây → không đụng parentId/orderIndex, tôn trọng vị trí đã kéo thả.
    }
  }
}

// TH Thầu Phụ / Vật Tư / Nhân Công / Thiết Bị dùng VtGroup nên tự có "đầu mục lớn" sẵn; các sheet
// "Tạo mới" dạng bảng tự do (GRID) thì đầu mục là GridRowMeta (đánh dấu ở 1 dòng của bảng), không có
// vị trí cố định nào trong cây DT-CP để gắn vào - mặc định gắn dưới "CHI PHÍ TRỰC TIẾP", còn lại người
// dùng tự kéo thả sang chỗ phù hợp (VD vào "Chi phí tổ chức thi công").
async function syncGridHeadings(projectId: string) {
  const metas = await prisma.gridRowMeta.findMany({ where: { sheet: { projectId, kind: "GRID" }, }, include: { sheet: true } });
  const lines = await prisma.dtcpLine.findMany({ where: { projectId, section: "B" } });
  const byLinkSource = new Map(lines.filter((l) => l.linkSource).map((l) => [l.linkSource, l]));
  const defaultParent = lines.find((l) => l.name === "CHI PHÍ TRỰC TIẾP");
  if (!defaultParent) return;
  let order = lines.filter((l) => l.parentId === defaultParent.id).reduce((m, c) => Math.max(m, c.orderIndex), -1) + 1;
  for (const m of metas) {
    const key = `gridh:${m.id}`;
    const existing = byLinkSource.get(key);
    if (m.showInDtcp) {
      const name = `Sheet "${m.sheet.name}" › ${m.title || "đầu mục"}`;
      if (!existing) {
        const created = await prisma.dtcpLine.create({
          data: { projectId, section: "B", parentId: defaultParent.id, name, unit: "VNĐ", linkSource: key, orderIndex: order++ },
        });
        byLinkSource.set(key, created);
      } else if (!existing.nameLocked && existing.name !== name) {
        await prisma.dtcpLine.update({ where: { id: existing.id }, data: { name } });
      }
    } else if (existing) {
      await prisma.dtcpLine.delete({ where: { id: existing.id } });
      byLinkSource.delete(key);
    }
  }
  // Đầu mục gốc đã bị xoá bên sheet GRID nhưng dòng DT-CP tương ứng còn sót lại
  const metaKeys = new Set(metas.map((m) => `gridh:${m.id}`));
  for (const l of lines) {
    if (l.linkSource.startsWith("gridh:") && !metaKeys.has(l.linkSource)) await prisma.dtcpLine.delete({ where: { id: l.id } });
  }
}

// Thầu phụ trong DT-CP: dòng "Thầu phụ" gồm "Công tác chính" (công tác BOQ giao thầu phụ, tách theo tên nhà thầu) và
// CÙNG CẤP với nó là từng đầu mục lớn của TH Thầu Phụ (VD Chi phí Prelim, Biện pháp thi công), mỗi đầu mục liệt kê đủ
// các công tác con (tpi:<id>). Công tác bổ sung chưa thuộc đầu mục nào → 1 dòng "Thầu phụ chưa phân nhóm".
// Tìm dòng theo liên kết (không theo tên) nên người dùng đổi tên dòng thoải mái; dòng đã kéo thả đi chỗ khác giữ nguyên.
async function syncSubGroups(
  projectId: string,
  groups: { id: string; kind: string; name: string; showInDtcp: boolean }[],
  items: { id: string; name: string; groupId: string | null; boqItemId: string | null }[]
) {
  let lines = await prisma.dtcpLine.findMany({ where: { projectId, section: "B" } });
  const boqLine = lines.find((l) => l.linkSource === "tp_boq");
  const tpParentId = boqLine?.parentId ?? lines.find((l) => l.name === "Thầu phụ" && l.parentId)?.id;
  if (!tpParentId) return;
  const byLink = () => new Map(lines.filter((l) => l.linkSource).map((l) => [l.linkSource, l]));
  let links = byLink();
  const kidsOf = (id: string) => lines.filter((l) => l.parentId === id);
  const tpGroups = groups.filter((g) => g.kind === "TP");
  const shown = tpGroups.filter((g) => g.showInDtcp);
  const shownIds = new Set(shown.map((g) => g.id));
  const extra = items.filter((s) => !s.boqItemId);
  const loose = extra.filter((s) => !s.groupId || !shownIds.has(s.groupId));
  const norm = (s: string) => s.trim().toLocaleLowerCase("vi");

  // Dòng cũ "Thầu phụ bổ sung" (liên kết tps:B = tổng mọi công tác bổ sung) từng chứa các đầu mục: đưa các đầu mục ra
  // ngang cấp "Công tác chính"; dòng cũ không còn gì thì bỏ (để không cộng 2 lần)
  const legacy = links.get("tps:B");
  if (legacy) {
    for (const k of kidsOf(legacy.id).filter((k) => /^tp[gu]:/.test(k.linkSource))) {
      await prisma.dtcpLine.update({ where: { id: k.id }, data: { parentId: tpParentId } });
      k.parentId = tpParentId;
    }
    if (kidsOf(legacy.id).length === 0) {
      await prisma.dtcpLine.delete({ where: { id: legacy.id } });
      lines = lines.filter((l) => l.id !== legacy.id);
    } else await prisma.dtcpLine.update({ where: { id: legacy.id }, data: { linkSource: "" } });
    links = byLink();
  }

  let order = kidsOf(tpParentId).reduce((m, c) => Math.max(m, c.orderIndex), -1) + 1;
  const ensure = async (key: string, name: string, parentId: string, rename: boolean) => {
    const ex = links.get(key);
    if (ex) {
      if (rename && !ex.nameLocked && ex.name !== name) await prisma.dtcpLine.update({ where: { id: ex.id }, data: { name } });
      return ex;
    }
    const created = await prisma.dtcpLine.create({ data: { projectId, section: "B", parentId, name, unit: "VNĐ", linkSource: key, orderIndex: parentId === tpParentId ? order++ : kidsOf(parentId).length } });
    lines.push(created);
    links.set(key, created);
    return created;
  };
  const remove = async (key: string) => {
    const ex = links.get(key);
    if (!ex) return;
    await prisma.dtcpLine.deleteMany({ where: { id: { in: [ex.id, ...kidsOf(ex.id).map((k) => k.id)] } } });
    lines = lines.filter((l) => l.id !== ex.id && l.parentId !== ex.id);
    links = byLink();
  };

  for (const g of shown) {
    // dòng người dùng tự gõ trùng tên đầu mục, còn trống, nằm ngay dưới "Thầu phụ" → thay bằng dòng đồng bộ
    if (!links.has(`tpg:${g.id}`)) {
      const dup = kidsOf(tpParentId).find((l) => !l.linkSource && !l.formula && !l.manualAmount && norm(l.name) === norm(g.name) && kidsOf(l.id).length === 0);
      if (dup) {
        await prisma.dtcpLine.update({ where: { id: dup.id }, data: { linkSource: `tpg:${g.id}` } });
        dup.linkSource = `tpg:${g.id}`;
        links = byLink();
      }
    }
    const gl = await ensure(`tpg:${g.id}`, g.name, tpParentId, true);
    for (const it of extra.filter((s) => s.groupId === g.id)) await ensure(`tpi:${it.id}`, it.name, gl.id, true);
  }
  // đầu mục bị tắt / xoá, công tác đã xoá / chuyển nhóm
  for (const g of tpGroups) if (!shownIds.has(g.id)) await remove(`tpg:${g.id}`);
  for (const l of [...lines]) {
    const gm = /^tpg:(.+)$/.exec(l.linkSource);
    if (gm && !tpGroups.some((g) => g.id === gm[1])) await remove(l.linkSource);
    const im = /^tpi:(.+)$/.exec(l.linkSource);
    if (im) {
      const it = extra.find((s) => s.id === im[1]);
      if (!it || !it.groupId || !shownIds.has(it.groupId)) await remove(l.linkSource);
    }
  }
  // dòng người dùng tự gõ trùng tên 1 đầu mục, còn trống, nằm ngay dưới "Thầu phụ" → bỏ (đã có dòng đồng bộ cùng tên)
  for (const g of shown) {
    for (const dup of kidsOf(tpParentId).filter((l) => !l.linkSource && !l.formula && !l.manualAmount && norm(l.name) === norm(g.name) && kidsOf(l.id).length === 0)) {
      await prisma.dtcpLine.delete({ where: { id: dup.id } });
      lines = lines.filter((l) => l.id !== dup.id);
    }
  }
  if (loose.length) await ensure("tpu:B", "Thầu phụ chưa phân nhóm", tpParentId, false);
  else await remove("tpu:B");
}

// Tách "Thầu phụ theo CHI TIẾT" (tổng công tác link từ BOQ) thành các dòng riêng theo TÊN thầu phụ
// (SubcontractorItem.contractorName là chữ tự do, không có bảng riêng) - bật/tắt qua
// SubcontractorNameToggle. Tên tắt hoặc chưa gán → gộp vào "Chưa gán thầu phụ".
async function syncContractorNames(projectId: string, boqLinkedItems: { contractorName: string }[]) {
  const lines = await prisma.dtcpLine.findMany({ where: { projectId, section: "B" } });
  // tìm theo liên kết (người dùng có thể đã đổi tên dòng, VD "Công tác chính")
  const parent = lines.find((l) => l.linkSource === "tp_boq") ?? lines.find((l) => l.name === "Thầu phụ theo CHI TIẾT");
  if (!parent) return;
  const byLinkSource = new Map(lines.filter((l) => l.linkSource).map((l) => [l.linkSource, l]));
  const toggles = await prisma.subcontractorNameToggle.findMany({ where: { projectId } });
  const toggleOf = new Map(toggles.map((t) => [t.name, t.showInDtcp]));

  const names = new Set<string>();
  for (const s of boqLinkedItems) {
    const n = s.contractorName.trim();
    if (n) names.add(n);
  }
  const UNASSIGNED_KEY = "tpc:_unassigned";
  const wanted = [...names].filter((n) => toggleOf.get(n) ?? true).map((n) => ({ key: `tpc:${n}`, name: n }));
  // chỉ khi thật sự còn công tác chưa gán tên thầu phụ (hoặc tên đang tắt) - không hiện dòng 0 đồng
  if (boqLinkedItems.some((s) => !s.contractorName.trim() || !(toggleOf.get(s.contractorName.trim()) ?? true))) wanted.push({ key: UNASSIGNED_KEY, name: "Chưa gán thầu phụ" });
  const wantedKeys = new Set(wanted.map((w) => w.key));

  const candidateKeys = new Set([...names].map((n) => `tpc:${n}`).concat(UNASSIGNED_KEY));
  for (const ck of candidateKeys) {
    if (wantedKeys.has(ck)) continue;
    const existing = byLinkSource.get(ck);
    if (existing) {
      await prisma.dtcpLine.delete({ where: { id: existing.id } });
      byLinkSource.delete(ck);
    }
  }

  let order = lines.filter((l) => l.parentId === parent.id).reduce((m, c) => Math.max(m, c.orderIndex), -1) + 1;
  for (const w of wanted) {
    const existing = byLinkSource.get(w.key);
    if (!existing) {
      const created = await prisma.dtcpLine.create({
        data: { projectId, section: "B", parentId: parent.id, name: w.name, unit: "VNĐ", linkSource: w.key, orderIndex: order++ },
      });
      byLinkSource.set(w.key, created);
    } else if (!existing.nameLocked && existing.name !== w.name && w.key !== UNASSIGNED_KEY) {
      await prisma.dtcpLine.update({ where: { id: existing.id }, data: { name: w.name } });
    }
  }
}

export async function getDtcpData(project: ProjectForDtcp) {
  await ensureDtcpDefaults(project.id);
  await ensureDtcpStructure(project.id);
  const [sheetGroups, placements, manualItems] = await Promise.all([
    prisma.vtGroup.findMany({ where: { projectId: project.id } }),
    prisma.vtPlacement.findMany({ where: { projectId: project.id } }),
    prisma.sheetManualItem.findMany({ where: { projectId: project.id } }),
  ]);
  await syncSheetLines(project.id, sheetGroups);
  await syncGridHeadings(project.id);
  await syncSubGroups(project.id, sheetGroups, project.subcontractorItems);
  await syncContractorNames(project.id, project.subcontractorItems.filter((s) => s.boqItemId));
  const nameToggles = await prisma.subcontractorNameToggle.findMany({ where: { projectId: project.id } });
  const sheetLinks = await computeSheetLinks(project, sheetGroups, placements, applyManualFormulas(manualItems, project.formulaCtx), {
    shownOnly: true,
    nameToggleOf: new Map(nameToggles.map((t) => [t.name, t.showInDtcp])),
  });
  // Bảng tự do có chọn cột "Thành tiền": tổng cột đó là 1 nguồn liên kết cho DT-CP
  const { values: gridValues, options: gridLinkOptions } = await getGridLinkValues(project.id, project);
  Object.assign(sheetLinks, gridValues);
  const lines = await prisma.dtcpLine.findMany({ where: { projectId: project.id }, include: { cells: true } });
  const columns = await prisma.dtcpColumn.findMany({ where: { projectId: project.id }, orderBy: { orderIndex: "asc" } });
  // Doanh thu = Báo giá CĐT của các công tác + các đầu mục liên kết giá (theo % / từ sheet bảng tự do, VD Prelim, BPTC).
  // Đầu mục liên kết không có định mức nên không cộng VL/NC/M: chi phí của nó đã vào DT-CP qua chính sheet bảng tự do.
  const totals = computeProjectTotals(project, gridValues);
  // Giá trị mọi nguồn dùng được trong công thức LINK("khoá") (gồm cả nhóm không bật "Thể hiện qua DT-CP", các sheet bảng tự do...)
  const sources = await getGridSources(project);
  const formulaLinks: Record<string, number> = { ...sources.values, ...sheetLinks, ...totals.named };
  const rows = buildDtcpRows(lines, formulaLinks, columns, project.vatRate);
  const sectionTotal = (s: "A" | "B") => rows.filter((r) => r.section === s && r.depth === 0).reduce((a, r) => a + r.amount, 0);
  // Danh sách chọn nguồn cho công thức: nguồn gốc + từng sheet bảng tự do (tổng sheet / từng đầu mục) + tổng Báo giá CĐT đầy đủ
  const { options: gridOptsFull } = await getGridLinkValues(project.id, project);
  const sheetNameOf = (label: string) => /^Sheet "(.+?)"/.exec(label)?.[1] ?? "Sheet khác";
  const linkPickerOptions = [
    ...sources.options,
    { value: "boq_quoted", label: "Tổng Báo giá CĐT toàn bộ, trước VAT (gồm đầu mục liên kết giá)", group: "BOQ" },
    { value: "boq_quoted_vat", label: "Tổng Báo giá CĐT toàn bộ, sau VAT", group: "BOQ" },
    ...gridOptsFull.map((o) => ({ value: o.value, label: o.label.replace(/^Sheet "[^"]+" — /, "").replace(/^Sheet "[^"]+" › /, ""), group: sheetNameOf(o.label) })),
  ];
  return { rows, columns, totalA: sectionTotal("A"), totalB: sectionTotal("B"), gridLinkOptions, linkPickerOptions, linkValues: formulaLinks };
}
