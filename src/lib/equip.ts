import { prisma } from "@/lib/prisma";
import { EQUIP_SEED, maxSupplierPrice } from "@/lib/equip-catalog";
import { computeEquip, EQUIP_KINDS, parseParams, type EquipKind, type PriceItem } from "@/lib/equip-calc";

// Danh mục cấu kiện thiết bị (dùng chung). Bảng trống → nạp danh mục mặc định theo file khái toán mẫu.
export type EquipItemRow = PriceItem & {
  id: string;
  category: string;
  supplierPrices: Record<string, number>;
  priceManual: boolean;
  updatedAt: string;
  updatedBy: string;
};

export async function loadEquipCatalog(): Promise<EquipItemRow[]> {
  // nạp các cấu kiện của danh mục mặc định chưa có (lần đầu: cả danh mục; về sau: cấu kiện mới bổ sung), giữ nguyên giá đã sửa
  const have = new Set((await prisma.equipItem.findMany({ select: { code: true } })).map((x) => x.code));
  const missing = EQUIP_SEED.map((e, i) => ({ e, i })).filter(({ e }) => !have.has(e.code));
  if (missing.length) {
    await prisma.equipItem.createMany({
      data: missing.map(({ e, i }) => {
        const max = e.suppliers ? maxSupplierPrice(e.suppliers) : null;
        return {
          code: e.code,
          name: e.name,
          unit: e.unit,
          category: e.category,
          mode: e.mode,
          weight: e.weight ?? 0,
          supplierPrices: JSON.stringify(e.suppliers ?? {}),
          price: max ?? e.price ?? 0,
          priceManual: max == null,
          buyPrice: e.buyPrice ?? 0,
          lossPct: e.lossPct ?? 0,
          orderIndex: i,
          updatedBy: "Mặc định (file khái toán mẫu)",
        };
      }),
    });
  }
  const rows = await prisma.equipItem.findMany({ orderBy: { orderIndex: "asc" } });
  return rows.map((r) => {
    let sp: Record<string, number> = {};
    try {
      sp = JSON.parse(r.supplierPrices);
    } catch {}
    return { id: r.id, code: r.code, name: r.name, unit: r.unit, category: r.category, mode: r.mode, weight: r.weight, price: r.price, buyPrice: r.buyPrice, lossPct: r.lossPct, supplierPrices: sp, priceManual: r.priceManual, updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy };
  });
}

// Đầu mục lớn (mục B) của bản tính ở 1 sheet tổng hợp: dùng lại nếu còn, không thì tạo mới cùng tên bản tính
async function ensureGroup(projectId: string, kind: "TB" | "NC", id: string | null, name: string): Promise<string> {
  const found = id && (await prisma.vtGroup.findFirst({ where: { id, projectId, kind } }))?.id;
  if (found) return found;
  const max = await prisma.vtGroup.aggregate({ where: { projectId, kind, section: "B" }, _max: { orderIndex: true } });
  return (await prisma.vtGroup.create({ data: { projectId, kind, section: "B", name: name.toUpperCase(), orderIndex: (max._max.orderIndex ?? -1) + 1 } })).id;
}

// Tính 1 bản tính theo đơn giá hiện hành rồi ghi kết quả: thiết bị / vật tư / vận chuyển / hao hụt → TH Thiết Bị, nhân công
// → TH Nhân Công; mỗi bên 1 đầu mục lớn riêng (mục B) cùng tên bản tính, mỗi dòng = 1 dòng tự thêm (SheetManualItem có calcId).
// Dòng thuê lưu đơn giá đ/ngày + số ngày thuê (thành tiền = SL × đơn giá × số ngày). Tính lại = thay toàn bộ dòng cũ của
// bản tính (giữ VAT % đã đặt theo tên dòng).
export async function applyEquipCalc(calcId: string): Promise<{ rows: number; total: number }> {
  const calc = await prisma.equipCalc.findUnique({ where: { id: calcId } });
  if (!calc) throw new Error("Không tìm thấy bản tính");
  const pid = calc.projectId;
  const kind = calc.kind as EquipKind;
  const result = computeEquip(kind, parseParams(kind, calc.params), await loadEquipCatalog());
  const labor = result.lines.filter((l) => l.type === "labor");
  const equip = result.lines.filter((l) => l.type !== "labor");

  const groupId = await ensureGroup(pid, "TB", calc.groupId, calc.name);
  const ncGroupId = labor.length ? await ensureGroup(pid, "NC", calc.ncGroupId, calc.name) : calc.ncGroupId;
  const old = await prisma.sheetManualItem.findMany({ where: { projectId: pid, calcId }, select: { id: true, kind: true, name: true, vatRate: true } });
  const vatOf = new Map(old.map((o) => [`${o.kind}:${o.name}`, o.vatRate]));
  const order: Record<"TB" | "NC", number> = { TB: 0, NC: 0 };
  for (const k of ["TB", "NC"] as const) order[k] = ((await prisma.sheetManualItem.aggregate({ where: { projectId: pid, kind: k }, _max: { orderIndex: true } }))._max.orderIndex ?? -1) + 1;
  const row = (l: (typeof result.lines)[number], k: "TB" | "NC", gid: string | null) => {
    const qty = Math.round(l.qty * 1e4) / 1e4;
    const rent = l.mode === "RENT" && l.days !== undefined;
    return {
      projectId: pid,
      kind: k,
      groupId: gid,
      calcId,
      name: l.name,
      unit: l.unit,
      quantity: qty,
      unitPrice: rent ? (l.rate ?? 0) : qty ? l.amount / qty : 0,
      days: rent ? l.days : null,
      vatRate: vatOf.get(`${k}:${l.name}`) ?? 0,
      note: l.note,
      orderIndex: order[k]++,
    };
  };
  await prisma.$transaction([
    prisma.fieldFormula.deleteMany({ where: { projectId: pid, kind: "manual", targetId: { in: old.map((o) => o.id) } } }),
    prisma.sheetManualItem.deleteMany({ where: { projectId: pid, calcId } }),
    prisma.sheetManualItem.createMany({ data: [...equip.map((l) => row(l, "TB", groupId)), ...labor.map((l) => row(l, "NC", ncGroupId ?? null))] }),
    prisma.equipCalc.update({ where: { id: calcId }, data: { groupId, ncGroupId } }),
  ]);
  return { rows: result.lines.length, total: result.total };
}

export const equipKindTitle = (kind: string) => EQUIP_KINDS.find((k) => k.kind === kind)?.title ?? kind;
