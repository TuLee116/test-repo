// Đồng bộ lại nhân công theo công việc BOQ cho mọi dự án đang bật (VD sau khi đổi quy tắc đặt tên nhân
// công - 27/10/2026 giữ kích thước "dày / cao..." trong tên → tách các nhân công đang gộp nhầm).
// Chạy: npx tsx --env-file=.env scripts/resync-labor.ts
import { prisma } from "../src/lib/prisma";
import { syncLaborByWork } from "../src/lib/labor-sync";

async function main() {
  const projects = await prisma.project.findMany({ where: { laborByWork: true }, select: { id: true, name: true } });
  for (const p of projects) {
    const r = await syncLaborByWork(p.id);
    console.log(`[resync-labor] ${p.name}: tạo ${r.created}, gán ${r.assigned}`);
  }
}
main().catch((e) => {
  console.error("[resync-labor]", e);
  process.exit(1);
});
