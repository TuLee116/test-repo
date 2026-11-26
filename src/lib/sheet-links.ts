import { prisma } from "@/lib/prisma";
import { subAmountVat } from "@/lib/thauphu-shared";
import { applyManualFormulas } from "@/lib/field-formulas";
import { computeBoqAmounts } from "@/lib/boq-amounts";
import { computeBoqTree } from "@/lib/boq-tree";
import { aggregateResourceUsage, computeWorkItemUnitCost } from "@/lib/cost";
import type { GridSourceOption } from "@/lib/grid-sources-shared";

type Project = NonNullable<Awaited<ReturnType<typeof import("@/lib/project-data").getProjectWithBoq>>>;
type Group = { id: string; kind: string; section: string; name: string; showInDtcp: boolean };
type Placement = { kind: string; resourceId: string; section: string; groupId: string | null };
type Manual = { kind: string; groupId: string | null; quantity: number; unitPrice: number; vatRate?: number; days?: number | null };

// Giá trị các nguồn liên kết lấy từ các sheet TH Vật Tư / Nhân Công / Thiết Bị / Thầu Phụ (vts:A, vtg:<id>, tpc:<tên>...).
// shownOnly: chỉ tách theo nhóm những đầu mục bật "Thể hiện qua DT-CP" (đúng như DT-CP); false = tách mọi nhóm (dùng cho công thức bảng tự do).
export async function computeSheetLinks(
  project: Project,
  groups: Group[],
  placements: Placement[],
  manualItems: Manual[],
  opts: { shownOnly: boolean; nameToggleOf?: Map<string, boolean> },
): Promise<Record<string, number>> {
  const sheetLinks: Record<string, number> = {
    "vts:A": 0, "vts:B": 0, "vtu:A": 0, "vtu:B": 0,
    "nts:A": 0, "nts:B": 0, "ntu:A": 0, "ntu:B": 0,
    "tbs:A": 0, "tbs:B": 0, "tbu:A": 0, "tbu:B": 0,
    "tp_boq": 0, "tps:B": 0, "tpu:B": 0,
  };
  const usage = aggregateResourceUsage(project.boqItems);
  const inScope = (g: Group) => !opts.shownOnly || g.showInDtcp;
  // vật tư, thiết bị: DT-CP lấy thành tiền SAU VAT (xem tonghop.ts, tonghop-shared vatOnTop)
  const tbVat = new Map(project.resourcePrices.map((p) => [p.resourceId, p.vatRate]));
  for (const kind of ["VT", "NC", "TB"] as const) {
    const prefix = kind === "VT" ? "vt" : kind === "NC" ? "nt" : "tb";
    const defaultSection = kind === "VT" ? "B" : "A";
    const placementOf = new Map(placements.filter((p) => p.kind === kind).map((p) => [p.resourceId, p]));
    const groupIds = new Set(groups.filter((g) => g.kind === kind && inScope(g)).map((g) => g.id));
    const add = (sec: string, groupId: string | null | undefined, amount: number) => {
      sheetLinks[`${prefix}s:${sec}`] += amount;
      if (groupId && groupIds.has(groupId)) sheetLinks[`${prefix}g:${groupId}`] = (sheetLinks[`${prefix}g:${groupId}`] ?? 0) + amount;
      else sheetLinks[`${prefix}u:${sec}`] += amount;
    };
    for (const g of groups) if (g.kind === kind && groupIds.has(g.id)) sheetLinks[`${prefix}g:${g.id}`] ??= 0;
    for (const r of usage.filter((x) => x.category === kind)) {
      const p = placementOf.get(r.resourceId);
      // VT, TB: sau VAT (nhân công đã gồm % quản lý của đội trong đơn giá - xem project-data crewPct)
      const amt = kind === "NC" ? r.totalAmount : r.totalAmount * (1 + (tbVat.get(r.resourceId) ?? 0));
      add(p ? (p.section === "A" ? "A" : "B") : defaultSection, p?.groupId, amt);
    }
    if (kind === "NC" || kind === "TB") for (const m of manualItems.filter((m) => m.kind === kind)) add("B", m.groupId, m.quantity * m.unitPrice * (m.days ?? 1) * (kind === "TB" ? 1 + (m.vatRate ?? 0) : 1));
  }
  // Thầu phụ: công tác link từ CHI TIẾT/BOQ (theo đầu mục BOQ, không qua VtGroup) tách riêng khỏi phần bổ sung/nhóm thủ công,
  // phần theo CHI TIẾT còn tách thêm theo TÊN thầu phụ.
  const tpGroupIds = new Set(groups.filter((g) => g.kind === "TP" && inScope(g)).map((g) => g.id));
  for (const g of groups) if (g.kind === "TP" && tpGroupIds.has(g.id)) sheetLinks[`tpg:${g.id}`] ??= 0;
  const nameToggleOf = opts.nameToggleOf ?? new Map<string, boolean>();
  // chi phí thầu phụ bên DT-CP tính SAU VAT (amount = trước VAT, xem thauphu.ts)
  for (const s of project.subcontractorItems) {
    const v = subAmountVat(s);
    if (s.boqItemId) {
      sheetLinks["tp_boq"] += v;
      const name = s.contractorName.trim();
      if (name && (nameToggleOf.get(name) ?? true)) sheetLinks[`tpc:${name}`] = (sheetLinks[`tpc:${name}`] ?? 0) + v;
      else sheetLinks["tpc:_unassigned"] = (sheetLinks["tpc:_unassigned"] ?? 0) + v;
      continue;
    }
    sheetLinks["tps:B"] += v;
    sheetLinks[`tpi:${s.id}`] = v; // từng công tác của đầu mục thầu phụ bổ sung (dòng con bên DT-CP)
    if (s.groupId && tpGroupIds.has(s.groupId)) sheetLinks[`tpg:${s.groupId}`] = (sheetLinks[`tpg:${s.groupId}`] ?? 0) + v;
    else sheetLinks["tpu:B"] += v;
  }
  return sheetLinks;
}

