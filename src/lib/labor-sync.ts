import { prisma } from "@/lib/prisma";
import { nextTmnCode } from "@/lib/resource-code";
import { laborNameFromBoq } from "@/lib/labor-names";
import { jaccard, tokenSet } from "@/lib/boq-match";
import { normalizeText } from "@/lib/text-normalize";
import { unitFactor } from "@/lib/unit-convert";

function groupBy<T>(list: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

// Nhân công theo công việc BOQ (Project.laborByWork): vật tư/thiết bị vẫn theo định mức, riêng dòng
// nhân công CHÍNH của mỗi công tác được đổi sang 1 "nhân công riêng của dự án" đặt tên theo mô tả BOQ
// (dùng lại cơ chế đổi tài nguyên theo dòng BoqLineResourceSwap - nên TH Nhân Công, đơn giá, DT-CP,
// xuất Excel tự chạy đúng). Các dòng BOQ cùng tên + cùng ĐVT dùng chung 1 nhân công → TH Nhân Công
// gộp 1 dòng, nhập đơn giá 1 lần. Dòng nhân công phụ (định mức có 2-3 dòng NC) giữ tên cũ.
export const LABOR_GROUP = "Nhân công theo công việc";

const laborKey = (name: string, unit: string) => `${normalizeText(name)}|${normalizeText(unit)}`;

type NcLine = { id: string; category: string; resource: { id: string; name: string; unit: string; unitPrice: number } };

// Dòng nhân công chính = dòng có tên gần với tên công tác nhất (VD trần thạch cao: "trần chìm khung
// xương" là chính, "xử lý mối nối" là phụ)
export function mainLaborLine<T extends NcLine>(workItemName: string, lines: T[]): T | null {
  const nc = lines.filter((l) => l.category === "NC");
  if (nc.length <= 1) return nc[0] ?? null;
  const w = tokenSet(normalizeText(workItemName));
  return nc.reduce((best, l) => (jaccard(w, tokenSet(normalizeText(l.resource.name))) > jaccard(w, tokenSet(normalizeText(best.resource.name))) ? l : best));
}

// Gán tên nhân công cho mọi dòng BOQ chưa có (giữ nguyên dòng người dùng đã tự chọn/đổi tên). Chạy
// lại bao nhiêu lần cũng được - gọi sau mỗi thao tác có thể thêm/đổi công tác (nhập/cập nhật BOQ, gán mã...).
export async function syncLaborByWork(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      laborByWork: true,
      resourcePrices: true,
      boqItems: {
        where: { isHeading: false, workItemId: { not: null } },
        select: { id: true, rawDescription: true, rawUnit: true, quantity: true, method: true, workItem: { select: { name: true, unit: true, resources: { select: { id: true, category: true, quantity: true, resource: true } } } } },
      },
    },
  });
  if (!project?.laborByWork) return { created: 0, assigned: 0 };

  const [swaps, ownLabor] = await Promise.all([
    prisma.boqLineResourceSwap.findMany({ where: { projectId } }),
    prisma.resource.findMany({ where: { projectId, sourceType: "NC" } }),
  ]);
  const swapKey = new Set(swaps.map((s) => `${s.boqItemId}:${s.lineId}`));
  const byKey = new Map(ownLabor.map((r) => [laborKey(r.name, r.unit), r]));
  const priceOf = new Map(project.resourcePrices.map((p) => [p.resourceId, p.unitPrice / (1 + p.vatRate)]));

  // Dòng đổi tài nguyên còn trỏ tới dòng định mức không còn thuộc công tác hiện tại (đã đổi mã) → bỏ
  const lineIdsOf = new Map(project.boqItems.map((b) => [b.id, new Set(b.workItem!.resources.map((l) => l.id))]));
  const stale = swaps.filter((s) => lineIdsOf.has(s.boqItemId) && !lineIdsOf.get(s.boqItemId)!.has(s.lineId)).map((s) => s.id);
  if (stale.length) await prisma.boqLineResourceSwap.deleteMany({ where: { id: { in: stale } } });

  // Tên tự đặt theo quy tắc cũ (chưa giữ kích thước dày / cao...) đang gộp nhiều công việc khác kích thước vào 1
  // nhân công (VD "Cán nền" cho cả dày 20/30/40mm) → tách theo tên mới. Chỉ tách tên phần mềm tự đặt (bỏ kích
  // thước / đường kính - quy tắc cũ - thì trùng y tên đang dùng) - tên người dùng đã tự sửa giữ nguyên. Nhân công mới mang sẵn đơn giá
  // (+ VAT, công thức giá, vị trí ở TH Nhân Công) của nhân công đang gộp → tổng chi phí không đổi.
  const boqById = new Map(project.boqItems.map((b) => [b.id, b]));
  const ownById = new Map(ownLabor.map((r) => [r.id, r]));
  for (const sw of swaps) {
    if (stale.includes(sw.id)) continue;
    const cur = ownById.get(sw.resourceId);
    const b = boqById.get(sw.boqItemId);
    if (!cur || cur.groupLabel !== LABOR_GROUP || !b?.workItem) continue;
    const desc = b.rawDescription || b.workItem.name;
    const name = laborNameFromBoq(desc);
    if (normalizeText(name) === normalizeText(cur.name) || normalizeText(laborNameFromBoq(desc, false)) !== normalizeText(cur.name)) continue;
    const key = laborKey(name, cur.unit);
    let target = byKey.get(key);
    if (!target) {
      target = await prisma.resource.create({
        data: { code: await nextTmnCode(), name, unit: cur.unit, unitPrice: cur.unitPrice, sourceType: "NC", groupLabel: LABOR_GROUP, projectId },
      });
      const price = project.resourcePrices.find((x) => x.resourceId === cur.id);
      if (price) await prisma.projectResourcePrice.create({ data: { projectId, resourceId: target.id, unitPrice: price.unitPrice, vatRate: price.vatRate } });
      const f = await prisma.fieldFormula.findUnique({ where: { projectId_kind_targetId_field: { projectId, kind: "price", targetId: cur.id, field: "unitPrice" } } });
      if (f) await prisma.fieldFormula.create({ data: { projectId, kind: "price", targetId: target.id, field: "unitPrice", formula: f.formula } });
      const pl = await prisma.vtPlacement.findUnique({ where: { projectId_resourceId_kind: { projectId, resourceId: cur.id, kind: "NC" } } });
      if (pl) await prisma.vtPlacement.create({ data: { projectId, resourceId: target.id, kind: "NC", section: pl.section, groupId: pl.groupId, orderIndex: pl.orderIndex, note: pl.note } });
      byKey.set(key, target);
    }
    await prisma.boqLineResourceSwap.update({ where: { id: sw.id }, data: { resourceId: target.id } });
  }

  // Lượt 1: tên nhân công cho từng dòng BOQ chưa có. Lượt 2: tạo tên mới - đơn giá ban đầu = bình quân gia
  // quyền theo khối lượng của nhân công gốc các dòng gộp vào (tổng chi phí không đổi khi chuyển), hoặc giá
  // đã nhập ở dự án khác cùng tên nếu có.
  const pending: { boqItemId: string; lineId: string; key: string; name: string; unit: string; fromId: string; qty: number; price: number }[] = [];
  for (const b of project.boqItems) {
    if (b.method === "SUB" || !b.workItem) continue;
    const line = mainLaborLine(b.workItem.name, b.workItem.resources);
    if (!line || swapKey.has(`${b.id}:${line.id}`)) continue;
    const name = laborNameFromBoq(b.rawDescription || b.workItem.name);
    const qty = b.quantity * line.quantity * unitFactor(b.rawUnit, b.workItem.unit);
    const price = priceOf.get(line.resource.id) ?? line.resource.unitPrice;
    pending.push({ boqItemId: b.id, lineId: line.id, key: laborKey(name, line.resource.unit), name, unit: line.resource.unit, fromId: line.resource.id, qty, price });
  }

  let created = 0;
  for (const [key, items] of groupBy(pending, (x) => x.key)) {
    if (byKey.has(key)) continue;
    const { name, unit, fromId } = items[0];
    const totalQty = items.reduce((s, x) => s + x.qty, 0);
    const avg = totalQty > 0 ? items.reduce((s, x) => s + x.qty * x.price, 0) / totalQty : items[0].price;
    const unitPrice = (await historicalLaborPrice(projectId, name, unit)) ?? Math.round(avg * 100) / 100;
    const target = await prisma.resource.create({
      data: { code: await nextTmnCode(), name, unit, unitPrice, sourceType: "NC", groupLabel: LABOR_GROUP, projectId },
    });
    // giữ vị trí (mục lớn / đầu mục) mà nhân công gốc đang nằm ở TH Nhân Công
    const pl = await prisma.vtPlacement.findUnique({ where: { projectId_resourceId_kind: { projectId, resourceId: fromId, kind: "NC" } } });
    if (pl) await prisma.vtPlacement.create({ data: { projectId, resourceId: target.id, kind: "NC", section: pl.section, groupId: pl.groupId, orderIndex: pl.orderIndex } });
    byKey.set(key, target);
    created++;
  }
  if (pending.length)
    await prisma.boqLineResourceSwap.createMany({ data: pending.map((x) => ({ projectId, boqItemId: x.boqItemId, lineId: x.lineId, resourceId: byKey.get(x.key)!.id })) });
  const assigned = pending.length;
  return { created, assigned };
}

// Đơn giá nhân công cùng tên đã nhập ở dự án khác (mới nhất) - dần thành thư viện giá khoán của công ty
async function historicalLaborPrice(projectId: string, name: string, unit: string): Promise<number | null> {
  const norm = normalizeText(name);
  const others = await prisma.resource.findMany({
    where: { sourceType: "NC", groupLabel: LABOR_GROUP, projectId: { not: projectId }, unit },
    include: { projectOverrides: true },
    orderBy: { updatedAt: "desc" },
  });
  for (const r of others) {
    if (normalizeText(r.name) !== norm) continue;
    const ov = r.projectOverrides.find((p) => p.projectId === r.projectId);
    return ov ? ov.unitPrice / (1 + ov.vatRate) : r.unitPrice;
  }
  return null;
}

// Tắt chế độ: bỏ các dòng đổi sang nhân công theo công việc → về lại nhân công của định mức
export async function clearLaborByWork(projectId: string) {
  const ids = (await prisma.resource.findMany({ where: { projectId, sourceType: "NC", groupLabel: LABOR_GROUP }, select: { id: true } })).map((r) => r.id);
  await prisma.boqLineResourceSwap.deleteMany({ where: { projectId, resourceId: { in: ids } } });
}
