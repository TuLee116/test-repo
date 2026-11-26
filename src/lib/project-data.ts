import { prisma } from "@/lib/prisma";
import { buildFormulaCtx, fkey, resolveField } from "@/lib/field-formulas";
import { subCovers } from "@/lib/sub-portions";
import { unitFactor } from "@/lib/unit-convert";
import { parseQtyWithKL } from "@/lib/formula";
import { aggregateResourceUsage } from "@/lib/cost";

// Nhóm nguồn "khối lượng vật tư" trong danh sách Liên kết sheet - chỉ dùng cho dòng tự bổ sung ở TH Nhân Công / Thiết Bị
// (VD vận chuyển vật tư); đơn giá & thầu phụ được tính trước khi có khối lượng nên các sheet đó không hiện nhóm này.
export const VT_QTY_GROUP = "Khối lượng vật tư (TH Vật Tư)";

// Đọc dự án + BOQ + chiết tính, áp dụng đơn giá riêng của dự án (ProjectResourcePrice) đè lên đơn
// giá gốc chung nếu có - mọi nơi tính chi phí (BOQ, CHI TIẾT, TH VT/NC/TB, DT-CP, xuất Excel) đều
// nên dùng hàm này thay vì query trực tiếp, để luôn nhất quán đơn giá theo dự án.
export async function getProjectWithBoq(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      boqItems: {
        orderBy: { orderIndex: "asc" },
        include: { workItem: { include: { resources: { include: { resource: true } } } } },
      },
      resourcePrices: true,
      resourceWastages: true,
      subcontractorItems: { orderBy: { orderIndex: "asc" } },
      otherCostItems: { orderBy: { orderIndex: "asc" } },
    },
  });
  if (!project) return null;

  // Công thức (LINK tới giá trị BOQ) gõ ở các sheet TH: tính ngay từ đầu rồi đè lên đơn giá / số lượng đã lưu
  const extraSheets = await prisma.projectSheet.findMany({ where: { projectId }, orderBy: { orderIndex: "asc" }, include: { cells: true, metas: true } });
  const formulaCtx = buildFormulaCtx(await prisma.fieldFormula.findMany({ where: { projectId } }), project.boqItems, {
    boqSheets: extraSheets.filter((s) => s.kind === "BOQ"),
    grids: extraSheets.filter((s) => s.kind === "GRID"),
  });
  for (const p of project.resourcePrices) p.unitPrice = resolveField(formulaCtx, fkey("price", p.resourceId, "unitPrice"), p.unitPrice);
  for (const sc of project.subcontractorItems) {
    sc.unitPrice = resolveField(formulaCtx, fkey("sub", sc.id, "unitPrice"), sc.unitPrice);
    if (!sc.boqItemId || !sc.followBoq) {
      sc.quantity = resolveField(formulaCtx, fkey("sub", sc.id, "quantity"), sc.quantity);
      if (formulaCtx.formulas.has(fkey("sub", sc.id, "unitPrice")) || formulaCtx.formulas.has(fkey("sub", sc.id, "quantity"))) sc.amount = sc.quantity * sc.unitPrice;
    }
  }

  // Đổi vật liệu theo từng dòng BOQ (VD loại gạch/đá theo spec CĐT): thay tài nguyên của dòng hao phí bằng vật liệu đã chọn,
  // trước khi áp đơn giá / hao hụt riêng của dự án (nên đơn giá & hao hụt đặt ở TH Vật Tư áp dụng cho đúng vật liệu mới)
  const swaps = await prisma.boqLineResourceSwap.findMany({ where: { projectId } });
  const projectResources = await prisma.resource.findMany({ where: { projectId }, orderBy: { name: "asc" } });
  if (swaps.length > 0) {
    const targets = new Map((await prisma.resource.findMany({ where: { id: { in: [...new Set(swaps.map((w) => w.resourceId))] } } })).map((r) => [r.id, r]));
    const swapOf = new Map(swaps.map((w) => [`${w.boqItemId}:${w.lineId}`, w.resourceId]));
    for (const b of project.boqItems) {
      if (!b.workItem) continue;
      for (const l of b.workItem.resources) {
        const to = targets.get(swapOf.get(`${b.id}:${l.id}`) ?? "");
        if (to) {
          l.resource = { ...to };
          l.resourceId = to.id;
        }
      }
    }
  }
  const lineSwaps = new Map(swaps.map((w) => [`${w.boqItemId}:${w.lineId}`, w.resourceId]));

  // unitPrice lưu trong ProjectResourcePrice là giá SAU VAT nhập tay; giá dùng để tính toán (VL/NC/M,
  // DT-CP...) luôn là giá TRƯỚC VAT = giá sau VAT / (1 + thuế suất), tránh tính trùng VAT với dòng
  // "Thuế GTGT" ở cuối DT-CP.
  // Riêng THIẾT BỊ (giống thầu phụ): đơn giá nhập là giá TRƯỚC VAT, VAT % chỉ để cộng thêm ở TH Thiết Bị / DT-CP.
  const overrides = new Map(project.resourcePrices.map((p) => [p.resourceId, p]));
  if (overrides.size > 0) {
    for (const b of project.boqItems) {
      if (!b.workItem) continue;
      for (const l of b.workItem.resources) {
        const ov = overrides.get(l.resource.id);
        // chỉ vật tư có đơn giá nhập sau VAT; thiết bị nhập trước VAT, nhân công không có VAT
        if (ov) l.resource.unitPrice = l.category === "VT" ? ov.unitPrice / (1 + ov.vatRate) : ov.unitPrice;
      }
    }
  }

  // Chỉ vật tư mới có hao hụt: nhân công / máy thi công luôn tính hao hụt = 0 (bỏ giá trị cũ trong định mức gốc)
  for (const b of project.boqItems) {
    if (!b.workItem) continue;
    for (const l of b.workItem.resources) if (l.category !== "VT") l.wastageRate = 0;
  }

  // Hao hụt nhập 1 lần theo tài nguyên ở sheet TH Vật Tư → đè lên hao hụt mặc định của từng dòng định mức
  const wastages = new Map(project.resourceWastages.map((w) => [w.resourceId, w.rate]));
  if (wastages.size > 0) {
    for (const b of project.boqItems) {
      if (!b.workItem) continue;
      for (const l of b.workItem.resources) {
        const rate = wastages.get(l.resource.id);
        if (rate !== undefined && l.category === "VT") l.wastageRate = rate;
      }
    }
  }

  // Công tác giao thầu phụ: không tính hao phí tự thi công (tránh cộng trùng), giá trị thầu phụ =
  // đơn giá thầu phụ (sheet TH Thầu Phụ) × khối lượng BOQ.
  const qtyById = new Map(project.boqItems.map((b) => [b.id, b.quantity]));
  for (const b of project.boqItems) {
    if (b.method === "SUB" && b.workItem) b.workItem.resources = [];
  }
  // phần giao theo % khối lượng (giao theo đầu mục): khối lượng luôn = % × khối lượng BOQ của công tác
  for (const sc of project.subcontractorItems) if (sc.boqItemId && !sc.followBoq && sc.percent != null) sc.quantity = (sc.percent / 100) * (qtyById.get(sc.boqItemId) ?? 0);
  for (const sc of project.subcontractorItems) {
    if (sc.boqItemId) sc.amount = sc.unitPrice * (sc.followBoq ? qtyById.get(sc.boqItemId) ?? 0 : sc.quantity);
  }
  // Công tác chiết tính có 1 phần khối lượng giao thầu phụ: phần thầu phụ bao (vật tư / thiết bị / nhân công, hoặc từng dòng hao phí)
  // không tính vào chi phí của mình. Định mức từng dòng hao phí được nhân với phần khối lượng mình tự làm (baseQuantity giữ định mức gốc).
  const partials = new Map<string, typeof project.subcontractorItems>();
  for (const sc of project.subcontractorItems) if (sc.boqItemId && !sc.followBoq) partials.set(sc.boqItemId, [...(partials.get(sc.boqItemId) ?? []), sc]);
  for (const b of project.boqItems) {
    const ps = partials.get(b.id);
    if (!ps || b.method === "SUB" || !b.workItem || b.quantity <= 0) continue;
    for (const l of b.workItem.resources) {
      const covered = ps.filter((p) => subCovers(p, l)).reduce((s, p) => s + p.quantity, 0);
      // chép khối lượng đang hiển thị (làm tròn 2 số lẻ) vào ô giao thầu → lệch cỡ 1e-4: coi như giao đủ 100%, tránh phần tự làm ≈ 0,00000000000004
      let f = Math.max(0, 1 - covered / b.quantity);
      if (covered > 0 && Math.abs(b.quantity - covered) <= 0.005) f = 0;
      else if (f < 1e-9) f = 0;
      Object.assign(l, { baseQuantity: l.quantity, ownFactor: f });
      l.quantity = l.quantity * f;
    }
  }
  // Quy đổi ĐVT: BOQ của chủ đầu tư tính theo đơn vị khác với định mức (VD BOQ kg, định mức tấn) → nhân định mức từng dòng hao phí
  // (và giá cố định của công tác) với hệ số quy đổi để chi phí theo đúng 1 đơn vị BOQ. baseQuantity giữ định mức gốc để hiển thị.
  const unitFactors = new Map<string, number>();
  for (const b of project.boqItems) {
    if (b.isHeading || !b.workItem) continue;
    const f = unitFactor(b.rawUnit, b.workItem.unit);
    if (f === 1) continue;
    unitFactors.set(b.id, f);
    for (const l of b.workItem.resources) {
      const ex = l as typeof l & { baseQuantity?: number };
      ex.baseQuantity ??= l.quantity;
      l.quantity = l.quantity * f;
    }
    const w = b.workItem;
    if (w.fixedVT != null) w.fixedVT = w.fixedVT * f;
    if (w.fixedTB != null) w.fixedTB = w.fixedTB * f;
    if (w.fixedNC != null) w.fixedNC = w.fixedNC * f;
  }
  // Ghi đè "Tổng KL" của từng dòng hao phí cho riêng dòng BOQ (ô Tổng KL ở CHI TIẾT): định mức / đơn vị = Tổng KL ÷ (KL BOQ × (1 + hao hụt))
  // → CHI TIẾT, TH Vật Tư / Nhân Công / Thiết Bị, DT-CP đều theo số đã ghi đè; định mức chung không đổi.
  const lineQtys = await prisma.boqLineQty.findMany({ where: { projectId } });
  const qtyOverride = new Map<string, { total: number; formula: string }>();
  if (lineQtys.length > 0) {
    const byKey = new Map(lineQtys.map((q) => [`${q.boqItemId}:${q.lineId}`, q]));
    for (const b of project.boqItems) {
      if (b.isHeading || !b.workItem || b.quantity <= 0) continue;
      const uf = unitFactors.get(b.id) ?? 1;
      for (const l of b.workItem.resources) {
        const o = byKey.get(`${b.id}:${l.id}`);
        if (!o) continue;
        const total = o.formula ? (() => { const r = parseQtyWithKL(o.formula, b.quantity); return r.ok ? r.value : o.qty; })() : o.qty;
        const per = total / (b.quantity * (1 + (l.wastageRate || 0)));
        const ex = l as typeof l & { baseQuantity?: number; ownFactor?: number };
        l.quantity = per;
        if (ex.baseQuantity !== undefined) ex.baseQuantity = per / uf;
        if (ex.ownFactor !== undefined) ex.ownFactor = 1;
        qtyOverride.set(`${b.id}:${l.id}`, { total, formula: o.formula });
      }
    }
  }
  for (const r of aggregateResourceUsage(project.boqItems)) {
    if (r.category !== "VT") continue;
    formulaCtx.sources[`vtq:${r.resourceId}`] = r.totalQuantity;
    formulaCtx.options.push({ value: `vtq:${r.resourceId}`, label: `Tổng KL ${r.name} (${r.unit})`, group: VT_QTY_GROUP });
  }
  // % quản lý của ĐỘI THI CÔNG (TH Nhân Công, VtPlacement kind NC - cột mgmtVtPct): thành tiền nhân công = KL × đơn giá ×
  // (1 + % quản lý) → nhân thẳng vào đơn giá dùng tính toán, nên CHI TIẾT, đơn giá BOQ, TH Nhân Công, DT-CP đều gồm phí.
  // (Đối tượng tài nguyên có thể dùng chung giữa nhiều dòng - chỉ nhân 1 lần.) crewPct: % theo tài nguyên, để hiển thị.
  const crewPct = new Map(
    (await prisma.vtPlacement.findMany({ where: { projectId, kind: "NC", mgmtVtPct: { gt: 0 } } })).map((p) => [p.resourceId, p.mgmtVtPct])
  );
  if (crewPct.size > 0) {
    const done = new Set<object>();
    for (const b of project.boqItems)
      for (const l of b.workItem?.resources ?? []) {
        const pct = l.category === "NC" ? crewPct.get(l.resource.id) : undefined;
        if (!pct || done.has(l.resource)) continue;
        done.add(l.resource);
        l.resource.unitPrice *= 1 + pct / 100;
      }
  }

  // Chi phí quản lý vật tư / thiết bị TMN cấp cho thầu phụ (giao thầu phụ 1 phần việc, VD chỉ nhân công) = % × giá trị VT / TB
  // của các dòng hao phí thầu phụ KHÔNG bao, trên đúng khối lượng giao. % riêng của phần giao (SubcontractorItem.mgmtVtPct /
  // mgmtTbPct, sửa ở CHI TIẾT) hoặc mặc định theo NHÀ THẦU (SubcontractorNameToggle, nhập ở hộp giao thầu phụ). Cộng vào giá
  // trị phần giao (amount) → CHI TIẾT, đơn giá BOQ, TH Thầu Phụ (+VAT của dòng), DT-CP đều gồm phí; subMgmt giữ chi tiết để hiển
  // thị (có cả phần giao đang 0% nhưng TMN có cấp VT / TB, để người dùng nhập %). Phần việc riêng ngoài định mức không tính.
  const subMgmt = new Map<string, { fee: number; vtBase: number; tbBase: number; vtPct: number; tbPct: number; vtOwn: boolean; tbOwn: boolean }>();
  const rates = new Map((await prisma.subcontractorNameToggle.findMany({ where: { projectId } })).map((t) => [t.name.trim(), t]));
  {
    const boqById = new Map(project.boqItems.map((b) => [b.id, b]));
    for (const s of project.subcontractorItems) {
      const b = s.boqItemId ? boqById.get(s.boqItemId) : undefined;
      if (!b || s.followBoq || b.method === "SUB" || !b.workItem) continue;
      const lines = b.workItem.resources;
      if (!lines.some((l) => subCovers(s, l))) continue;
      const uf = unitFactors.get(b.id) ?? 1;
      let vt = 0;
      let tb = 0;
      for (const l of lines) {
        if (subCovers(s, l) || (l.category !== "VT" && l.category !== "TB")) continue;
        const perUnit = ((l as typeof l & { baseQuantity?: number }).baseQuantity ?? l.quantity) * uf * l.resource.unitPrice * (1 + (l.wastageRate || 0));
        if (l.category === "VT") vt += perUnit;
        else tb += perUnit;
      }
      const vtBase = vt * s.quantity;
      const tbBase = tb * s.quantity;
      if (vtBase <= 0 && tbBase <= 0) continue;
      const rt = rates.get(s.contractorName.trim());
      const vtPct = s.mgmtVtPct ?? rt?.mgmtVtPct ?? 0;
      const tbPct = s.mgmtTbPct ?? rt?.mgmtTbPct ?? 0;
      const fee = (vtBase * vtPct + tbBase * tbPct) / 100;
      subMgmt.set(s.id, { fee, vtBase, tbBase, vtPct, tbPct, vtOwn: s.mgmtVtPct != null, tbOwn: s.mgmtTbPct != null });
      s.amount += fee;
    }
  }
  // % Prelim của dòng thầu phụ (cột "% Prelim" ở TH Thầu Phụ): thành tiền (trước VAT) × (1 + %) → mọi nơi dùng amount (CHI TIẾT, DT-CP, TH) đều gồm Prelim
  for (const s of project.subcontractorItems) if (s.prelimPct) s.amount *= 1 + s.prelimPct / 100;
  return Object.assign(project, { formulaCtx, projectResources, lineSwaps, unitFactors, subMgmt, crewPct, qtyOverride });
}

export async function getAllResources() {
  return prisma.resource.findMany({
    where: { projectId: null }, // không gồm vật liệu riêng của từng dự án
    select: { id: true, code: true, name: true, unit: true, sourceType: true, unitPrice: true },
    orderBy: [{ sourceType: "asc" }, { name: "asc" }],
  });
}

// res: tên các hao phí trong định mức (ngăn cách " | ") - ô tìm định mức tìm được cả theo vật tư bên trong
// (VD "Dulux", "Weber", "gạch 600x600" chỉ có trong tên vật tư, không có trong tên định mức)
export async function getCatalogForPicker() {
  const rows = await prisma.workItem.findMany({
    where: { active: true },
    select: { id: true, code: true, name: true, unit: true, section: true, subsection: true, resources: { select: { resource: { select: { name: true } } } } },
    orderBy: [{ section: "asc" }, { subsection: "asc" }, { name: "asc" }],
  });
  return rows.map(({ resources, section, ...w }) => ({ ...w, section, manual: section === "BỔ SUNG THỦ CÔNG", res: [...new Set(resources.map((l) => l.resource.name))].join(" | ") }));
}
