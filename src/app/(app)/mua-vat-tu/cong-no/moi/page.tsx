import { prisma } from "@/lib/prisma";
import { can, fmtDate, getProcUser } from "@/lib/proc";
import { unbilledReceiptLines } from "@/lib/proc-tasks";
import PayableCreator from "./PayableCreator";

export default async function NewPayablePage({ searchParams }: { searchParams: Promise<{ project?: string; supplier?: string }> }) {
  const sp = await searchParams;
  const u = (await getProcUser())!;
  if (!can(u, "CBVT")) return <p className="text-sm text-red-600">Chỉ cán bộ vật tư được lên công nợ.</p>;
  if (!sp.project || !sp.supplier) return <p className="text-sm text-slate-500">Chọn dự án + nhà cung cấp từ trang Công nợ NCC.</p>;
  const [project, supplier, lines] = await Promise.all([
    prisma.project.findUnique({ where: { id: sp.project }, select: { name: true, packageName: true } }),
    prisma.supplier.findUnique({ where: { id: sp.supplier }, select: { name: true } }),
    unbilledReceiptLines(u, { projectId: sp.project, supplierId: sp.supplier }),
  ]);
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">
        Lên công nợ đợt — {supplier?.name} · {project?.name}
        {project?.packageName && ` — ${project.packageName}`}
      </h2>
      <PayableCreator
        projectId={sp.project}
        supplierId={sp.supplier}
        lines={lines.map((l) => ({
          id: l.id,
          receiptCode: l.receipt.code,
          receivedDate: fmtDate(l.receipt.receivedDate),
          deliveryNoteNo: l.receipt.deliveryNoteNo,
          orderCode: l.item.order.code,
          name: l.item.name,
          unit: l.item.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
          amount: l.amount,
        }))}
      />
    </div>
  );
}