// Tổng toàn dự án (VL/NC/M theo định mức, Báo giá CĐT...). gridValues = giá trị các đầu mục BOQ đang liên kết với bảng tự do.
export function computeProjectTotals(project: Project, gridValues: Record<string, number>) {
  const t = { vl: 0, nc: 0, m: 0, quoted: 0 };
  const amounts = computeBoqAmounts(project.boqItems, () => 0, gridValues);
  for (const b of project.boqItems) {
    t.quoted += amounts.get(b.id)?.quotedTotal ?? 0;
    const unit = b.workItem ? computeWorkItemUnitCost(b.workItem.resources, b.workItem) : computeWorkItemUnitCost([]);
    t.vl += unit.vl * b.quantity;
    t.nc += unit.nc * b.quantity;
    t.m += unit.m * b.quantity;
  }
  return {
    ...t,
    named: {
      boq_quoted: t.quoted,
      // giá báo CĐT trong BOQ là giá TRƯỚC VAT → giá trị hợp đồng sau VAT = × (1 + thuế suất của dự án)
      boq_quoted_vat: t.quoted * (1 + project.vatRate),
      vl: t.vl,
      nc: t.nc,
      m: t.m,
      subcontractor: project.subcontractorItems.reduce((s, i) => s + subAmountVat(i), 0), // sau VAT
      nck: t.nc * project.ncKhacRate,
      tbk: t.nc * project.tbRate,
      mmtb: (t.vl + t.nc + t.m + t.nc * (project.ncKhacRate + project.tbRate)) * project.mmtbRate,
      other: project.otherCostItems.reduce((s, i) => s + i.amount, 0),
    } as Record<string, number>,
  };
}

