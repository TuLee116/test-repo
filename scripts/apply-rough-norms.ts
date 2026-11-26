// Áp định mức chuẩn PHẦN THÔ (src/lib/rough-norms.ts) cho các dòng BOQ đang có của 1 dự án: dòng nào
// quy tắc chọn được mã chuẩn mà đang gán mã khác (hoặc chưa gán) thì đổi sang mã chuẩn. Giữ nguyên dòng
// người dùng đã tự xác nhận mã và dòng có phần giao thầu phụ riêng lẻ (đang tham chiếu dòng hao phí cũ).
//   npx tsx --env-file=.env scripts/apply-rough-norms.ts <projectId> [--dry]
//   npx tsx --env-file=.env scripts/apply-rough-norms.ts --all-labor [--dry]   (mọi dự án đang bật nhân công theo công việc)
import { prisma } from "@/lib/prisma";
import { createMatcher } from "@/lib/boq-match";
import { syncLaborByWork } from "@/lib/labor-sync";

async function main() {
  const dry = process.argv.includes("--dry");
  const ids = process.argv.includes("--all-labor")
    ? (await prisma.project.findMany({ where: { laborByWork: true }, select: { id: true } })).map((p) => p.id)
    : process.argv.slice(2).filter((a) => !a.startsWith("--"));
  for (const id of ids) await applyTo(id, dry);
}

async function applyTo(projectId: string, dry: boolean) {
  const catalog = await prisma.workItem.findMany({ where: { active: true }, select: { id: true, code: true, name: true, unit: true } });
  const matcher = createMatcher(catalog, await prisma.workItemAlias.findMany());
  const rows = await prisma.boqItem.findMany({ where: { projectId, isHeading: false }, include: { workItem: true }, orderBy: { orderIndex: "asc" } });
  const partial = new Set((await prisma.subcontractorItem.findMany({ where: { projectId, followBoq: false, boqItemId: { not: null } } })).map((s) => s.boqItemId));
  let changed = 0;
  for (const b of rows) {
    if (partial.has(b.id)) continue;
    const m = matcher.match(b.rawDescription, b.rawUnit);
    if (m.matchType !== "rule" || m.workItemId === b.workItemId) continue;
    const to = matcher.byId.get(m.workItemId!)!;
    console.log(`[${b.stt}] ${b.workItem?.code ?? "(chưa có)"} → ${to.code}  ${b.rawDescription.split("\n")[0].slice(0, 70)}`);
    if (!dry) await prisma.boqItem.update({ where: { id: b.id }, data: { workItemId: to.id } });
    changed++;
  }
  if (!dry) console.log("nhân công:", await syncLaborByWork(projectId));
  console.log({ doiMa: changed, dry });
}
main().finally(() => prisma.$disconnect());
