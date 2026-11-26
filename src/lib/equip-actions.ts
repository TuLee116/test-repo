"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { hasApp } from "@/lib/access";
import { assertProjectEditable } from "@/lib/dtcp-guard";
import { prisma } from "@/lib/prisma";
import { applyEquipCalc } from "@/lib/equip";
import { maxSupplierPrice } from "@/lib/equip-catalog";
import { EQUIP_KINDS, type EquipKind } from "@/lib/equip-calc";

type Result = { ok: boolean; error?: string; id?: string };

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Chưa đăng nhập");
  if (!(await hasApp("DTCP"))) throw new Error("Tài khoản chưa được cấp quyền dùng chương trình DT-CP");
  return session.user;
}

const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "Có lỗi xảy ra" });

// Lưu bản tính (tạo mới khi chưa có id) rồi ghi kết quả vào TH Thiết Bị
export async function saveEquipCalcAction(projectId: string, input: { id?: string; kind: EquipKind; name: string; params: unknown }): Promise<Result> {
  try {
    await requireUser();
    await assertProjectEditable(projectId);
    if (!EQUIP_KINDS.some((k) => k.kind === input.kind)) return { ok: false, error: "Loại tính toán không hợp lệ" };
    const name = input.name.trim() || EQUIP_KINDS.find((k) => k.kind === input.kind)!.group;
    const params = JSON.stringify(input.params ?? {});
    let id = input.id;
    if (id) {
      const cur = await prisma.equipCalc.findUnique({ where: { id } });
      if (!cur || cur.projectId !== projectId) return { ok: false, error: "Không tìm thấy bản tính" };
      await prisma.equipCalc.update({ where: { id }, data: { name, params } });
      if (cur.name !== name) {
        const ids = [cur.groupId, cur.ncGroupId].filter((x): x is string => !!x);
        await prisma.vtGroup.updateMany({ where: { id: { in: ids }, projectId }, data: { name: name.toUpperCase() } });
      }
    } else {
      const max = await prisma.equipCalc.aggregate({ where: { projectId }, _max: { orderIndex: true } });
      id = (await prisma.equipCalc.create({ data: { projectId, kind: input.kind, name, params, orderIndex: (max._max.orderIndex ?? -1) + 1 } })).id;
    }
    await applyEquipCalc(id);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

// Tính lại mọi bản tính của dự án theo đơn giá hiện hành
export async function recalcAllEquipAction(projectId: string): Promise<Result & { count?: number }> {
  try {
    await requireUser();
    await assertProjectEditable(projectId);
    const calcs = await prisma.equipCalc.findMany({ where: { projectId }, select: { id: true } });
    for (const c of calcs) await applyEquipCalc(c.id);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, count: calcs.length };
  } catch (e) {
    return fail(e);
  }
}

// Xoá bản tính: xoá các dòng nó tạo ở TH Thiết Bị / TH Nhân Công; đầu mục lớn chỉ xoá khi không còn dòng nào khác
export async function deleteEquipCalcAction(projectId: string, id: string): Promise<Result> {
  try {
    await requireUser();
    await assertProjectEditable(projectId);
    const calc = await prisma.equipCalc.findUnique({ where: { id } });
    if (!calc || calc.projectId !== projectId) return { ok: false, error: "Không tìm thấy bản tính" };
    const rows = await prisma.sheetManualItem.findMany({ where: { projectId, calcId: id }, select: { id: true } });
    await prisma.fieldFormula.deleteMany({ where: { projectId, kind: "manual", targetId: { in: rows.map((r) => r.id) } } });
    await prisma.sheetManualItem.deleteMany({ where: { projectId, calcId: id } });
    for (const gid of [calc.groupId, calc.ncGroupId]) {
      if (!gid) continue;
      const left = await prisma.sheetManualItem.count({ where: { projectId, groupId: gid } });
      const placed = await prisma.vtPlacement.count({ where: { projectId, groupId: gid } });
      if (!left && !placed) await prisma.vtGroup.deleteMany({ where: { id: gid, projectId } });
    }
    await prisma.equipCalc.delete({ where: { id } });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Cập nhật đơn giá / thông số 1 cấu kiện (dùng chung mọi dự án). Đổi giá NCC khi đang "theo giá cao nhất" → giá dùng tự theo.
export async function updateEquipItemAction(
  id: string,
  patch: { supplierPrices?: Record<string, number>; price?: number; priceManual?: boolean; buyPrice?: number; lossPct?: number; weight?: number }
): Promise<Result> {
  try {
    const user = await requireUser();
    const cur = await prisma.equipItem.findUnique({ where: { id } });
    if (!cur) return { ok: false, error: "Không tìm thấy thiết bị" };
    const sp = patch.supplierPrices ?? (JSON.parse(cur.supplierPrices || "{}") as Record<string, number>);
    for (const [k, v] of Object.entries(sp)) if (!(Number.isFinite(v) && v > 0)) delete sp[k];
    const manual = patch.price !== undefined ? true : (patch.priceManual ?? cur.priceManual);
    const max = maxSupplierPrice(sp);
    const price = patch.price !== undefined ? patch.price : !manual && max != null ? max : cur.price;
    await prisma.equipItem.update({
      where: { id },
      data: {
        supplierPrices: JSON.stringify(sp),
        price: Math.max(0, price),
        priceManual: manual && !(patch.priceManual === false),
        ...(patch.buyPrice !== undefined ? { buyPrice: Math.max(0, patch.buyPrice) } : {}),
        ...(patch.lossPct !== undefined ? { lossPct: Math.max(0, patch.lossPct) } : {}),
        ...(patch.weight !== undefined ? { weight: Math.max(0, patch.weight) } : {}),
        updatedBy: user.name ?? "",
      },
    });
    revalidatePath("/projects", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
