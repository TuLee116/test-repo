import { prisma } from "@/lib/prisma";
import { getProjectWithBoq } from "@/lib/project-data";
import { loadSheet } from "@/lib/tonghop";

export type BudgetRow = {
  resourceId: string;
  code: string;
  name: string;
  unit: string;
  boqQty: number;
  requested: number;
  amountVat: number; // thành tiền theo DT-CP (TH Vật Tư, gồm VAT)
  unitPriceVat: number; // đơn giá theo DT-CP gồm VAT = thành tiền / KL
  // KL tham chiếu BCH đã nhập ở phiếu đề nghị gần nhất của vật tư này (tự điền sẵn khi thêm vào phiếu mới)
  last: { contractQty: number | null; finalQty: number | null; forecastQty: number | null };
};

// Khối lượng vật tư theo BOQ (sheet TH Vật Tư của dự án) + tổng đã đề nghị ở các phiếu khác (trừ phiếu bị trả lại),
// để BCH đối chiếu khi lập đề nghị mua từng đợt.
export async function getMaterialBudget(projectId: string, excludeRequestId?: string): Promise<BudgetRow[]> {
  const project = await getProjectWithBoq(projectId);
  if (!project) return [];
  const { rows } = await loadSheet(project, "VT");
  const reqItems = await prisma.materialRequestItem.findMany({
    where: { resourceId: { not: null }, request: { projectId, status: { not: "REJECTED" }, ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}) } },
    select: { resourceId: true, quantity: true, contractQty: true, finalQty: true, forecastQty: true },
    orderBy: { request: { createdAt: "asc" } },
  });
  const requested = new Map<string, number>();
  const last = new Map<string, BudgetRow["last"]>();
  for (const r of reqItems) {
    requested.set(r.resourceId!, (requested.get(r.resourceId!) ?? 0) + r.quantity);
    const prev = last.get(r.resourceId!);
    last.set(r.resourceId!, {
      contractQty: r.contractQty ?? prev?.contractQty ?? null,
      finalQty: r.finalQty ?? prev?.finalQty ?? null,
      forecastQty: r.forecastQty ?? prev?.forecastQty ?? null,
    });
  }
  return rows
    .filter((r) => !r.manual)
    .map((r) => ({
      resourceId: r.resourceId,
      code: r.code,
      name: r.name,
      unit: r.unit,
      boqQty: r.qty,
      requested: requested.get(r.resourceId) ?? 0,
      amountVat: r.amountVat,
      unitPriceVat: r.qty > 0 ? r.amountVat / r.qty : 0,
      last: last.get(r.resourceId) ?? { contractQty: null, finalQty: null, forecastQty: null },
    }));
}

// Thông tin đầu phiếu (số HĐ, hạng mục, khu vực) của phiếu đề nghị gần nhất trong dự án → điền sẵn cho phiếu mới;
// batchNo = "Đợt số" trên Giấy đề xuất (thứ tự phiếu trong dự án, không tính phiếu bị trả lại). current = phiếu đang sửa.
export async function getRequestDefaults(projectId: string, current?: { id: string; createdAt: Date }) {
  const [r, earlier] = await Promise.all([
    prisma.materialRequest.findFirst({ where: { projectId, ...(current ? { id: { not: current.id } } : {}) }, orderBy: { createdAt: "desc" }, select: { contractNo: true, category: true, area: true } }),
    prisma.materialRequest.count({ where: { projectId, status: { not: "REJECTED" }, ...(current ? { createdAt: { lt: current.createdAt }, id: { not: current.id } } : {}) } }),
  ]);
  return { contractNo: r?.contractNo ?? "", category: r?.category ?? "", area: r?.area ?? "", batchNo: earlier + 1 };
}
