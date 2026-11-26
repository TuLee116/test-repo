// Bật "nhân công đặt tên theo công việc BOQ" cho MỌI dự án đang có (dự án mới đã mặc định bật) và gán
// tên nhân công. Chạy lại bao nhiêu lần cũng được. Tổng chi phí nhân công không đổi (đơn giá gộp lấy
// bình quân gia quyền theo khối lượng - xem src/lib/labor-sync.ts); tắt lại từng dự án ở TH Nhân Công.
//   npx tsx --env-file=.env scripts/enable-labor-all.ts
import { prisma } from "@/lib/prisma";
import { syncLaborByWork } from "@/lib/labor-sync";

async function main() {
  const projects = await prisma.project.findMany({ select: { id: true, name: true, packageName: true, laborByWork: true } });
  for (const p of projects) {
    if (!p.laborByWork) await prisma.project.update({ where: { id: p.id }, data: { laborByWork: true } });
    console.log(`${p.name} / ${p.packageName}:`, await syncLaborByWork(p.id));
  }
}
main().finally(() => prisma.$disconnect());
