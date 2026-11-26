import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAllResources } from "@/lib/project-data";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  return NextResponse.json({ items: await getAllResources() });
}
