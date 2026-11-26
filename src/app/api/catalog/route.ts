import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCatalogForPicker } from "@/lib/project-data";
import { prisma } from "@/lib/prisma";
import stateHeadings from "@/data/state-norm-headings.json";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  // usedCodes: mọi mã đã có (kể cả mã đã ẩn) - để gợi ý mã định mức mới không trùng
  const usedCodes = (await prisma.workItem.findMany({ select: { code: true } })).map((w) => w.code);
  return NextResponse.json({ items: await getCatalogForPicker(), usedCodes, stateHeadings });
}
