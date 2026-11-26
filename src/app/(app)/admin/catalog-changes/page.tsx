import { canDtcp } from "@/lib/access";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import ChangeReview from "./ChangeReview";

export default async function CatalogChangesPage() {
  if (!(await canDtcp("NORM_REVIEW"))) redirect("/projects");

  const [pending, done] = await Promise.all([
    prisma.catalogChange.findMany({ where: { reviewed: false }, orderBy: { createdAt: "asc" } }),
    prisma.catalogChange.findMany({ where: { reviewed: true }, orderBy: { reviewedAt: "desc" }, take: 20 }),
  ]);

  const allIds = [...pending, ...done].flatMap((c) => c.resourceIds.split(",").filter(Boolean));
  const resources = await prisma.resource.findMany({
    where: { id: { in: allIds } },
    select: { id: true, code: true, name: true, unit: true, sourceType: true },
  });
  const byId = new Map(resources.map((r) => [r.id, r]));
  const workItems = await prisma.workItem.findMany({
    where: { id: { in: [...pending, ...done].map((c) => c.workItemId) } },
    select: { id: true, code: true, name: true, unit: true },
  });
  const wiById = new Map(workItems.map((w) => [w.id, w]));
  // loại "thêm dòng hao phí": lấy các dòng đã thêm để quản trị viên xem
  const lineIds = pending.flatMap((c) => (c.kind === "LINES" || c.kind === "REMOVE" ? c.lineIds.split(",").filter(Boolean) : []));
  const addedLines = await prisma.workItemResource.findMany({ where: { id: { in: lineIds } }, include: { resource: { select: { code: true, name: true, unit: true } } } });
  const lineById = new Map(addedLines.map((l) => [l.id, { category: l.category as string, code: l.resource.code, name: l.resource.name, unit: l.resource.unit, quantity: l.quantity }]));
  const usage = await prisma.boqItem.groupBy({ by: ["workItemId"], where: { workItemId: { in: pending.map((c) => c.workItemId) } }, _count: { _all: true } });
  const usedBy = new Map(usage.map((u) => [u.workItemId, u._count._all]));

  // gom theo người thêm để admin thấy ai thêm bao nhiêu
  const byUser = new Map<string, { count: number; res: number }>();
  for (const c of pending) {
    const cur = byUser.get(c.userName) ?? { count: 0, res: 0 };
    cur.count++;
    cur.res += c.resourceIds.split(",").filter(Boolean).length;
    byUser.set(c.userName, cur);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Duyệt định mức do người dùng thêm</h1>
        <p className="mt-1 text-sm text-slate-500">
          Người dùng tự thêm định mức / vật tư / nhân công / máy mới, hoặc thêm dòng hao phí vào định mức có sẵn, mỗi người có thể đặt mã một kiểu. Quản trị viên kiểm tra và sửa mã cho thống nhất, rồi bấm &quot;Lưu &amp; xác nhận&quot;.
        </p>
      </div>

      {pending.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Đang chờ duyệt <b>{pending.length}</b> định mức mới —{" "}
          {[...byUser.entries()].map(([u, v]) => `${u}: ${v.count} định mức, ${v.res} vật tư/nhân công/máy mới`).join(" · ")}
        </div>
      )}

      <section className="space-y-3">
        {pending.length === 0 && <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">Không có định mức nào đang chờ duyệt.</p>}
        {pending.map((c) => (
          <ChangeReview
            key={c.id}
            change={{ id: c.id, userName: c.userName, createdAt: c.createdAt.toLocaleString("vi-VN"), workItemName: wiById.get(c.workItemId)?.name ?? c.workItemName, workItemUnit: wiById.get(c.workItemId)?.unit ?? "", workItemCode: wiById.get(c.workItemId)?.code ?? c.workItemCode }}
            resources={c.resourceIds.split(",").filter(Boolean).map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r)}
            usedInBoq={usedBy.get(c.workItemId) ?? 0}
            kind={c.kind === "LINES" || c.kind === "REMOVE" ? c.kind : "NORM"}
            requestReason={c.kind === "REMOVE" ? c.rejectReason : ""}
            addedLines={c.lineIds.split(",").filter(Boolean).map((id) => lineById.get(id)).filter((l): l is NonNullable<typeof l> => !!l)}
          />
        ))}
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-slate-700">Đã xử lý gần đây</h2>
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
            {done.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-slate-600">
                <span>
                  {c.kind === "LINES" && <span className="mr-1 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] text-sky-700">Thêm dòng hao phí</span>}
                  {c.kind === "REMOVE" && <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700">Đề nghị xoá dòng hao phí</span>}
                  <b className="text-slate-800">{c.workItemCode}</b> — {c.workItemName} <span className="text-slate-400">(thêm bởi {c.userName})</span>
                </span>
                <span className="text-xs text-slate-400">
                  {c.rejected ? <b className="mr-1 rounded bg-red-100 px-1.5 py-0.5 text-red-700">Không duyệt</b> : <b className="mr-1 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">Đã duyệt</b>}
                  {c.rejected && c.rejectReason ? `Lý do: ${c.rejectReason} · ` : ""}bởi {c.reviewedByName} · {c.reviewedAt?.toLocaleString("vi-VN")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
