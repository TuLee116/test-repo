"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getPriceUser, inPriceAreas } from "@/lib/gia-doi";
import { canManageContracts } from "@/lib/hop-dong";

// NGHIỆM THU VỚI CĐT từng đợt (tạm nhập tay ở tab Tổng quan quản lý của hợp đồng; sau này link hồ sơ thanh toán CĐT)
type R = { ok: true } | { ok: false; error: string };

async function guard(contractId: string) {
  const u = await getPriceUser();
  if (!u || !canManageContracts(u)) return { error: "Bạn không có quyền nhập nghiệm thu CĐT (QSTT / QSĐT)." } as const;
  const c = await prisma.costContract.findUnique({ where: { id: contractId }, select: { area: true, appendixOfId: true } });
  if (!c) return { error: "Không tìm thấy hợp đồng." } as const;
  if (!inPriceAreas(u, c.area)) return { error: "Hợp đồng thuộc khu vực bạn không quản lý." } as const;
  if (c.appendixOfId) return { error: "Nhập nghiệm thu ở hợp đồng gốc (không nhập ở phụ lục)." } as const;
  return { u } as const;
}

export async function saveAcceptanceAction(contractId: string, input: { id?: string; period: string; date: string; value: number | null; note: string }): Promise<R> {
  const g = await guard(contractId);
  if ("error" in g) return { ok: false, error: g.error! };
  if (input.value == null || !Number.isFinite(input.value) || input.value === 0) return { ok: false, error: "Nhập giá trị nghiệm thu đợt này." };
  const date = input.date ? new Date(`${input.date}T00:00:00Z`) : null;
  if (date && Number.isNaN(date.getTime())) return { ok: false, error: "Ngày không hợp lệ." };
  const data = { period: input.period.trim(), date, value: input.value, note: input.note.trim() };
  if (input.id) {
    const n = await prisma.ownerAcceptance.updateMany({ where: { id: input.id, contractId }, data });
    if (!n.count) return { ok: false, error: "Không tìm thấy đợt nghiệm thu." };
  } else {
    await prisma.ownerAcceptance.create({ data: { ...data, contractId, createdByName: g.u.name } });
  }
  revalidatePath("/gia-doi", "layout");
  return { ok: true };
}

export async function deleteAcceptanceAction(contractId: string, id: string): Promise<R> {
  const g = await guard(contractId);
  if ("error" in g) return { ok: false, error: g.error! };
  await prisma.ownerAcceptance.deleteMany({ where: { id, contractId } });
  revalidatePath("/gia-doi", "layout");
  return { ok: true };
}
