// Tạo / cập nhật bộ định mức chuẩn PHẦN THÔ (src/lib/rough-norms.ts) và ẩn các định mức phần thô cũ
// chia theo tầng (cốt thép, bê tông thương phẩm, ván khuôn AF.81xxx) khỏi gợi ý/tìm kiếm. Định mức cũ
// KHÔNG bị xoá - dự án đang dùng vẫn tính như cũ. Danh sách mã đã ẩn ghi ra
// data/rough-norms-deactivated.json để khôi phục nếu cần (chạy với --restore).
//   npx tsx --env-file=.env scripts/seed-rough-norms.ts            (tạo + ẩn)
//   npx tsx --env-file=.env scripts/seed-rough-norms.ts --restore  (hiện lại các mã đã ẩn)
// Chạy lại sau mỗi lần `npm run db:refresh` (nạp lại danh mục từ Excel).
import fs from "fs";
import { prisma } from "@/lib/prisma";
import { LEGACY_ROUGH_PREFIXES, ROUGH_RESOURCES, legacyConcreteCode, roughNorms } from "@/lib/rough-norms";
import { extractFeatures } from "@/lib/boq-match";

const LIST = "data/rough-norms-deactivated.json";
const SECTION = "PHẦN THÔ (định mức chuẩn)"; // đánh dấu định mức do bộ chuẩn tạo (mã có thể trùng mã cũ của công ty)

async function restore() {
  const codes: string[] = JSON.parse(fs.readFileSync(LIST, "utf8"));
  const r = await prisma.workItem.updateMany({ where: { code: { in: codes } }, data: { active: true } });
  console.log("Đã hiện lại", r.count, "định mức");
}

async function main() {
  if (process.argv.includes("--restore")) return restore();

  for (const r of ROUGH_RESOURCES) {
    const ex = await prisma.resource.findUnique({ where: { code: r.code } });
    if (!ex) await prisma.resource.create({ data: { ...r, groupLabel: "Định mức chuẩn phần thô" } });
  }
  const resByCode = new Map((await prisma.resource.findMany({ where: { projectId: null } })).map((r) => [r.code, r]));

  // Mã bê tông kiểu cũ "AF.32310-M350" → "AF.32316": đổi mã tại chỗ (giữ id → dòng BOQ đang dùng tự theo mã mới)
  for (const w of await prisma.workItem.findMany({ where: { section: SECTION, code: { contains: "-M" } } })) {
    const to = legacyConcreteCode(w.code);
    if (to && !(await prisma.workItem.findFirst({ where: { code: to, section: SECTION } }))) await prisma.workItem.update({ where: { id: w.id }, data: { code: to } });
  }
  let created = 0;
  const newIds = new Set<string>();
  for (const n of roughNorms()) {
    const missing = n.lines.filter((l) => !resByCode.has(l.resource)).map((l) => l.resource);
    if (missing.length) throw new Error(`${n.code}: thiếu tài nguyên ${missing.join(", ")}`);
    const ex = await prisma.workItem.findFirst({ where: { code: n.code, section: SECTION } });
    if (ex) {
      // giữ nguyên các dòng hao phí (id dòng đang được dự án tham chiếu khi đổi tên nhân công / giao thầu phụ)
      await prisma.workItem.update({ where: { id: ex.id }, data: { name: n.name, unit: n.unit, active: true } });
      newIds.add(ex.id);
      continue;
    }
    const w = await prisma.workItem.create({
      data: {
        code: n.code,
        name: n.name,
        unit: n.unit,
        section: SECTION,
        subsection: n.subsection,
        resources: { create: n.lines.map((l) => ({ category: l.category, resourceId: resByCode.get(l.resource)!.id, quantity: l.quantity, wastageRate: l.wastage })) },
      },
    });
    newIds.add(w.id);
    created++;
  }

  const newCodes = new Set(roughNorms().map((n) => n.code));
  // Ẩn định mức phần thô cũ: cốt thép, bê tông thương phẩm (có dòng vật tư BTMxxx), ván khuôn AF.81xxx
  const old = await prisma.workItem.findMany({ where: { active: true }, include: { resources: { include: { resource: true } } } });
  const hide = old.filter((w) => {
    if (newIds.has(w.id)) return false;
    if (LEGACY_ROUGH_PREFIXES.some((p) => w.code.startsWith(p))) return true; // bộ chuẩn phiên trước (mã TMN.*)
    if (newCodes.has(w.code)) return true; // định mức cũ trùng mã với bộ chuẩn mới
    if (w.section === SECTION && !newCodes.has(w.code)) return true; // định mức chuẩn không còn trong bộ (VD bê tông M550/M600)
    const t = extractFeatures(w.name, w.unit).type;
    if (t === "cot_thep") return true;
    if (t === "be_tong" && w.resources.some((l) => /^BTM\d+$/.test(l.resource.code))) return true;
    if (t === "van_khuon" && w.code.startsWith("AF.81")) return true;
    return false;
  });
  const prev: string[] = fs.existsSync(LIST) ? JSON.parse(fs.readFileSync(LIST, "utf8")) : [];
  fs.writeFileSync(LIST, JSON.stringify([...new Set([...prev, ...hide.map((w) => w.code)])].sort(), null, 1));
  await prisma.workItem.updateMany({ where: { id: { in: hide.map((w) => w.id) } }, data: { active: false } });
  console.log({ taoMoi: created, tongDinhMucChuan: newIds.size, anDinhMucCu: hide.length });
}
main().finally(() => prisma.$disconnect());