// Các nguồn liên kết dùng được trong công thức bảng tự do: LINK("khoá"). Chỉ gồm các nguồn KHÔNG phụ thuộc bảng tự do nào,
// nên không bao giờ tính vòng khi 1 đầu mục BOQ / dòng DT-CP lại lấy giá trị từ chính bảng tự do đó.
export async function getGridSources(project: Project): Promise<{ values: Record<string, number>; options: GridSourceOption[] }> {
  const [groups, placements, manualItems] = await Promise.all([
    prisma.vtGroup.findMany({ where: { projectId: project.id }, orderBy: { orderIndex: "asc" } }),
    prisma.vtPlacement.findMany({ where: { projectId: project.id } }),
    prisma.sheetManualItem.findMany({ where: { projectId: project.id } }),
  ]);
  const links = await computeSheetLinks(project, groups, placements, applyManualFormulas(manualItems, project.formulaCtx), { shownOnly: false });
  const totals = computeProjectTotals(project, {});
  const values: Record<string, number> = { ...links, ...totals.named };
  const options: GridSourceOption[] = [];
  const add = (group: string, value: string, label: string) => options.push({ value, label, group });

  // BOQ: tổng giá trị các công tác (không gồm đầu mục liên kết giá) và từng đầu mục lớn
  const amounts = computeBoqAmounts(project.boqItems, () => 0, {});
  const work = project.boqItems.filter((b) => !b.isHeading);
  values["boq_work"] = work.reduce((s, b) => s + (amounts.get(b.id)?.quotedTotal ?? 0), 0);
  add("BOQ", "boq_work", "Giá trị gói thầu — tổng Báo giá CĐT các công tác");
  const bySheet = new Map<string, typeof project.boqItems>();
  for (const b of project.boqItems) bySheet.set(b.sheetId ?? "", [...(bySheet.get(b.sheetId ?? "") ?? []), b]);
  for (const list of bySheet.values()) {
    const tree = computeBoqTree(list);
    for (const h of list) {
      if (!h.isHeading) continue;
      const ids = tree.scope.get(h.id) ?? [];
      if (!ids.length) continue;
      values[`boqh:${h.id}`] = ids.reduce((s, id) => s + (amounts.get(id)?.quotedTotal ?? 0), 0);
      add("BOQ", `boqh:${h.id}`, `Đầu mục ${h.stt ? `${h.stt} ` : ""}${h.rawDescription}`.trim());
    }
  }

  add("CHI TIẾT", "nck", "Nhân công khác (CHI TIẾT)");
  add("CHI TIẾT", "tbk", "Thiết bị theo % nhân công (CHI TIẾT)");
  add("CHI TIẾT", "mmtb", "MMTB + Vật tư phụ (CHI TIẾT)");
  add("CHI TIẾT", "other", "Tổng Chi phí khác");

  const secName = (k: "VT" | "NC" | "TB", s: "A" | "B") =>
    k === "VT" ? (s === "A" ? "mục A (Hợp Nhân)" : "mục B (đối tác khác)") : k === "NC" ? (s === "A" ? "mục A (Giao khoán)" : "mục B (Khác)") : s === "A" ? "mục A (Thi công)" : "mục B (Khác)";
  for (const [kind, prefix, sheet] of [["VT", "vt", "TH Vật Tư"], ["NC", "nt", "TH Nhân Công"], ["TB", "tb", "TH Thiết Bị"]] as const) {
    add(sheet, kind === "VT" ? "vl" : kind === "NC" ? "nc" : "m", `Tổng cả sheet ${sheet}`);
    add(sheet, `${prefix}s:A`, `Tổng ${secName(kind, "A")}`);
    add(sheet, `${prefix}s:B`, `Tổng ${secName(kind, "B")}`);
    for (const g of groups.filter((x) => x.kind === kind)) add(sheet, `${prefix}g:${g.id}`, `Đầu mục "${g.name}" (mục ${g.section})`);
  }
  add("TH Thầu Phụ", "subcontractor", "Tổng cả sheet TH Thầu Phụ");
  add("TH Thầu Phụ", "tp_boq", "Thầu phụ theo công tác BOQ");
  add("TH Thầu Phụ", "tps:B", "Thầu phụ bổ sung thủ công");
  for (const g of groups.filter((x) => x.kind === "TP")) add("TH Thầu Phụ", `tpg:${g.id}`, `Đầu mục "${g.name}"`);
  for (const key of Object.keys(links).filter((k) => k.startsWith("tpc:") && k !== "tpc:_unassigned")) add("TH Thầu Phụ", key, `Thầu phụ "${key.slice(4)}"`);
  return { values, options };
}
