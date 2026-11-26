import { prisma } from "@/lib/prisma";

// Mã tài nguyên riêng của dự án (nhân công theo công việc BOQ, vật liệu tự thêm): TMN + 5 chữ số, VD TMN00123.
export const fmtTmnCode = (n: number) => `TMN${String(n).padStart(5, "0")}`;

// Số thứ tự kế tiếp (lớn nhất đang có + 1)
export async function nextTmnNumber(): Promise<number> {
  const rows = await prisma.resource.findMany({ where: { code: { startsWith: "TMN" } }, select: { code: true } });
  let max = 0;
  for (const r of rows) {
    const m = /^TMN(\d{5,})$/.exec(r.code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export async function nextTmnCode(): Promise<string> {
  return fmtTmnCode(await nextTmnNumber());
}
