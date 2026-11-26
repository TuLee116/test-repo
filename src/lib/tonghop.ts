import { aggregateResourceUsage } from "@/lib/cost";
import { prisma } from "@/lib/prisma";
import { applyManualFormulas, fkey } from "@/lib/field-formulas";
import type { getProjectWithBoq } from "@/lib/project-data";
import { LABOR_GROUP } from "@/lib/labor-sync";

// Dữ liệu dùng chung cho sheet TH Vật Tư ("VT"), TH Nhân Công ("NC") và TH Thiết Bị ("TB"): mục lớn
// A/B, đầu mục lớn, vị trí từng tài nguyên, ghi chú, và (NC/TB) dòng tự bổ sung ở mục B.
import { SHEET_CFG, type SheetGroup, type SheetKind, type SheetRow } from "@/lib/tonghop-shared";

type Project = NonNullable<Awaited<ReturnType<typeof getProjectWithBoq>>>;

export async function loadSheet(project: Project, kind: SheetKind): Promise<{ rows: SheetRow[]; groups: SheetGroup[] }> {
  const cfg = SHEET_CFG[kind];
  const [groups, placements, manualDb] = await Promise.all([
    prisma.vtGroup.findMany({ where: { projectId: project.id, kind }, orderBy: { orderIndex: "asc" } }),
    prisma.vtPlacement.findMany({ where: { projectId: project.id, kind } }),
    kind === "NC" || kind === "TB"
      ? prisma.sheetManualItem.findMany({ where: { projectId: project.id, kind }, orderBy: { orderIndex: "asc" } })
      : Promise.resolve([]),
  ]);
  const ctx = project.formulaCtx;
  const manual = applyManualFormulas(manualDb, ctx);
  const placementById = new Map(placements.map((p) => [p.resourceId, p]));
  const groupIds = new Set(groups.map((g) => g.id));
  const overrides = new Map(project.resourcePrices.map((p) => [p.resourceId, p]));
  const wastages = new Map(project.resourceWastages.map((w) => [w.resourceId, w.rate]));
  // Nhân công theo công việc BOQ: nhân công riêng của dự án (sửa tên được) + STT các dòng BOQ đang dùng
  const laborIds = new Set(project.projectResources.filter((r) => r.sourceType === "NC" && r.groupLabel === LABOR_GROUP).map((r) => r.id));
  const usedBy = new Map<string, string[]>();
  if (kind === "NC")
    for (const b of project.boqItems)
      for (const l of b.workItem?.resources ?? [])
        if (laborIds.has(l.resource.id)) usedBy.set(l.resource.id, [...(usedBy.get(l.resource.id) ?? []), b.stt || "?"]);

  const rows: SheetRow[] = aggregateResourceUsage(project.boqItems)
    .filter((r) => r.category === cfg.category)
    .map((r) => {
      const pl = placementById.get(r.resourceId);
      const ov = overrides.get(r.resourceId);
      const section: "A" | "B" = pl ? (pl.section === "A" ? "A" : "B") : cfg.defaultSection;
      return {
        resourceId: r.resourceId,
        manual: false,
        code: r.code,
        name: r.name,
        unit: r.unit,
        qty: r.totalQuantity,
        // TH Vật Tư: thành tiền SAU VAT = KL × đơn giá sau VAT × (1 + hao hụt) - DT-CP lấy số này (CHI TIẾT / BOQ vẫn trước VAT)
        amount: kind === "VT" ? r.totalAmount * (1 + (ov?.vatRate ?? 0)) : r.totalAmount,
        amountVat: kind === "VT" || kind === "TB" ? r.totalAmount * (1 + (ov?.vatRate ?? 0)) : r.totalAmount,
        ...(kind === "NC" ? { mgmtPct: pl?.mgmtVtPct ?? 0 } : {}),
        priceFormula: ctx.formulas.get(fkey("price", r.resourceId, "unitPrice")) ?? "",
        priceErr: ctx.errs.get(fkey("price", r.resourceId, "unitPrice")) ?? "",
        // nhân công: r.unitPrice đã nhân (1 + % quản lý) để tính toán → hiện lại đơn giá gốc
        priceAfterVat: ov?.unitPrice ?? (kind === "NC" ? r.unitPrice / (1 + (project.crewPct.get(r.resourceId) ?? 0) / 100) : r.unitPrice),
        vatPercent: (ov?.vatRate ?? 0) * 100,
        wastagePercent: wastages.has(r.resourceId) ? (wastages.get(r.resourceId) as number) * 100 : null,
        note: pl?.note ?? "",
        section,
        groupId: pl?.groupId && groupIds.has(pl.groupId) ? pl.groupId : null,
        laborByWork: laborIds.has(r.resourceId),
        usedBy: usedBy.get(r.resourceId)?.join(", "),
      };
    });

  for (const m of manual) {
    rows.push({
      resourceId: m.id,
      manual: true,
      code: "",
      name: m.name,
      unit: m.unit,
      qty: m.quantity,
      // có thời gian thuê: thành tiền = SL × đơn giá (đ/ngày) × số ngày
      amount: m.quantity * m.unitPrice * (m.days ?? 1),
      amountVat: m.quantity * m.unitPrice * (m.days ?? 1) * (1 + (kind === "TB" ? m.vatRate : 0)),
      days: m.days,
      priceFormula: ctx.formulas.get(fkey("manual", m.id, "unitPrice")) ?? "",
      priceErr: ctx.errs.get(fkey("manual", m.id, "unitPrice")) ?? "",
      qtyFormula: ctx.formulas.get(fkey("manual", m.id, "quantity")) ?? "",
      qtyErr: ctx.errs.get(fkey("manual", m.id, "quantity")) ?? "",
      priceAfterVat: m.unitPrice,
      vatPercent: m.vatRate * 100,
      wastagePercent: null,
      note: m.note,
      section: "B",
      groupId: m.groupId && groupIds.has(m.groupId) ? m.groupId : null,
    });
  }

  // Trong mỗi mục / đầu mục lớn: dòng lấy từ chiết tính xếp theo vần A-Z; dòng người dùng tự thêm giữ đúng thứ tự
  // đã thêm (orderIndex) và nằm sau các dòng chiết tính
  rows.sort((a, b) => (a.manual || b.manual ? Number(!!a.manual) - Number(!!b.manual) : a.name.localeCompare(b.name, "vi", { sensitivity: "base" })));
  return { rows, groups: groups.map((g) => ({ id: g.id, section: g.section === "A" ? "A" : "B", name: g.name, showInDtcp: g.showInDtcp })) };
}
