"use server";

import { computeBoqTree, summaryKind } from "@/lib/boq-tree";
import { normalizePackageType } from "@/lib/package-types";
import { auth } from "@/auth";
import { canDtcp, hasApp } from "@/lib/access";
import { assertProjectEditable } from "@/lib/dtcp-guard";
import { parseAreas, parseCodes } from "@/lib/perms";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { emailAllowed, emailDomain } from "@/lib/login-otp";
import { parseQuantityInput, parseQtyWithKL } from "@/lib/formula";
import { normalizeText } from "@/lib/text-normalize";
import { aliasKey, extractFeatures } from "@/lib/boq-match";
import { unitFactor } from "@/lib/unit-convert";
import { clearLaborByWork, LABOR_GROUP, syncLaborByWork } from "@/lib/labor-sync";
import { renumberBoq } from "@/lib/boq-tree";
import { promoteTmpImage, removeImageFile } from "@/lib/uploads";
import { childlessHeadingIds } from "@/lib/boq-amounts";
import { remapFormula } from "@/lib/grid-formula";
import { parseStyle, stringifyStyle } from "@/lib/grid-style";
import { syncGridStt } from "@/lib/grid-stt-sync";
import { mergesIntersect, normalizeMerge, parseMerges, remapMerges, type GridMerge } from "@/lib/grid-merge";
import { detectAmountCol } from "@/lib/grid-amount";
import { cloneProject } from "@/lib/project-clone";
import { applyEquipCalc } from "@/lib/equip";
import { nextTmnCode } from "@/lib/resource-code";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Chưa đăng nhập");
  if (!(await hasApp("DTCP"))) throw new Error("Tài khoản chưa được cấp quyền dùng chương trình DT-CP");
  if (!(await canDtcp("EDIT", "NORM", "PRICE", "NORM_REVIEW"))) throw new Error("Tài khoản chỉ có quyền XEM DT-CP");
  return session.user;
}

// Hợp đồng được chọn: "c:<id hợp đồng>" | "p:<id dự án chưa gom hợp đồng>" (dự án đó được tự gom vào 1 hợp đồng mới). Trả về id hợp đồng hoặc null.
async function resolveContract(ref: string, exceptProjectId?: string): Promise<string | null> {
  if (ref.startsWith("c:")) {
    const c = await prisma.contract.findUnique({ where: { id: ref.slice(2) } });
    return c?.id ?? null;
  }
  if (ref.startsWith("p:") && ref.slice(2) !== exceptProjectId) {
    const other = await prisma.project.findUnique({ where: { id: ref.slice(2) } });
    if (!other) return null;
    if (other.contractId) return other.contractId;
    const c = await prisma.contract.create({ data: { name: other.name } });
    await prisma.project.update({ where: { id: other.id }, data: { contractId: c.id } });
    return c.id;
  }
  return null;
}

export async function createProjectAction(formData: FormData) {
  if (!(await canDtcp("EDIT"))) throw new Error("Bạn không có quyền lập DT-CP");
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim();
  if (!name) throw new Error("Tên dự án không được để trống");

  // DT-CP mới = hợp đồng mới; hoặc DT-CP thuộc hợp đồng đã có (VD phụ lục): "c:<id hợp đồng>" | "p:<id dự án chưa gom hợp đồng>"
  let contractId: string | null = null;
  const mode = String(formData.get("contractMode") || "new");
  const ref = String(formData.get("contractRef") || "");
  if (mode === "existing" && ref) contractId = await resolveContract(ref);
  if (!contractId) {
    const c = await prisma.contract.create({ data: { name: String(formData.get("contractName") || "").trim() || name } });
    contractId = c.id;
  }
  const area = String(formData.get("area") || "");

  const project = await prisma.project.create({
    data: {
      name,
      packageName: String(formData.get("packageName") || ""),
      investor: String(formData.get("investor") || ""),
      location: String(formData.get("location") || ""),
      projectType: String(formData.get("projectType") || ""),
      packageType: normalizePackageType(formData.get("packageType")),
      area: ["1", "2", "3", "4", "5"].includes(area) ? area : "",
      contractId,
      createdById: user.id,
      laborByWork: true, // dự án mới: nhân công đặt tên theo công việc BOQ
    },
  });
  revalidatePath("/projects");
  redirect(`/projects/${project.id}`);
}

export async function deleteProjectAction(projectId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.project.delete({ where: { id: projectId } });
  revalidatePath("/projects");
  redirect("/projects");
}

// Nhân bản DT-CP → 1 DT-CP mới độc lập (xem src/lib/project-clone.ts)
export async function cloneProjectAction(projectId: string, name: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const user = await requireUser();
  if (!(await canDtcp("EDIT"))) throw new Error("Bạn không có quyền lập DT-CP");
  const n = name.trim();
  if (!n) return { ok: false, error: "Tên dự án mới không được để trống" };
  try {
    const id = await cloneProject(projectId, { name: n, userId: user.id });
    revalidatePath("/projects");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Nhân bản không thành công" };
  }
}

export async function updateProjectInfoAction(projectId: string, formData: FormData) {
  await requireUser();
  await assertProjectEditable(projectId);
  // Hợp đồng: giữ nguyên (đổi được tên) | tách thành hợp đồng mới | chuyển sang hợp đồng đã có
  const cur = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, contractId: true, site: { select: { name: true } } } });
  let contractId: string | null | undefined = undefined;
  const mode = String(formData.get("contractMode") || "keep");
  const cname = String(formData.get("contractName") || "").trim();
  if (mode === "new") {
    contractId = (await prisma.contract.create({ data: { name: cname || String(formData.get("name") || cur?.name || "") } })).id;
  } else if (mode === "existing") {
    const id = await resolveContract(String(formData.get("contractRef") || ""), projectId);
    if (id) contractId = id;
  } else if (cname) {
    if (cur?.contractId) await prisma.contract.update({ where: { id: cur.contractId }, data: { name: cname } });
    else contractId = (await prisma.contract.create({ data: { name: cname } })).id;
  }
  await prisma.project.update({
    where: { id: projectId },
    data: {
      // DT-CP đã gắn Danh mục dự án: tên dự án theo tên chuẩn (đổi tên ở trang Danh mục dự án)
      name: cur?.site ? cur.site.name : String(formData.get("name") || ""),
      packageName: String(formData.get("packageName") || ""),
      investor: String(formData.get("investor") || ""),
      location: String(formData.get("location") || ""),
      projectType: String(formData.get("projectType") || ""),
      ...(formData.has("contractNo") ? { contractNo: String(formData.get("contractNo") ?? "").trim() } : {}),
      ...(contractId !== undefined ? { contractId } : {}),
      packageType: normalizePackageType(formData.get("packageType")),
      area: ["1", "2", "3", "4", "5"].includes(String(formData.get("area"))) ? String(formData.get("area")) : "",
      vatRate: Number(formData.get("vatRate")) / 100,
    },
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function updateBoqItemQuantityAction(projectId: string, boqItemId: string, quantity: number) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.boqItem.update({ where: { id: boqItemId }, data: { quantity } });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteBoqItemAction(projectId: string, boqItemId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.boqItem.delete({ where: { id: boqItemId } });
  revalidatePath(`/projects/${projectId}`);
}

export async function importBoqItemsAction(
  projectId: string,
  items: {
    workItemId: string | null;
    quantity: number;
    rawDescription: string;
    rawUnit: string;
    normalizedText?: string;
    learnAlias?: boolean;
    isHeading?: boolean;
    stt?: string;
    images?: string[]; // mã ảnh tạm lấy từ file Excel (api/import/parse)
    quotedUnitPrice?: number | null; // đơn giá CĐT lấy từ file (gói thầu đã có giá duyệt)
    note?: string; // ghi chú lấy từ file
  }[],
  target?: { sheetId?: string | null; newSheetName?: string }
) {
  await requireUser();
  await assertProjectEditable(projectId);
  let sheetId: string | null = target?.sheetId ?? null;
  if (!sheetId && target?.newSheetName?.trim()) {
    const maxSheet = await prisma.projectSheet.aggregate({ where: { projectId }, _max: { orderIndex: true } });
    const sheet = await prisma.projectSheet.create({
      data: { projectId, name: target.newSheetName.trim(), kind: "BOQ", orderIndex: (maxSheet._max.orderIndex ?? 0) + 1 },
    });
    sheetId = sheet.id;
  }
  // Cho nhập cả dòng chưa khớp định mức (workItemId=null) - gán/đổi công tác sau trên bảng BOQ.
  // Giữ cả dòng đầu mục lớn (isHeading) để bảo toàn bố cục BOQ gốc.
  const valid = items.filter((i) => i.isHeading || i.quantity > 0);
  if (valid.length === 0) return { created: 0, sheetId };

  const maxOrder = await prisma.boqItem.aggregate({ where: { projectId }, _max: { orderIndex: true } });
  let nextOrder = (maxOrder._max.orderIndex ?? 0) + 1;
  const firstOrder = nextOrder;

  const createdRows = await prisma.boqItem.createManyAndReturn({
    select: { id: true, orderIndex: true },
    data: valid.map((i) => ({
      projectId,
      workItemId: i.workItemId,
      rawDescription: i.rawDescription,
      rawUnit: i.rawUnit,
      quantity: i.isHeading ? 0 : i.quantity,
      isHeading: !!i.isHeading,
      stt: i.stt ?? "",
      sheetId,
      quotedUnitPrice: !i.isHeading && i.quotedUnitPrice != null && Number.isFinite(i.quotedUnitPrice) ? i.quotedUnitPrice : null,
      note: i.note ?? "",
      orderIndex: nextOrder++,
    })),
  });

  for (const i of valid) if (!i.isHeading && i.learnAlias && i.workItemId) await learnAlias(prisma, i.rawDescription, i.workItemId);

  const idByOrder = new Map(createdRows.map((r) => [r.orderIndex, r.id]));
  await attachTmpImages(
    projectId,
    valid.map((i, k) => ({ boqItemId: idByOrder.get(firstOrder + k) ?? "", tokens: i.images ?? [] }))
  );

  await syncLaborByWork(projectId);
  revalidatePath(`/projects/${projectId}`);
  return { created: valid.filter((i) => !i.isHeading).length, sheetId };
}

// Cập nhật BOQ hiện tại từ file Excel sửa đổi của CĐT: khác với importBoqItemsAction (luôn tạo dòng
// mới), hàm này khớp từng dòng file mới với dòng BOQ cũ (theo mô tả công việc, xem src/lib/boq-diff.ts)
// để GIỮ NGUYÊN mã định mức đã gán / phương án DETAIL-SUB / giá báo CĐT / đơn giá thầu phụ đã nhập,
// chỉ cập nhật khối lượng - STT - ĐVT theo file mới. Dòng BOQ cũ không có trong file mới chỉ bị xoá khi
// người dùng tự xác nhận (removeIds), tránh mất dữ liệu ngoài ý muốn.
type UpdateBoqSlot =
  // workItemId: chỉ có khi người dùng chủ động chọn đổi sang mã định mức khác (nội dung đổi thực chất,
  // VD đổi mác bê tông) - không có thì GIỮ NGUYÊN mã cũ như trước giờ.
  // images: ảnh tạm từ file mới - dòng khớp chỉ nhận ảnh mới khi chưa có ảnh nào (giữ ảnh cũ người dùng đã chọn)
  // quotedUnitPrice: đơn giá CĐT từ file mới (khi người dùng chọn cột đơn giá) - không có thì giữ giá báo CĐT cũ
  | { kind: "matched"; id: string; quantity: number; rawUnit: string; stt: string; rawDescription: string; workItemId?: string; images?: string[]; quotedUnitPrice?: number; note?: string }
  | {
      kind: "created";
      workItemId: string | null;
      quantity: number;
      rawDescription: string;
      rawUnit: string;
      stt: string;
      isHeading: boolean;
      normalizedText?: string;
      learnAlias?: boolean;
      images?: string[];
      quotedUnitPrice?: number | null;
      note?: string;
    }
  // dòng cũ không khớp nhưng người dùng không xoá: giữ nguyên mọi dữ liệu, chỉ xếp lại đúng vị trí
  | { kind: "kept"; id: string };

export async function updateBoqFromImportAction(
  projectId: string,
  sheetId: string | null,
  slots: UpdateBoqSlot[],
  removeIds: string[]
) {
  await requireUser();
  await assertProjectEditable(projectId);
  const imageJobs: { boqItemId: string; tokens: string[] }[] = [];
  const removedFiles = removeIds.length ? await prisma.boqImage.findMany({ where: { projectId, boqItemId: { in: removeIds } }, select: { fileName: true } }) : [];

  await prisma.$transaction(async (tx) => {
    if (removeIds.length) await tx.boqItem.deleteMany({ where: { projectId, id: { in: removeIds } } });

    let order = 0;
    const createdIds: string[] = [];
    for (const s of slots) {
      if (s.kind === "matched") {
        await tx.boqItem.update({
          where: { id: s.id },
          data: {
            quantity: s.quantity,
            rawUnit: s.rawUnit,
            stt: s.stt,
            rawDescription: s.rawDescription,
            orderIndex: order++,
            ...(s.workItemId ? { workItemId: s.workItemId } : {}),
            ...(s.quotedUnitPrice != null && Number.isFinite(s.quotedUnitPrice) ? { quotedUnitPrice: s.quotedUnitPrice } : {}),
            ...(s.note ? { note: s.note } : {}),
          },
        });
        if (s.workItemId) await learnAlias(tx, s.rawDescription, s.workItemId); // người dùng chủ động đổi mã
        if (s.images?.length && (await tx.boqImage.count({ where: { boqItemId: s.id } })) === 0) imageJobs.push({ boqItemId: s.id, tokens: s.images });
      } else if (s.kind === "kept") {
        await tx.boqItem.update({ where: { id: s.id }, data: { orderIndex: order++ } });
      } else {
        const row = await tx.boqItem.create({
          data: {
            projectId,
            sheetId,
            workItemId: s.workItemId,
            rawDescription: s.rawDescription,
            rawUnit: s.rawUnit,
            quantity: s.isHeading ? 0 : s.quantity,
            isHeading: s.isHeading,
            stt: s.stt,
            quotedUnitPrice: !s.isHeading && s.quotedUnitPrice != null && Number.isFinite(s.quotedUnitPrice) ? s.quotedUnitPrice : null,
            note: s.note ?? "",
            orderIndex: order++,
          },
        });
        createdIds.push(row.id);
        if (s.images?.length) imageJobs.push({ boqItemId: row.id, tokens: s.images });
        if (s.learnAlias && s.workItemId) await learnAlias(tx, s.rawDescription, s.workItemId);
      }
    }

    // Lưới an toàn: dòng BOQ cũ nào đó không nằm trong slots (matched/kept) và không bị xoá - lẽ ra
    // không còn dòng nào ở đây vì client đã liệt kê đủ (xem "kind: kept" ở trên), nhưng vẫn đẩy xuống
    // cuối, giữ nguyên thứ tự cũ, để không bao giờ làm mất dòng nào ngoài ý muốn.
    const handledIds = slots.filter((s): s is UpdateBoqSlot & { kind: "matched" | "kept" } => s.kind === "matched" || s.kind === "kept").map((s) => s.id);
    const untouched = await tx.boqItem.findMany({
      where: { projectId, sheetId, id: { notIn: [...handledIds, ...createdIds, ...removeIds] } },
      orderBy: { orderIndex: "asc" },
      select: { id: true },
    });
    for (const u of untouched) await tx.boqItem.update({ where: { id: u.id }, data: { orderIndex: order++ } });
  });
  for (const f of removedFiles) removeImageFile(f.fileName);
  await attachTmpImages(projectId, imageJobs);

  await syncLaborByWork(projectId);
  revalidatePath(`/projects/${projectId}`);
}

// Người dùng tự chọn mã (kể cả bấm gợi ý hoặc "Giữ mã này") → ghi nhớ cách viết để lần sau tự khớp và
// không cảnh báo lệch nữa. Chỉ học từ lựa chọn của người, không học từ mã phần mềm tự đoán.
export async function assignBoqWorkItemAction(projectId: string, boqItemId: string, workItemId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  const boq = await prisma.boqItem.update({ where: { id: boqItemId }, data: { workItemId } });
  await learnAlias(prisma, boq.rawDescription, workItemId);
  await syncLaborByWork(projectId);
  revalidatePath(`/projects/${projectId}`);
}

// Chọn nhầm mã định mức → bỏ gán khỏi dòng BOQ này để chọn lại mã khác (chỉ ảnh hưởng dòng này, định mức chung giữ nguyên)
export async function unassignBoqWorkItemAction(projectId: string, boqItemId: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  await assertProjectEditable(projectId);
  const boq = await prisma.boqItem.findFirst({ where: { id: boqItemId, projectId }, select: { workItemId: true, rawDescription: true } });
  if (!boq) return { ok: false, error: "Không tìm thấy dòng BOQ" };
  await prisma.boqItem.update({ where: { id: boqItemId }, data: { workItemId: null } });
  // bỏ cách gọi đã nhớ trỏ về mã chọn nhầm, để lần nhập BOQ sau không tự khớp lại mã đó
  const key = aliasKey(boq.rawDescription);
  if (key && boq.workItemId) await prisma.workItemAlias.deleteMany({ where: { normalizedText: key, workItemId: boq.workItemId } });
  await syncLaborByWork(projectId);
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

// Ảnh tạm (lấy từ file Excel lúc phân tích) → ảnh chính thức của dòng BOQ; ảnh tạm đã bị dọn thì bỏ qua
async function attachTmpImages(projectId: string, jobs: { boqItemId: string; tokens: string[] }[]) {
  for (const j of jobs) {
    if (!j.boqItemId || !j.tokens.length) continue;
    let order = ((await prisma.boqImage.aggregate({ where: { boqItemId: j.boqItemId }, _max: { orderIndex: true } }))._max.orderIndex ?? -1) + 1;
    for (const t of j.tokens) {
      const f = await promoteTmpImage(projectId, t);
      if (f) await prisma.boqImage.create({ data: { projectId, boqItemId: j.boqItemId, ...f, orderIndex: order++ } });
    }
  }
}

export async function deleteBoqImageAction(projectId: string, imageId: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  await assertProjectEditable(projectId);
  const img = await prisma.boqImage.findFirst({ where: { id: imageId, projectId } });
  if (!img) return { ok: false, error: "Ảnh không còn tồn tại" };
  await prisma.boqImage.delete({ where: { id: img.id } });
  removeImageFile(img.fileName);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

type AliasDb = Pick<typeof prisma, "workItemAlias">;
async function learnAlias(db: AliasDb, rawDescription: string, workItemId: string) {
  const key = aliasKey(rawDescription);
  if (!key) return;
  await db.workItemAlias.upsert({
    where: { normalizedText: key },
    update: { workItemId, rawText: rawDescription, confirmed: true },
    create: { normalizedText: key, rawText: rawDescription, workItemId, confirmed: true },
  });
}

export async function setProjectResourcePriceAction(
  projectId: string,
  resourceId: string,
  unitPrice: number,
  vatRate: number = 0,
  keepFormula = false // đổi riêng VAT thì giữ công thức đơn giá
) {
  await requireUser();
  await assertProjectEditable(projectId);
  if (!keepFormula) await prisma.fieldFormula.deleteMany({ where: { projectId, kind: "price", targetId: resourceId, field: "unitPrice" } });
  await prisma.projectResourcePrice.upsert({
    where: { projectId_resourceId: { projectId, resourceId } },
    update: { unitPrice, vatRate },
    create: { projectId, resourceId, unitPrice, vatRate },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// ---- Vật liệu riêng của dự án (VD loại gạch / đá theo spec CĐT) + đổi vật liệu cho từng dòng BOQ ----
export async function createProjectResourceAction(projectId: string, input: { name: string; unit: string; unitPrice: number; category: "VT" | "NC" | "TB" }): Promise<string> {
  await requireUser();
  await assertProjectEditable(projectId);
  const name = input.name.trim();
  if (!name) throw new Error("Chưa nhập tên vật liệu");
  const code = await nextTmnCode();
  const r = await prisma.resource.create({
    data: { code, name, unit: input.unit.trim() || "m2", unitPrice: Math.max(0, input.unitPrice || 0), sourceType: input.category, groupLabel: input.category === "NC" ? LABOR_GROUP : "Vật liệu riêng của dự án", projectId },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
  return r.id;
}

// resourceId = null → về vật liệu mặc định của định mức. allSame: áp cho mọi dòng BOQ của dự án đang dùng cùng định mức
export async function setLineResourceSwapAction(projectId: string, boqItemId: string, lineId: string, resourceId: string | null, allSame = false) {
  await requireUser();
  await assertProjectEditable(projectId);
  const line = await prisma.workItemResource.findUnique({ where: { id: lineId }, select: { workItemId: true } });
  if (!line) return;
  const boqIds = allSame ? (await prisma.boqItem.findMany({ where: { projectId, workItemId: line.workItemId }, select: { id: true } })).map((b) => b.id) : [boqItemId];
  for (const id of boqIds) {
    if (resourceId === null) await prisma.boqLineResourceSwap.deleteMany({ where: { boqItemId: id, lineId } });
    else
      await prisma.boqLineResourceSwap.upsert({
        where: { boqItemId_lineId: { boqItemId: id, lineId } },
        create: { projectId, boqItemId: id, lineId, resourceId },
        update: { resourceId },
      });
  }
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function setBoqQuotedPriceAction(projectId: string, boqItemId: string, quotedUnitPrice: number | null) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.boqItem.update({ where: { id: boqItemId }, data: { quotedUnitPrice } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export type BoqLinkInput = {
  directMode: "PCT" | "LINK" | null;
  directPct: number | null;
  directBaseId: string | null;
  directLink: string | null;
  quotedMode: "PCT" | "LINK" | null;
  quotedPct: number | null;
  quotedBaseId: string | null;
  quotedLink: string | null;
};

// Liên kết giá của 1 đầu mục lớn không có công tác con (VD Chi phí Prelim, BPTC): Trực tiếp phí và Báo giá CĐT mỗi bên
// đều có thể tính theo % của 1 đầu mục khác hoặc lấy từ sheet bảng tự do.
export async function setBoqLinkAction(projectId: string, boqItemId: string, input: BoqLinkInput) {
  await requireUser();
  await assertProjectEditable(projectId);
  const item = await prisma.boqItem.findUnique({ where: { id: boqItemId } });
  if (!item || item.projectId !== projectId || !item.isHeading) throw new Error("Chỉ liên kết giá cho đầu mục lớn");
  const sameSheet = await prisma.boqItem.findMany({ where: { projectId, sheetId: item.sheetId }, orderBy: { orderIndex: "asc" }, select: { id: true, isHeading: true, stt: true, level: true, rawDescription: true } });
  if (!childlessHeadingIds(sameSheet).has(boqItemId)) throw new Error("Chỉ liên kết giá cho đầu mục không có công tác con");
  // grid: / gridh: = cột Thành tiền chính; gridc: / gridhc: = các cột Thành tiền khác của sheet tự do (xem grid-links.ts)
  const validLink = (v: string | null) => (v && /^(grid|gridh|gridc|gridhc):/.test(v) ? v : null);
  const normMode = (m: string | null) => (m === "PCT" || m === "LINK" ? m : null);
  const checkBase = async (baseId: string | null, label: string) => {
    const base = baseId ? await prisma.boqItem.findUnique({ where: { id: baseId } }) : null;
    if (!base || base.projectId !== projectId || !base.isHeading || (base.sheetId ?? null) !== (item.sheetId ?? null)) throw new Error(`${label}: chọn đầu mục làm cơ sở tính % (cùng sheet với dòng này)`);
    return base.id;
  };
  const directMode = normMode(input.directMode);
  const quotedMode = normMode(input.quotedMode);
  if (directMode === "LINK" && !validLink(input.directLink)) throw new Error("Trực tiếp phí: chọn nguồn liên kết");
  if (quotedMode === "LINK" && !validLink(input.quotedLink)) throw new Error("Báo giá CĐT: chọn nguồn liên kết");
  const directBaseId = directMode === "PCT" ? await checkBase(input.directBaseId, "Trực tiếp phí") : null;
  const quotedBaseId = quotedMode === "PCT" ? await checkBase(input.quotedBaseId, "Báo giá CĐT") : null;
  await prisma.boqItem.update({
    where: { id: boqItemId },
    data: {
      directMode,
      directPct: directMode === "PCT" && Number.isFinite(input.directPct) ? input.directPct : null,
      directBaseId,
      directLink: directMode === "LINK" ? validLink(input.directLink) : null,
      quotedMode,
      quotedPct: quotedMode === "PCT" && Number.isFinite(input.quotedPct) ? input.quotedPct : null,
      quotedBaseId,
      quotedLink: quotedMode === "LINK" ? validLink(input.quotedLink) : null,
    },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Tạo hao phí mới (vật tư / nhân công / máy) trong danh mục chung ngay tại form thêm dòng hao phí của CHI TIẾT
// Người dùng thường thêm dòng hao phí vào định mức có sẵn → ghi vào "Duyệt định mức" để quản trị viên
// kiểm tra (không duyệt = chỉ xoá đúng các dòng đã thêm, định mức giữ nguyên)
async function logLinesChange(user: { id: string; role?: string | null; name?: string | null; username?: string | null }, workItemId: string, lineIds: string[], newResourceIds: string[] = []) {
  if ((await canDtcp("NORM_REVIEW")) || lineIds.length === 0) return;
  const w = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { code: true, name: true } });
  if (!w) return;
  await prisma.catalogChange.create({
    data: {
      kind: "LINES",
      userId: user.id,
      userName: user.name ?? user.username ?? "Người dùng",
      workItemId,
      workItemCode: w.code,
      workItemName: w.name,
      lineIds: lineIds.join(","),
      resourceIds: newResourceIds.join(","),
    },
  });
}

export async function createInlineResourceAction(input: { name: string; unit: string; unitPrice: number; category: "VT" | "NC" | "TB" }) {
  await requireUser(); // người dùng thường tạo được; được ghi vào "Duyệt định mức" cùng dòng hao phí dùng nó
  const name = input.name.trim();
  if (!name) throw new Error("Chưa nhập tên hao phí");
  const dup = await prisma.resource.findFirst({ where: { name, projectId: null } });
  if (dup) throw new Error(`Đã có hao phí tên "${dup.name}" (mã ${dup.code}) — hãy chọn trong danh sách`);
  const slug = normalizeText(name).replace(/\s+/g, "").toUpperCase().slice(0, 14) || "MOI";
  let code = `${input.category}.${slug}`;
  for (let i = 2; await prisma.resource.findUnique({ where: { code } }); i++) code = `${input.category}.${slug}${i}`;
  const r = await prisma.resource.create({
    data: { code, name, unit: input.unit.trim() || "cái", unitPrice: Math.max(0, input.unitPrice || 0), sourceType: input.category, groupLabel: "(Thêm thủ công)" },
  });
  revalidatePath("/", "layout");
  return { id: r.id, code: r.code, name: r.name, unit: r.unit, sourceType: r.sourceType as string, unitPrice: r.unitPrice };
}

export async function addWorkItemResourceLineAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const workItemId = String(formData.get("workItemId") || "");
  const resourceId = String(formData.get("resourceId") || "");
  const category = String(formData.get("category") || "VT") as "VT" | "TB" | "NC";
  const parsed = parseQuantityInput(String(formData.get("quantity") || ""));
  if (!parsed.ok) throw new Error(`Định mức không hợp lệ: ${parsed.error}`);
  const wastageRate = Number(formData.get("wastageRate") || 0) / 100;
  if (!workItemId || !resourceId) throw new Error("Thiếu công tác hoặc tài nguyên");
  const dup = await prisma.workItemResource.findFirst({ where: { workItemId, resourceId }, include: { resource: true } });
  if (dup) {
    const q = dup.quantity.toLocaleString("vi-VN", { maximumFractionDigits: 6 });
    return { ok: false, error: `Định mức đã có hao phí "${dup.resource.name}" (định mức ${q} ${dup.resource.unit}) — muốn đổi số thì sửa dòng đang có, không thêm dòng thứ hai.` };
  }

  const line = await prisma.workItemResource.create({
    data: { workItemId, resourceId, category, quantity: parsed.value, quantityFormula: parsed.formula, wastageRate },
  });
  await logLinesChange(user, workItemId, [line.id], formData.get("newResource") ? [resourceId] : []);
  revalidatePath("/", "layout");
  return { ok: true };
}

// LỚP 2: người dùng xoá dòng hao phí CHÍNH MÌNH thêm khi quản trị viên chưa duyệt (bản ghi chờ duyệt tự gỡ theo)
// dòng hao phí thuộc định mức do chính người dùng tạo và chưa được duyệt
async function isOwnUnreviewedNormLine(userId: string, lineId: string) {
  const line = await prisma.workItemResource.findUnique({ where: { id: lineId }, select: { workItemId: true } });
  if (!line) return false;
  return (await prisma.catalogChange.count({ where: { kind: "NORM", reviewed: false, userId, workItemId: line.workItemId } })) > 0;
}

export async function deleteOwnPendingLineAction(lineId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const changes = await prisma.catalogChange.findMany({ where: { kind: "LINES", reviewed: false, userId: user.id, lineIds: { contains: lineId } } });
  const change = changes.find((c) => c.lineIds.split(",").includes(lineId));
  const ownNorm = !change && (await isOwnUnreviewedNormLine(user.id, lineId));
  if (!change && !ownNorm && !(await canDtcp("NORM_REVIEW", "NORM", "EDIT"))) return { ok: false, error: "Bạn không có quyền xoá dòng hao phí" };
  await prisma.workItemResource.deleteMany({ where: { id: lineId } });
  if (change) {
    const rest = change.lineIds.split(",").filter((x) => x && x !== lineId);
    if (rest.length) await prisma.catalogChange.update({ where: { id: change.id }, data: { lineIds: rest.join(",") } });
    else await prisma.catalogChange.delete({ where: { id: change.id } });
    // hao phí mới tạo kèm mà không còn nơi nào dùng → xoá luôn
    for (const rid of change.resourceIds.split(",").filter(Boolean)) {
      if ((await prisma.workItemResource.count({ where: { resourceId: rid } })) === 0) await prisma.resource.deleteMany({ where: { id: rid } });
    }
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

// Đổi mục chi phí của 1 dòng hao phí (Vật tư / Nhân công / Thiết bị) khi lỡ chọn nhầm lúc thêm. Định mức dùng
// chung mọi dự án → quản trị viên đổi được mọi dòng; người dùng thường chỉ đổi dòng mình thêm và chưa được duyệt.
// Tài nguyên chỉ còn được dùng đúng 1 mục → đổi luôn loại của tài nguyên (để hiện đúng nhóm khi chọn / đổi vật liệu).
export async function setLineCategoryAction(lineId: string, category: "VT" | "NC" | "TB"): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!["VT", "NC", "TB"].includes(category)) return { ok: false, error: "Mục chi phí không hợp lệ" };
  const line = await prisma.workItemResource.findUnique({ where: { id: lineId } });
  if (!line) return { ok: false, error: "Không tìm thấy dòng hao phí" };
  void user;
  if (!(await canDtcp("NORM_REVIEW", "NORM", "EDIT"))) return { ok: false, error: "Bạn không có quyền đổi mục chi phí của dòng hao phí" };
  if (line.category === category) return { ok: true };
  await prisma.workItemResource.update({ where: { id: lineId }, data: { category, ...(category !== "VT" ? { wastageRate: 0 } : {}) } });
  const cats = await prisma.workItemResource.findMany({ where: { resourceId: line.resourceId }, select: { category: true }, distinct: ["category"] });
  if (cats.length === 1) await prisma.resource.update({ where: { id: line.resourceId }, data: { sourceType: category } });
  // nhân công theo công việc BOQ: dòng chuyển vào / ra khỏi mục Nhân công → đồng bộ lại các dự án đang dùng định mức này
  if (line.category === "NC" || category === "NC") {
    const projects = await prisma.boqItem.findMany({ where: { workItemId: line.workItemId, project: { laborByWork: true } }, select: { projectId: true }, distinct: ["projectId"] });
    for (const p of projects) await syncLaborByWork(p.projectId);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

// LỚP 3: người dùng đề nghị xoá 1 dòng hao phí của định mức chung → quản trị viên duyệt ở "Duyệt định mức"
export async function requestLineRemovalAction(lineId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const line = await prisma.workItemResource.findUnique({ where: { id: lineId }, include: { workItem: true } });
  if (!line) return { ok: false, error: "Không tìm thấy dòng hao phí" };
  const pending = await prisma.catalogChange.findFirst({ where: { kind: "REMOVE", reviewed: false, lineIds: lineId } });
  if (pending) return { ok: false, error: "Dòng này đã có đề nghị xoá đang chờ quản trị viên duyệt" };
  await prisma.catalogChange.create({
    data: {
      kind: "REMOVE",
      userId: user.id,
      userName: user.name ?? user.username ?? "Người dùng",
      workItemId: line.workItemId,
      workItemCode: line.workItem.code,
      workItemName: line.workItem.name,
      lineIds: lineId,
      rejectReason: reason.trim(), // lưu tạm lý do người đề nghị (khi duyệt/không duyệt sẽ ghi đè bằng ghi chú của quản trị viên nếu có)
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---- CHI TIẾT: thêm 1 dòng hao phí cho 1 công tác → đề xuất bổ sung cho các công tác CÙNG LOẠI trong dự án ----
export type SimilarWorkItem = { workItemId: string; code: string; name: string; unit: string; rows: { stt: string; desc: string }[] };

// Công tác cùng loại (cốt thép, bê tông, ván khuôn, xây, trát...) trong dự án, có định mức khác định mức
// vừa sửa và CHƯA có hao phí này. Loại công tác đọc từ mô tả BOQ (giống bộ khớp định mức).
export async function similarWorkItemsForLineAction(projectId: string, workItemId: string, resourceId: string): Promise<SimilarWorkItem[]> {
  await requireUser();
  const items = await prisma.boqItem.findMany({
    where: { projectId, isHeading: false, workItemId: { not: null } },
    orderBy: { orderIndex: "asc" },
    select: { stt: true, rawDescription: true, rawUnit: true, workItem: { select: { id: true, code: true, name: true, unit: true, resources: { select: { resourceId: true } } } } },
  });
  const typeOf = (desc: string, unit: string, normName: string) => extractFeatures(desc || normName, unit).type;
  const src = items.filter((b) => b.workItem!.id === workItemId);
  const srcTypes = new Set(src.map((b) => typeOf(b.rawDescription, b.rawUnit, b.workItem!.name)));
  if (src.length === 0) srcTypes.add(extractFeatures((await prisma.workItem.findUnique({ where: { id: workItemId } }))?.name ?? "", "").type);
  srcTypes.delete(null);
  if (srcTypes.size === 0) return [];
  const out = new Map<string, SimilarWorkItem>();
  for (const b of items) {
    const w = b.workItem!;
    if (w.id === workItemId || w.resources.some((r) => r.resourceId === resourceId)) continue;
    if (!srcTypes.has(typeOf(b.rawDescription, b.rawUnit, w.name))) continue;
    const cur = out.get(w.id) ?? { workItemId: w.id, code: w.code, name: w.name, unit: w.unit, rows: [] };
    cur.rows.push({ stt: b.stt, desc: b.rawDescription.split("\n")[0] });
    out.set(w.id, cur);
  }
  return [...out.values()];
}

// Bổ sung cùng 1 dòng hao phí (lấy từ định mức nguồn) cho nhiều định mức; định mức đổi theo ĐVT của từng
// định mức đích (VD nguồn tính theo kg, đích theo tấn → nhân 1000).
export async function addLineToWorkItemsAction(sourceWorkItemId: string, resourceId: string, targetWorkItemIds: string[]): Promise<number> {
  const user = await requireUser();
  const src = await prisma.workItem.findUnique({ where: { id: sourceWorkItemId }, include: { resources: true } });
  const line = src?.resources.filter((r) => r.resourceId === resourceId).at(-1);
  if (!src || !line) throw new Error("Không tìm thấy dòng hao phí nguồn");
  const targets = await prisma.workItem.findMany({ where: { id: { in: targetWorkItemIds } }, include: { resources: { select: { resourceId: true } } } });
  let n = 0;
  for (const t of targets) {
    if (t.resources.some((r) => r.resourceId === resourceId)) continue;
    const f = unitFactor(t.unit, src.unit);
    const created = await prisma.workItemResource.create({
      data: { workItemId: t.id, resourceId, category: line.category, quantity: line.quantity * f, quantityFormula: f === 1 ? line.quantityFormula : null, wastageRate: line.wastageRate },
    });
    await logLinesChange(user, t.id, [created.id]);
    n++;
  }
  revalidatePath("/", "layout");
  return n;
}

// Sau khi tạo định mức mới cho 1 dòng BOQ: các dòng CÙNG LOẠI trong dự án còn chưa có định mức (để gán luôn)
export type UnassignedSimilarRow = { id: string; stt: string; desc: string; unit: string };
export async function similarUnassignedRowsAction(projectId: string, boqItemId: string): Promise<UnassignedSimilarRow[]> {
  await requireUser();
  const src = await prisma.boqItem.findUnique({ where: { id: boqItemId }, select: { rawDescription: true, rawUnit: true } });
  const type = src ? extractFeatures(src.rawDescription, src.rawUnit).type : null;
  if (!type) return [];
  const rows = await prisma.boqItem.findMany({
    where: { projectId, isHeading: false, workItemId: null, id: { not: boqItemId } },
    orderBy: { orderIndex: "asc" },
    select: { id: true, stt: true, rawDescription: true, rawUnit: true },
  });
  return rows.filter((r) => extractFeatures(r.rawDescription, r.rawUnit).type === type).map((r) => ({ id: r.id, stt: r.stt, desc: r.rawDescription.split("\n")[0], unit: r.rawUnit }));
}

// Gán 1 định mức cho nhiều dòng BOQ (người dùng tự chọn → ghi nhớ cách viết như gán từng dòng)
export async function assignWorkItemToRowsAction(projectId: string, boqItemIds: string[], workItemId: string): Promise<number> {
  await requireUser();
  await assertProjectEditable(projectId);
  const rows = await prisma.boqItem.findMany({ where: { projectId, id: { in: boqItemIds } }, select: { id: true, rawDescription: true } });
  await prisma.boqItem.updateMany({ where: { projectId, id: { in: rows.map((r) => r.id) } }, data: { workItemId } });
  for (const r of rows) await learnAlias(prisma, r.rawDescription, workItemId);
  await syncLaborByWork(projectId);
  revalidatePath(`/projects/${projectId}`, "layout");
  return rows.length;
}

export async function updateWorkItemResourceLineAction(lineId: string, quantity: number, wastageRate: number) {
  await requireNormLineEditor();
  await prisma.workItemResource.update({
    where: { id: lineId },
    data: { quantity, wastageRate: wastageRate / 100 },
  });
  revalidatePath("/", "layout");
}

export async function deleteWorkItemResourceLineAction(lineId: string) {
  await requireNormLineEditor();
  await prisma.workItemResource.delete({ where: { id: lineId } });
  revalidatePath("/", "layout");
}

export async function createSubcontractorItemAction(projectId: string, formData: FormData) {
  await requireUser();
  await assertProjectEditable(projectId);
  const name = String(formData.get("name") || "").trim();
  const contractorName = String(formData.get("contractorName") || "").trim();
  const amount = Number(formData.get("amount") || 0);
  const note = String(formData.get("note") || "");
  if (!name) throw new Error("Thiếu nội dung hạng mục thầu phụ");

  const maxOrder = await prisma.subcontractorItem.aggregate({ where: { projectId }, _max: { orderIndex: true } });
  await prisma.subcontractorItem.create({
    data: { projectId, name, contractorName, amount, note, orderIndex: (maxOrder._max.orderIndex ?? 0) + 1 },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function updateSubcontractorItemAction(projectId: string, itemId: string, formData: FormData) {
  await requireUser();
  await assertProjectEditable(projectId);
  if (formData.has("unitPrice")) {
    // Dòng link từ công tác BOQ: nhập ĐƠN GIÁ thầu phụ, thành tiền = đơn giá × khối lượng BOQ
    const unitPrice = Number(formData.get("unitPrice") || 0);
    const item = await prisma.subcontractorItem.findUnique({ where: { id: itemId }, include: { boqItem: true } });
    await prisma.subcontractorItem.update({
      where: { id: itemId },
      data: {
        contractorName: String(formData.get("contractorName") || ""),
        note: String(formData.get("note") || ""),
        unitPrice,
        amount: unitPrice * (item?.boqItem?.quantity ?? 0),
      },
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return;
  }
  await prisma.subcontractorItem.update({
    where: { id: itemId },
    data: {
      name: String(formData.get("name") || ""),
      contractorName: String(formData.get("contractorName") || ""),
      amount: Number(formData.get("amount") || 0),
      note: String(formData.get("note") || ""),
    },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function deleteSubcontractorItemAction(projectId: string, itemId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.subcontractorItem.delete({ where: { id: itemId } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function createOtherCostItemAction(projectId: string, formData: FormData) {
  await requireUser();
  await assertProjectEditable(projectId);
  const name = String(formData.get("name") || "").trim();
  const amount = Number(formData.get("amount") || 0);
  const note = String(formData.get("note") || "");
  if (!name) throw new Error("Thiếu tên khoản chi phí");

  const maxOrder = await prisma.otherCostItem.aggregate({ where: { projectId }, _max: { orderIndex: true } });
  await prisma.otherCostItem.create({
    data: { projectId, name, amount, note, orderIndex: (maxOrder._max.orderIndex ?? 0) + 1 },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function updateOtherCostItemAction(projectId: string, itemId: string, formData: FormData) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.otherCostItem.update({
    where: { id: itemId },
    data: {
      name: String(formData.get("name") || ""),
      amount: Number(formData.get("amount") || 0),
      note: String(formData.get("note") || ""),
    },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function deleteOtherCostItemAction(projectId: string, itemId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.otherCostItem.delete({ where: { id: itemId } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function updateResourcePriceAction(resourceId: string, unitPrice: number) {
  const user = await requireUser();
  void user;
  if (!(await canDtcp("PRICE"))) throw new Error("Bạn không có quyền sửa đơn giá gốc");
  await prisma.resource.update({ where: { id: resourceId }, data: { unitPrice } });
  // Giá vật tư/nhân công/thiết bị ảnh hưởng đến mọi công tác + mọi dự án đang dùng nó
  revalidatePath("/", "layout");
}

export async function createResourceAction(formData: FormData) {
  const user = await requireUser();
  void user;
  if (!(await canDtcp("PRICE"))) throw new Error("Bạn không có quyền thêm tài nguyên mới vào danh mục");
  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const unit = String(formData.get("unit") || "").trim();
  const sourceType = String(formData.get("sourceType") || "VT") as "VT" | "TB" | "NC";
  const unitPrice = Number(formData.get("unitPrice") || 0);
  if (!code || !name || !unit) throw new Error("Thiếu mã/tên/đơn vị");

  await prisma.resource.create({
    data: { code, name, unit, unitPrice, sourceType, groupLabel: "(Thêm thủ công)" },
  });
  revalidatePath("/catalog");
}

async function requireNormReviewer() {
  const user = await requireUser();
  if (!(await canDtcp("NORM_REVIEW"))) throw new Error("Bạn không có quyền quản lý / duyệt định mức");
  return user;
}

// Sửa / xoá dòng hao phí của định mức khi lập DT-CP: người có quyền lập DT-CP (EDIT), sửa định mức (NORM) hoặc duyệt định mức (NORM_REVIEW)
async function requireNormLineEditor() {
  const user = await requireUser();
  if (!(await canDtcp("NORM_REVIEW", "NORM", "EDIT"))) throw new Error("Bạn không có quyền sửa dòng hao phí của định mức");
  return user;
}

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("Chỉ quản trị viên mới được thực hiện thao tác này");
  return user;
}

// CHECKLIST QUYỀN của 1 tài khoản (src/lib/perms.ts): từng việc được làm ở DT-CP / Mua vật tư / Trình giá tổ đội / Trình giá thầu phụ
// + khu vực được làm việc. Chương trình được dùng (apps) tự suy ra: tick việc nào ở phân hệ nào thì dùng phân hệ đó.
export type UserAccessInput = { name: string; position: string; email: string; isAdmin: boolean; dtcp: string[]; proc: string[]; price: string[]; sub: string[]; areas: string[] };

// Email công ty để nhận mã đăng nhập (src/lib/login-otp.ts): được để trống, nhưng có nhập thì phải đúng đuôi công ty
function checkEmail(raw: unknown): { email: string; error?: string } {
  const email = String(raw || "").trim().toLowerCase();
  if (email && !emailAllowed(email)) {
    const d = emailDomain();
    return { email, error: d ? `Email phải có đuôi @${d}` : "Email không hợp lệ" };
  }
  return { email };
}

function accessData(d: UserAccessInput) {
  const pick = (v: unknown, key: "dtcp" | "proc" | "price" | "sub") => parseCodes((Array.isArray(v) ? v.map(String) : []).join(","), key);
  const dtcp = pick(d.dtcp, "dtcp");
  const proc = pick(d.proc, "proc");
  const price = pick(d.price, "price");
  const sub = pick(d.sub, "sub");
  // làm được bất cứ việc gì ở DT-CP thì cũng xem được DT-CP
  if (dtcp.length && !dtcp.includes("VIEW")) dtcp.unshift("VIEW");
  const apps = [dtcp.length && "DTCP", proc.length && "PROC", (price.length || sub.length) && "PRICE"].filter(Boolean).join(",");
  return {
    position: String(d.position || "").trim(),
    role: (d.isAdmin ? "ADMIN" : "EDITOR") as "ADMIN" | "EDITOR",
    apps,
    dtcpPerms: dtcp.join(","),
    procRoles: proc.join(","),
    priceRoles: price.join(","),
    subRoles: sub.join(","),
    areas: parseAreas((Array.isArray(d.areas) ? d.areas : []).join(",")).join(","),
  };
}

// Tạo tài khoản kèm chức danh + checklist quyền + khu vực
export async function createUserAction(data: UserAccessInput & { username: string; password: string }): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const name = String(data.name || "").trim();
  const username = String(data.username || "").trim();
  const password = String(data.password || "");
  if (!name || !username || !password) return { ok: false, error: "Nhập đủ họ tên, tên đăng nhập, mật khẩu" };
  if (password.length < 8) return { ok: false, error: "Mật khẩu phải từ 8 ký tự" };
  if (await prisma.user.findUnique({ where: { username } })) return { ok: false, error: `Tên đăng nhập "${username}" đã có` };
  const em = checkEmail(data.email);
  if (em.error) return { ok: false, error: em.error };
  const acc = accessData(data);
  if (acc.role !== "ADMIN" && !acc.apps) return { ok: false, error: "Tick ít nhất 1 quyền ở một phân hệ" };
  await prisma.user.create({ data: { name, username, email: em.email, passwordHash: await bcrypt.hash(password, 10), ...acc } });
  revalidatePath("/admin/users");
  return { ok: true };
}

// Sửa họ tên / chức danh / checklist quyền / khu vực của 1 tài khoản
export async function updateUserAccessAction(userId: string, data: UserAccessInput): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();
  const name = String(data.name || "").trim();
  if (!name) return { ok: false, error: "Họ tên không được trống" };
  const em = checkEmail(data.email);
  if (em.error) return { ok: false, error: em.error };
  const acc = accessData(data);
  if (admin.id === userId && acc.role !== "ADMIN") return { ok: false, error: "Không tự bỏ quyền quản trị của chính mình" };
  if (acc.role !== "ADMIN" && !acc.apps) return { ok: false, error: "Tick ít nhất 1 quyền ở một phân hệ" };
  await prisma.user.update({ where: { id: userId }, data: { name, email: em.email, ...acc } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function resetUserPasswordAction(userId: string, newPassword: string) {
  await requireAdmin();
  if (newPassword.length < 8) throw new Error("Mật khẩu phải từ 8 ký tự");
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
  revalidatePath("/admin/users");
}

export async function deleteUserAction(userId: string) {
  const admin = await requireAdmin();
  if (admin.id === userId) throw new Error("Không thể tự xoá tài khoản của chính mình");
  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin/users");
}

// ---- Bảng tổng hợp DT-CP (Doanh thu - Chi phí) ----
export async function updateProgressAction(projectId: string, progress: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.project.update({ where: { id: projectId }, data: { progress } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function addDtcpLineAction(projectId: string, section: "A" | "B", parentId: string | null) {
  await requireUser();
  await assertProjectEditable(projectId);
  const max = await prisma.dtcpLine.aggregate({ where: { projectId, parentId }, _max: { orderIndex: true } });
  await prisma.dtcpLine.create({
    data: { projectId, section, parentId, name: "Khoản mục mới", orderIndex: (max._max.orderIndex ?? -1) + 1 },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function updateDtcpLineAction(
  projectId: string,
  lineId: string,
  data: { name?: string; unit?: string; linkSource?: string; manualAmount?: number; note?: string }
) {
  await requireUser();
  await assertProjectEditable(projectId);
  // nhập số tay hoặc chọn nguồn liên kết có sẵn thì bỏ công thức
  const clearFormula = data.manualAmount !== undefined || data.linkSource !== undefined ? { formula: "" } : {};
  // tự sửa tên → khoá tên (đồng bộ từ đầu mục TH / thầu phụ / sheet tự do không ghi đè nữa)
  const lock = data.name !== undefined ? { nameLocked: true } : {};
  await prisma.dtcpLine.update({ where: { id: lineId }, data: { ...data, ...clearFormula, ...lock } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Dòng tự động đã sửa tay → trả về lấy số tự động từ sheet nguồn
export async function resetDtcpAutoLineAction(projectId: string, lineId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.dtcpLine.update({ where: { id: lineId }, data: { formula: "" } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Gõ công thức (bắt đầu bằng =) vào ô Thành tiền (columnId = null) hoặc ô của 1 cột bổ sung của DT-CP
export async function setDtcpFormulaAction(projectId: string, lineId: string, columnId: string | null, formula: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  const f = formula.trim();
  if (!f.startsWith("=")) return;
  if (columnId === null) {
    // dòng có liên kết (tự đồng bộ hoặc chọn sẵn): giữ nguyên khoá liên kết, công thức chỉ đè lên số; "Về tự động" xoá công thức là quay lại liên kết
    const cur = await prisma.dtcpLine.findUnique({ where: { id: lineId }, select: { linkSource: true } });
    await prisma.dtcpLine.update({ where: { id: lineId }, data: cur?.linkSource ? { formula: f } : { formula: f, linkSource: "" } });
  }
  else
    await prisma.dtcpCell.upsert({
      where: { lineId_columnId: { lineId, columnId } },
      create: { lineId, columnId, value: 0, formula: f },
      update: { formula: f },
    });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Kéo thả 1 dòng DT-CP (kể cả dòng tự đồng bộ từ sheet TH) vào làm con của 1 dòng khác (hoặc null =
// về gốc của section) - dòng cha sẽ tự cộng thêm giá trị dòng này vào tổng (buildDtcpRows luôn tính
// dòng có con = tổng các con). Chặn kéo vào chính nó hoặc vào con cháu của chính nó (vòng lặp vô hạn).
export async function moveDtcpLineAction(projectId: string, lineId: string, newParentId: string | null, newSection: "A" | "B") {
  await requireUser();
  await assertProjectEditable(projectId);
  if (newParentId === lineId) return;
  const all = await prisma.dtcpLine.findMany({ where: { projectId }, select: { id: true, parentId: true } });
  const descendants = new Set([lineId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of all) {
      if (l.parentId && descendants.has(l.parentId) && !descendants.has(l.id)) {
        descendants.add(l.id);
        grew = true;
      }
    }
  }
  if (newParentId && descendants.has(newParentId)) return; // không cho kéo vào chính nó / con cháu của nó
  const siblings = all.filter((l) => l.parentId === newParentId);
  const max = siblings.length ? await prisma.dtcpLine.aggregate({ where: { projectId, parentId: newParentId }, _max: { orderIndex: true } }) : null;
  await prisma.dtcpLine.update({
    where: { id: lineId },
    data: { parentId: newParentId, section: newSection, orderIndex: (max?._max.orderIndex ?? -1) + 1 },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function deleteDtcpLineAction(projectId: string, lineId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  const all = await prisma.dtcpLine.findMany({ where: { projectId }, select: { id: true, parentId: true } });
  const ids = new Set([lineId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of all) {
      if (l.parentId && ids.has(l.parentId) && !ids.has(l.id)) {
        ids.add(l.id);
        grew = true;
      }
    }
  }
  await prisma.dtcpLine.deleteMany({ where: { id: { in: [...ids] } } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function addDtcpColumnAction(projectId: string, title: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  const max = await prisma.dtcpColumn.aggregate({ where: { projectId }, _max: { orderIndex: true } });
  await prisma.dtcpColumn.create({
    data: { projectId, title: title.trim() || "Cột so sánh", orderIndex: (max._max.orderIndex ?? -1) + 1 },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function renameDtcpColumnAction(projectId: string, columnId: string, title: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.dtcpColumn.update({ where: { id: columnId }, data: { title } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function deleteDtcpColumnAction(projectId: string, columnId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.dtcpColumn.delete({ where: { id: columnId } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function setDtcpCellAction(projectId: string, lineId: string, columnId: string, value: number) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.dtcpCell.upsert({
    where: { lineId_columnId: { lineId, columnId } },
    create: { lineId, columnId, value },
    update: { value, formula: "" },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function updateVatRateAction(projectId: string, percent: number) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.project.update({ where: { id: projectId }, data: { vatRate: Math.max(0, percent) / 100 } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// ---- CHI TIẾT: hình thức thực hiện, hao hụt theo tài nguyên, tỷ lệ NC khác / MMTB ----
export async function setBoqMethodAction(projectId: string, boqItemId: string, method: "DETAIL" | "SUB") {
  await requireUser();
  await assertProjectEditable(projectId);
  const boq = await prisma.boqItem.findUnique({ where: { id: boqItemId }, include: { workItem: true } });
  if (!boq) return;
  await prisma.boqItem.update({ where: { id: boqItemId }, data: { method } });
  if (method === "SUB") {
    // thầu phụ trọn gói thay cho mọi phần giao riêng lẻ đã có
    await prisma.subcontractorItem.deleteMany({ where: { boqItemId, followBoq: false } });
    const exists = await prisma.subcontractorItem.findFirst({ where: { boqItemId } });
    if (!exists) {
      const max = await prisma.subcontractorItem.aggregate({ where: { projectId }, _max: { orderIndex: true } });
      await prisma.subcontractorItem.create({
        data: {
          projectId,
          boqItemId,
          followBoq: true,
          quantity: boq.quantity,
          name: boq.rawDescription || boq.workItem?.name || "Công tác thầu phụ",
          amount: 0,
          orderIndex: (max._max.orderIndex ?? 0) + 1,
        },
      });
    }
  } else {
    // về chiết tính: bỏ phần thầu phụ trọn gói, giữ các phần giao riêng lẻ (nếu có)
    await prisma.subcontractorItem.deleteMany({ where: { boqItemId, followBoq: true } });
  }
  await syncLaborByWork(projectId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function setResourceWastageAction(projectId: string, resourceId: string, percent: number | null) {
  await requireUser();
  await assertProjectEditable(projectId);
  if (percent === null || isNaN(percent)) {
    await prisma.projectResourceWastage.deleteMany({ where: { projectId, resourceId } });
  } else {
    const rate = Math.max(0, percent) / 100;
    await prisma.projectResourceWastage.upsert({
      where: { projectId_resourceId: { projectId, resourceId } },
      create: { projectId, resourceId, rate },
      update: { rate },
    });
  }
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function setExtraRateAction(projectId: string, kind: "ncKhacRate" | "tbRate" | "mmtbRate", percent: number) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.project.update({ where: { id: projectId }, data: { [kind]: Math.max(0, percent || 0) / 100 } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Nhận số thường hoặc công thức kiểu Excel (VD "=1/3"); trả lỗi nếu công thức sai
export async function updateWorkItemLineQuantityAction(lineId: string, raw: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await canDtcp("NORM_REVIEW"))) {
    // QSĐT (quyền lập DT-CP) hoặc quyền sửa định mức: sửa được ô Định mức hao phí
    if (!(await canDtcp("NORM", "EDIT"))) return { ok: false, error: "Bạn chưa được cấp quyền sửa định mức hao phí" };
  }
  const parsed = parseQuantityInput(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  await prisma.workItemResource.update({ where: { id: lineId }, data: { quantity: parsed.value, quantityFormula: parsed.formula } });
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---- TH Vật Tư: đầu mục lớn, sắp xếp, ghi chú ----
export async function addVtGroupAction(projectId: string, section: "A" | "B", name: string, kind: "VT" | "NC" | "TB" | "TP" = "VT") {
  await requireUser();
  await assertProjectEditable(projectId);
  const n = name.trim();
  if (!n) return;
  const max = await prisma.vtGroup.aggregate({ where: { projectId, section, kind }, _max: { orderIndex: true } });
  await prisma.vtGroup.create({ data: { projectId, kind, section, name: n, orderIndex: (max._max.orderIndex ?? -1) + 1 } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function renameVtGroupAction(projectId: string, groupId: string, name: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  if (!name.trim()) return;
  await prisma.vtGroup.update({ where: { id: groupId }, data: { name: name.trim() } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Bật/tắt hiện đầu mục lớn thành 1 dòng riêng ở sheet DT-CP (tắt = gộp chung vào "chưa phân nhóm")
export async function setVtGroupShowInDtcpAction(projectId: string, groupId: string, show: boolean) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.vtGroup.update({ where: { id: groupId }, data: { showInDtcp: show } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function deleteVtGroupAction(projectId: string, groupId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  // vật tư trong đầu mục bị xoá quay về "chưa phân nhóm" của cùng mục lớn
  await prisma.vtPlacement.updateMany({ where: { projectId, groupId }, data: { groupId: null } });
  await prisma.sheetManualItem.updateMany({ where: { projectId, groupId }, data: { groupId: null } });
  await prisma.subcontractorItem.updateMany({ where: { projectId, groupId }, data: { groupId: null } });
  await prisma.vtGroup.delete({ where: { id: groupId } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Đặt lại toàn bộ thứ tự của 1 khung (mục lớn + đầu mục lớn) sau khi kéo thả
export async function moveVtResourcesAction(
  projectId: string,
  section: "A" | "B",
  groupId: string | null,
  orderedResourceIds: string[],
  kind: "VT" | "NC" | "TB" = "VT"
) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.$transaction(
    orderedResourceIds.map((resourceId, i) =>
      prisma.vtPlacement.upsert({
        where: { projectId_resourceId_kind: { projectId, resourceId, kind } },
        create: { projectId, resourceId, kind, section, groupId, orderIndex: i },
        update: { section, groupId, orderIndex: i },
      })
    )
  );
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function setVtResourceNoteAction(projectId: string, resourceId: string, note: string, kind: "VT" | "NC" | "TB" = "VT") {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.vtPlacement.upsert({
    where: { projectId_resourceId_kind: { projectId, resourceId, kind } },
    create: { projectId, resourceId, kind, section: kind === "VT" ? "B" : "A", note },
    update: { note },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Nhập % ở đầu mục lớn → áp cho toàn bộ vật tư đang thuộc đầu mục (từng vật tư vẫn sửa riêng được sau đó)
export async function setVtGroupVatAction(
  projectId: string,
  items: { resourceId: string; priceAfterVat: number }[],
  vatPercent: number
) {
  await requireUser();
  await assertProjectEditable(projectId);
  const vatRate = Math.max(0, vatPercent || 0) / 100;
  await prisma.$transaction(
    items.map((i) =>
      prisma.projectResourcePrice.upsert({
        where: { projectId_resourceId: { projectId, resourceId: i.resourceId } },
        create: { projectId, resourceId: i.resourceId, unitPrice: i.priceAfterVat, vatRate },
        update: { vatRate },
      })
    )
  );
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function setVtGroupWastageAction(projectId: string, resourceIds: string[], percent: number | null) {
  await requireUser();
  await assertProjectEditable(projectId);
  if (percent === null || isNaN(percent)) {
    await prisma.projectResourceWastage.deleteMany({ where: { projectId, resourceId: { in: resourceIds } } });
  } else {
    const rate = Math.max(0, percent) / 100;
    await prisma.$transaction(
      resourceIds.map((resourceId) =>
        prisma.projectResourceWastage.upsert({
          where: { projectId_resourceId: { projectId, resourceId } },
          create: { projectId, resourceId, rate },
          update: { rate },
        })
      )
    );
  }
  revalidatePath(`/projects/${projectId}`, "layout");
}

// ---- Dòng tự bổ sung ở sheet TH Nhân Công (mục B: Nhân Công Khác) / TH Thiết Bị (mục B: Thiết Bị Khác) ----
export async function addManualItemAction(projectId: string, groupId: string | null, kind: "NC" | "TB" = "NC") {
  await requireUser();
  await assertProjectEditable(projectId);
  const max = await prisma.sheetManualItem.aggregate({ where: { projectId, kind }, _max: { orderIndex: true } });
  await prisma.sheetManualItem.create({
    data: { projectId, kind, groupId, name: kind === "NC" ? "Công tác mới" : "Thiết bị mới", orderIndex: (max._max.orderIndex ?? -1) + 1 },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Gõ công thức (bắt đầu bằng =, VD =LINK("boq_work")*0.5%) vào ô số của sheet TH Vật Tư / Nhân Công / Thiết Bị / Thầu Phụ
export async function setFieldFormulaAction(projectId: string, kind: "price" | "manual" | "sub", targetId: string, field: "unitPrice" | "quantity", formula: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  const f = formula.trim();
  if (!f.startsWith("=") || !["price", "manual", "sub"].includes(kind) || !["unitPrice", "quantity"].includes(field)) return;
  if (kind === "price") {
    await prisma.projectResourcePrice.upsert({ where: { projectId_resourceId: { projectId, resourceId: targetId } }, update: {}, create: { projectId, resourceId: targetId, unitPrice: 0, vatRate: 0 } });
  }
  await prisma.fieldFormula.upsert({
    where: { projectId_kind_targetId_field: { projectId, kind, targetId, field } },
    create: { projectId, kind, targetId, field, formula: f },
    update: { formula: f },
  });
  // đơn giá thầu phụ chuyển sang công thức → không còn là số tạm tính theo % giá CĐT
  if (kind === "sub" && field === "unitPrice") await prisma.subcontractorItem.updateMany({ where: { id: targetId, projectId }, data: { quotedPct: null } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// % quản lý của đội thi công (dòng nhân công ở TH Nhân Công, 1 dòng hoặc cả đầu mục): thành tiền = KL × đơn giá × (1 + %)
// (xem project-data.ts crewPct). Lưu ở VtPlacement kind NC, cột mgmtVtPct.
export async function setCrewMgmtPctAction(projectId: string, resourceIds: string[], pct: number): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  await assertProjectEditable(projectId);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, error: "Tỷ lệ % không hợp lệ (0 – 100)" };
  const data = { mgmtVtPct: pct };
  for (const resourceId of resourceIds)
    await prisma.vtPlacement.upsert({
      where: { projectId_resourceId_kind: { projectId, resourceId, kind: "NC" } },
      create: { projectId, resourceId, kind: "NC", section: "A", ...data },
      update: data,
    });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

// VAT % của dòng TH Thiết Bị (1 dòng hoặc cả đầu mục): key "res:<resourceId>" (giá riêng dự án, price = đơn giá trước
// VAT đang dùng - để tạo giá riêng khi chưa có) | "man:<id>" (dòng tự bổ sung). DT-CP lấy thành tiền sau VAT.
export async function setThVatAction(projectId: string, items: { key: string; price: number }[], vatPercent: number): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  await assertProjectEditable(projectId);
  if (!Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100) return { ok: false, error: "VAT % không hợp lệ (0 – 100)" };
  const vatRate = vatPercent / 100;
  for (const { key, price } of items) {
    const [kind, id] = key.split(":");
    if (kind === "res" && id)
      await prisma.projectResourcePrice.upsert({
        where: { projectId_resourceId: { projectId, resourceId: id } },
        create: { projectId, resourceId: id, unitPrice: price, vatRate },
        update: { vatRate },
      });
    else if (kind === "man" && id) await prisma.sheetManualItem.updateMany({ where: { id, projectId }, data: { vatRate } });
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

export async function updateManualItemAction(
  projectId: string,
  id: string,
  data: { name?: string; unit?: string; quantity?: number; unitPrice?: number; note?: string; days?: number | null }
) {
  await requireUser();
  await assertProjectEditable(projectId);
  for (const f of ["quantity", "unitPrice"] as const) if (data[f] !== undefined) await prisma.fieldFormula.deleteMany({ where: { projectId, kind: "manual", targetId: id, field: f } });
  if (data.days !== undefined && data.days !== null && !(Number.isFinite(data.days) && data.days >= 0)) return;
  const item = await prisma.sheetManualItem.update({ where: { id }, data });
  // dòng do "Tính toán thiết bị" tạo: số ngày thuê sửa tại sheet ghi ngược vào bản tính (tính lại không bị mất)
  if (data.days !== undefined && item.calcId) {
    const calc = await prisma.equipCalc.findUnique({ where: { id: item.calcId } });
    if (calc) {
      const params = JSON.parse(calc.params || "{}") as { daysOverrides?: Record<string, number> };
      const next = { ...(params.daysOverrides ?? {}) };
      if (data.days === null) delete next[item.name];
      else next[item.name] = data.days;
      await prisma.equipCalc.update({ where: { id: calc.id }, data: { params: JSON.stringify({ ...params, daysOverrides: next }) } });
      await applyEquipCalc(calc.id); // xoá trắng = về số ngày theo bản tính
    }
  }
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function moveManualItemAction(projectId: string, id: string, groupId: string | null) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.sheetManualItem.update({ where: { id }, data: { groupId } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// TH Vật Tư → TH Nhân Công: tạo dòng "Vận chuyển <vật tư>" ở mục B (đầu mục "VẬN CHUYỂN VẬT TƯ") cho các vật tư được chọn,
// số lượng LIÊN KẾT Tổng KL của vật tư (công thức LINK("vtq:<id>") → BOQ đổi thì tự cập nhật), người dùng chỉ nhập đơn giá.
// Vật tư đã có dòng vận chuyển liên kết thì bỏ qua (không tạo trùng).
// pct: % khối lượng vật tư tính vận chuyển (không phải 100% vật tư đều phải vận chuyển) - ghi vào công thức, sửa riêng từng dòng được
export async function createTransportLinesAction(projectId: string, resourceIds: string[], pct = 100): Promise<{ created: number; skipped: number }> {
  await requireUser();
  await assertProjectEditable(projectId);
  const resources = await prisma.resource.findMany({ where: { id: { in: resourceIds } }, select: { id: true, name: true, unit: true } });
  const linked = new Set(
    (await prisma.fieldFormula.findMany({ where: { projectId, kind: "manual", field: "quantity", formula: { contains: "vtq:" } } }))
      .map((f) => /vtq:([^"]+)"/.exec(f.formula)?.[1])
      .filter(Boolean) as string[]
  );
  const todo = resources.filter((r) => !linked.has(r.id));
  if (todo.length === 0) return { created: 0, skipped: resources.length };
  const GROUP = "VẬN CHUYỂN VẬT TƯ";
  const group =
    (await prisma.vtGroup.findFirst({ where: { projectId, kind: "NC", section: "B", name: GROUP } })) ??
    (await prisma.vtGroup.create({ data: { projectId, kind: "NC", section: "B", name: GROUP, orderIndex: ((await prisma.vtGroup.aggregate({ where: { projectId, kind: "NC" }, _max: { orderIndex: true } }))._max.orderIndex ?? 0) + 1 } }));
  let order = (await prisma.sheetManualItem.aggregate({ where: { projectId, kind: "NC" }, _max: { orderIndex: true } }))._max.orderIndex ?? 0;
  for (const r of todo) {
    const item = await prisma.sheetManualItem.create({ data: { projectId, kind: "NC", groupId: group.id, name: `Vận chuyển ${r.name}`, unit: r.unit, quantity: 0, unitPrice: 0, orderIndex: ++order } });
    const p = Math.round(Math.max(0, pct) * 1000) / 1000;
    await prisma.fieldFormula.create({ data: { projectId, kind: "manual", targetId: item.id, field: "quantity", formula: p === 100 ? `=LINK("vtq:${r.id}")` : `=LINK("vtq:${r.id}")*${p}%` } });
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  return { created: todo.length, skipped: resources.length - todo.length };
}

// Chuyển nhiều dòng tự bổ sung (mục B) sang 1 đầu mục cùng lúc
export async function moveManualItemsAction(projectId: string, ids: string[], groupId: string | null) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.sheetManualItem.updateMany({ where: { projectId, id: { in: ids } }, data: { groupId } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function deleteManualItemAction(projectId: string, id: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.sheetManualItem.delete({ where: { id } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// ---- CHI TIẾT: chuyển hàng loạt cả đầu mục sang Thầu phụ / Chiết tính (từng công tác vẫn đổi riêng được) ----
export async function setBoqMethodBulkAction(projectId: string, boqItemIds: string[], method: "DETAIL" | "SUB") {
  await requireUser();
  await assertProjectEditable(projectId);
  for (const id of boqItemIds) await setBoqMethodAction(projectId, id, method);
}

// ---- TH Thầu Phụ ----
// quotedPct: chỉ khi đơn giá là số tạm tính theo % giá báo CĐT - sửa / dán đơn giá tay thì tự bỏ
type SubItemPatch = { name?: string; unit?: string; quantity?: number; unitPrice?: number; quotedPct?: number | null; contractorName?: string; note?: string };

export async function updateSubItemAction(projectId: string, id: string, data: SubItemPatch) {
  await requireUser();
  await assertProjectEditable(projectId);
  await applySubItemPatch(projectId, id, data);
  revalidatePath(`/projects/${projectId}`, "layout");
}

async function applySubItemPatch(projectId: string, id: string, data: SubItemPatch) {
  for (const f of ["quantity", "unitPrice"] as const) if (data[f] !== undefined) await prisma.fieldFormula.deleteMany({ where: { projectId, kind: "sub", targetId: id, field: f } });
  const cur = await prisma.subcontractorItem.findUnique({ where: { id }, include: { boqItem: true } });
  if (!cur || cur.projectId !== projectId) return;
  const linked = !!cur.boqItem;
  // dòng link từ BOQ: tên/ĐVT lấy theo BOQ; thầu phụ trọn gói lấy cả SL theo BOQ, phần giao riêng lẻ nhập SL của phần đó
  const merged = {
    name: linked ? cur.name : data.name ?? cur.name,
    unit: linked ? cur.unit : data.unit ?? cur.unit,
    quantity: linked && cur.followBoq ? cur.boqItem!.quantity : data.quantity ?? cur.quantity,
    unitPrice: data.unitPrice ?? cur.unitPrice,
  };
  await prisma.subcontractorItem.update({
    where: { id },
    data: {
      ...(linked ? (cur.followBoq ? {} : { quantity: merged.quantity }) : { name: merged.name, unit: merged.unit, quantity: merged.quantity }),
      unitPrice: merged.unitPrice,
      ...(data.unitPrice !== undefined ? { quotedPct: data.quotedPct ?? null } : {}),
      amount: merged.quantity * merged.unitPrice,
      ...(data.contractorName !== undefined ? { contractorName: data.contractorName } : {}),
      ...(data.note !== undefined ? { note: data.note } : {}),
    },
  });
}

// Thuế suất VAT của dòng thầu phụ (1 dòng, hoặc mọi dòng của 1 đầu mục). pct: 8 = 8%. Thành tiền sau VAT đi vào DT-CP.
export async function setSubVatAction(projectId: string, itemIds: string[], pct: number): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  await assertProjectEditable(projectId);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, error: "VAT % không hợp lệ (0 – 100)" };
  await prisma.subcontractorItem.updateMany({ where: { projectId, id: { in: itemIds } }, data: { vatRate: pct / 100 } });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

// % Prelim của dòng thầu phụ (1 dòng, hoặc mọi dòng của 1 đầu mục). pct: 5 = 5%. Thành tiền = SL × đơn giá × (1 + %)
export async function setSubPrelimAction(projectId: string, itemIds: string[], pct: number): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  await assertProjectEditable(projectId);
  if (!Number.isFinite(pct) || pct < 0 || pct > 1000) return { ok: false, error: "% Prelim không hợp lệ" };
  await prisma.subcontractorItem.updateMany({ where: { projectId, id: { in: itemIds } }, data: { prelimPct: pct } });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

// Tạm tính đơn giá thầu phụ = pct% × đơn giá đang báo CĐT của dòng BOQ (khi chưa có giá thầu phụ duyệt). Chỉ áp
// cho dòng thầu phụ nối BOQ có giá báo CĐT; onlyEmpty = chỉ điền dòng chưa có đơn giá (không đè giá đã nhập).
export async function setSubPriceFromQuotedAction(
  projectId: string,
  itemIds: string[],
  pct: number,
  onlyEmpty: boolean
): Promise<{ ok: boolean; count: number; noQuoted: number; kept: number; error?: string }> {
  await requireUser();
  await assertProjectEditable(projectId);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) return { ok: false, count: 0, noQuoted: 0, kept: 0, error: "Tỷ lệ % không hợp lệ" };
  const items = await prisma.subcontractorItem.findMany({ where: { projectId, id: { in: itemIds } }, include: { boqItem: { select: { quotedUnitPrice: true } } } });
  let count = 0;
  let noQuoted = 0;
  let kept = 0;
  for (const it of items) {
    const q = it.boqItem?.quotedUnitPrice;
    if (q == null || q <= 0) {
      noQuoted++;
      continue;
    }
    if (onlyEmpty && it.unitPrice > 0) {
      kept++;
      continue;
    }
    await applySubItemPatch(projectId, it.id, { unitPrice: Math.round((q * pct) / 100), quotedPct: pct });
    count++;
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, count, noQuoted, kept };
}

// Dán số hàng loạt (copy từ Excel, hoặc 1 giá trị vào nhiều ô đang chọn) ở sheet TH Vật Tư / Nhân Công / Thiết Bị / Thầu Phụ
// - lưu 1 lần. key của từng ô: "res:<resourceId>" (tài nguyên của dự án) | "man:<id>" (dòng tự bổ sung) | "sub:<id>" (dòng
// thầu phụ). field: đơn giá / số lượng, hoặc tỷ lệ % (vat, waste = hao hụt vật tư, crewPct = % quản lý đội thi công; 8 = 8%).
// Ô đang dùng công thức bị thay bằng số vừa dán (giống gõ tay).
export type PasteField = "unitPrice" | "quantity" | "vat" | "waste" | "crewPct" | "prelim";
export async function pasteSheetNumbersAction(
  projectId: string,
  field: PasteField,
  entries: { key: string; value: number }[]
): Promise<{ ok: boolean; count: number; error?: string }> {
  await requireUser();
  await assertProjectEditable(projectId);
  let count = 0;
  for (const { key, value } of entries) {
    if (!Number.isFinite(value)) continue;
    const [kind, id] = key.split(":");
    if (!id) continue;
    if (field === "prelim") {
      if (kind !== "sub" || value < 0 || value > 1000) continue;
      await prisma.subcontractorItem.updateMany({ where: { id, projectId }, data: { prelimPct: value } });
      count++;
      continue;
    }
    if (field === "vat" || field === "waste" || field === "crewPct") {
      if (value < 0 || value > 100) continue;
      const rate = value / 100;
      if (field === "vat" && kind === "res") {
        const base = await prisma.resource.findUnique({ where: { id }, select: { unitPrice: true } });
        if (!base) continue;
        await prisma.projectResourcePrice.upsert({ where: { projectId_resourceId: { projectId, resourceId: id } }, create: { projectId, resourceId: id, unitPrice: base.unitPrice, vatRate: rate }, update: { vatRate: rate } });
      } else if (field === "vat" && kind === "man") await prisma.sheetManualItem.updateMany({ where: { id, projectId }, data: { vatRate: rate } });
      else if (field === "vat" && kind === "sub") await prisma.subcontractorItem.updateMany({ where: { id, projectId }, data: { vatRate: rate } });
      else if (field === "waste" && kind === "res") await prisma.projectResourceWastage.upsert({ where: { projectId_resourceId: { projectId, resourceId: id } }, create: { projectId, resourceId: id, rate }, update: { rate } });
      else if (field === "crewPct" && kind === "res")
        await prisma.vtPlacement.upsert({ where: { projectId_resourceId_kind: { projectId, resourceId: id, kind: "NC" } }, create: { projectId, resourceId: id, kind: "NC", section: "A", mgmtVtPct: value }, update: { mgmtVtPct: value } });
      else continue;
      count++;
      continue;
    }
    if (kind === "res" && field === "unitPrice") {
      await prisma.fieldFormula.deleteMany({ where: { projectId, kind: "price", targetId: id, field: "unitPrice" } });
      await prisma.projectResourcePrice.upsert({
        where: { projectId_resourceId: { projectId, resourceId: id } },
        update: { unitPrice: value },
        create: { projectId, resourceId: id, unitPrice: value, vatRate: 0 },
      });
    } else if (kind === "man") {
      await prisma.fieldFormula.deleteMany({ where: { projectId, kind: "manual", targetId: id, field } });
      await prisma.sheetManualItem.updateMany({ where: { id, projectId }, data: { [field]: value } });
    } else if (kind === "sub") {
      await applySubItemPatch(projectId, id, { [field]: value });
    } else continue;
    count++;
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, count };
}

export async function addSubManualAction(projectId: string, groupId: string | null) {
  await requireUser();
  await assertProjectEditable(projectId);
  const max = await prisma.subcontractorItem.aggregate({ where: { projectId }, _max: { orderIndex: true } });
  await prisma.subcontractorItem.create({
    data: { projectId, groupId, name: "Công tác thầu phụ mới", amount: 0, orderIndex: (max._max.orderIndex ?? 0) + 1 },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// ---- Giao thầu phụ theo ĐẦU MỤC LỚN: chọn % khối lượng + phạm vi bao (VT/TB/NC) + các công tác con; mỗi công tác con có 1 phần giao ----
export type HeadingSubInput = { assignId?: string | null; contractorName: string; percent: number; coverVT: boolean; coverTB: boolean; coverNC: boolean; itemIds: string[] };

export async function applyHeadingSubAction(projectId: string, headingId: string, input: HeadingSubInput) {
  await requireUser();
  await assertProjectEditable(projectId);
  const pct = Math.max(0, Math.min(100, input.percent || 0));
  const assignId = input.assignId || crypto.randomUUID();
  const items = await prisma.boqItem.findMany({
    where: { projectId, id: { in: input.itemIds }, isHeading: false, method: "DETAIL", workItemId: { not: null } },
    include: { workItem: true },
  });
  const mine = await prisma.subcontractorItem.findMany({ where: { projectId, assignId } });
  const max = await prisma.subcontractorItem.aggregate({ where: { projectId }, _max: { orderIndex: true } });
  let order = (max._max.orderIndex ?? 0) + 1;
  for (const b of items) {
    const quantity = (pct / 100) * b.quantity;
    const data = { followBoq: false, percent: pct, quantity, coverVT: input.coverVT, coverTB: input.coverTB, coverNC: input.coverNC, coveredLines: null, contractorName: input.contractorName.trim(), fromHeadingId: headingId, assignId };
    const cur = mine.find((x) => x.boqItemId === b.id);
    if (cur) await prisma.subcontractorItem.update({ where: { id: cur.id }, data: { ...data, amount: quantity * cur.unitPrice } });
    else
      await prisma.subcontractorItem.create({
        data: { ...data, projectId, boqItemId: b.id, name: b.rawDescription || b.workItem?.name || "Phần giao thầu phụ", unit: b.rawUnit || b.workItem?.unit || "", amount: 0, orderIndex: order++ },
      });
  }
  // công tác bỏ khỏi lần giao này thì xoá phần giao tương ứng
  const keep = new Set(items.map((b) => b.id));
  const drop = mine.filter((x) => x.boqItemId && !keep.has(x.boqItemId)).map((x) => x.id);
  if (drop.length) await prisma.subcontractorItem.deleteMany({ where: { id: { in: drop } } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function deleteHeadingSubAction(projectId: string, assignId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.subcontractorItem.deleteMany({ where: { projectId, assignId } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// ---- Chia 1 dòng BOQ thành nhiều phần giao thầu phụ (mỗi phần: khối lượng, phạm vi bao VT/TB/NC hoặc từng dòng hao phí, đơn giá) ----
// scope "work" = thầu phụ làm 1 PHẦN VIỆC (VD hệ khung sắt của quầy đá): đủ khối lượng BOQ, không thay dòng hao phí nào
// (chi phí thầu phụ cộng thêm); mặc định = giao phần khối lượng còn lại, thầu phụ bao theo nhóm VT/TB/NC
export async function addSubPortionAction(projectId: string, boqItemId: string, scope: "qty" | "work" = "qty") {
  await requireUser();
  await assertProjectEditable(projectId);
  const boq = await prisma.boqItem.findUnique({ where: { id: boqItemId }, include: { workItem: true, subcontractorItems: true } });
  if (!boq || boq.method === "SUB") return;
  const used = boq.subcontractorItems.reduce((s, x) => s + x.quantity, 0);
  const max = await prisma.subcontractorItem.aggregate({ where: { projectId }, _max: { orderIndex: true } });
  await prisma.subcontractorItem.create({
    data: {
      projectId,
      boqItemId,
      followBoq: false,
      name: boq.rawDescription || boq.workItem?.name || "Phần giao thầu phụ",
      unit: boq.rawUnit || boq.workItem?.unit || "",
      quantity: scope === "work" ? boq.quantity : Math.max(0, boq.quantity - used),
      ...(scope === "work" ? { coveredLines: "[]" } : {}),
      amount: 0,
      orderIndex: (max._max.orderIndex ?? 0) + 1,
    },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function updateSubPortionAction(
  projectId: string,
  id: string,
  data: { quantity?: number; percent?: number | null; coverVT?: boolean; coverTB?: boolean; coverNC?: boolean; coveredLines?: string[] | null; note?: string }
) {
  await requireUser();
  await assertProjectEditable(projectId);
  const cur = await prisma.subcontractorItem.findUnique({ where: { id } });
  if (data.note !== undefined && cur) {
    await prisma.subcontractorItem.update({ where: { id }, data: { note: data.note.trim() } });
    if (Object.keys(data).length === 1) return void revalidatePath(`/projects/${projectId}`, "layout");
  }
  if (!cur || !cur.boqItemId) return;
  await prisma.fieldFormula.deleteMany({ where: { projectId, kind: "sub", targetId: id, field: "quantity" } });
  // nhập % giao: khối lượng = % × khối lượng BOQ (chính xác, không dính lỗi làm tròn khi chép khối lượng đang hiển thị 2 số lẻ)
  const pct = data.percent != null ? Math.max(0, Math.min(100, data.percent)) : null;
  const boqQty = pct != null ? (await prisma.boqItem.findUnique({ where: { id: cur.boqItemId }, select: { quantity: true } }))?.quantity ?? 0 : 0;
  const quantity = pct != null ? (pct / 100) * boqQty : data.quantity ?? cur.quantity;
  const flagChanged = data.coverVT !== undefined || data.coverTB !== undefined || data.coverNC !== undefined;
  await prisma.subcontractorItem.update({
    where: { id },
    data: {
      quantity,
      ...(pct != null ? { percent: pct } : data.quantity !== undefined ? { percent: null } : {}), // nhập % thì giữ chế độ theo %; nhập tay khối lượng thì bỏ chế độ theo %
      amount: quantity * cur.unitPrice,
      ...(data.coverVT !== undefined ? { coverVT: data.coverVT } : {}),
      ...(data.coverTB !== undefined ? { coverTB: data.coverTB } : {}),
      ...(data.coverNC !== undefined ? { coverNC: data.coverNC } : {}),
      // đổi 3 ô VT/TB/NC thì quay về chọn theo nhóm; chọn riêng từng dòng thì lưu danh sách
      ...(data.coveredLines !== undefined ? { coveredLines: data.coveredLines === null ? null : JSON.stringify(data.coveredLines) } : flagChanged ? { coveredLines: null } : {}),
    },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Nhập 1 tên thầu phụ cho cả đầu mục
export async function setSubContractorBulkAction(projectId: string, ids: string[], contractorName: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.subcontractorItem.updateMany({ where: { projectId, id: { in: ids } }, data: { contractorName } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Tỷ lệ chi phí quản lý vật tư / thiết bị TMN cấp cho 1 nhà thầu phụ (% trên giá trị VT / TB cấp - xem project-data.ts)
export async function setSubMgmtRatesAction(projectId: string, name: string, rates: { vtPct?: number; tbPct?: number }): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  await assertProjectEditable(projectId);
  const n = name.trim();
  if (!n) return { ok: false, error: "Chưa có tên nhà thầu" };
  const ok = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v >= 0 && v <= 100);
  if (!ok(rates.vtPct) || !ok(rates.tbPct)) return { ok: false, error: "Tỷ lệ % không hợp lệ (0 – 100)" };
  const data = { ...(rates.vtPct !== undefined ? { mgmtVtPct: rates.vtPct } : {}), ...(rates.tbPct !== undefined ? { mgmtTbPct: rates.tbPct } : {}) };
  await prisma.subcontractorNameToggle.upsert({ where: { projectId_name: { projectId, name: n } }, create: { projectId, name: n, ...data }, update: data });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

// % chi phí quản lý vật tư ("vt") / thiết bị ("tb") riêng cho 1 phần giao thầu phụ (sửa ở dòng Quản lý VT / TB của CHI TIẾT).
// pct = null → bỏ % riêng, quay về tỷ lệ mặc định của nhà thầu.
export async function setPortionMgmtPctAction(projectId: string, subId: string, kind: "vt" | "tb", pct: number | null): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  await assertProjectEditable(projectId);
  if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return { ok: false, error: "Tỷ lệ % không hợp lệ (0 – 100)" };
  await prisma.subcontractorItem.updateMany({ where: { id: subId, projectId }, data: kind === "vt" ? { mgmtVtPct: pct } : { mgmtTbPct: pct } });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

// Bật/tắt hiện riêng 1 dòng theo tên thầu phụ bên sheet DT-CP (dưới "Thầu phụ theo CHI TIẾT")
export async function setSubcontractorNameShowInDtcpAction(projectId: string, name: string, show: boolean) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.subcontractorNameToggle.upsert({
    where: { projectId_name: { projectId, name } },
    create: { projectId, name, showInDtcp: show },
    update: { showInDtcp: show },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Áp bảng báo giá Excel của thầu phụ: cập nhật đơn giá các dòng đã có, thêm dòng mới ngoài BOQ
export async function applySubQuoteAction(
  projectId: string,
  payload: {
    contractorName: string;
    updates: { id: string; unitPrice: number; quantity?: number }[];
    creates: { name: string; unit: string; quantity: number; unitPrice: number }[];
  }
) {
  await requireUser();
  await assertProjectEditable(projectId);
  let updated = 0;
  // Đơn giá theo báo giá: bỏ công thức / % tạm tính đang có của ô đơn giá. Dòng nối BOQ giữ SL đang giao (SL theo BOQ /
  // phần giao), chỉ dòng thầu phụ bổ sung (tự nhập) mới lấy SL trong file.
  for (const u of payload.updates) {
    const cur = await prisma.subcontractorItem.findUnique({ where: { id: u.id }, select: { projectId: true, boqItemId: true } });
    if (!cur || cur.projectId !== projectId) continue;
    await applySubItemPatch(projectId, u.id, {
      unitPrice: u.unitPrice,
      ...(!cur.boqItemId && u.quantity !== undefined ? { quantity: u.quantity } : {}),
      ...(payload.contractorName ? { contractorName: payload.contractorName } : {}),
    });
    updated++;
  }
  const max = await prisma.subcontractorItem.aggregate({ where: { projectId }, _max: { orderIndex: true } });
  let order = (max._max.orderIndex ?? 0) + 1;
  for (const c of payload.creates) {
    await prisma.subcontractorItem.create({
      data: {
        projectId,
        name: c.name,
        unit: c.unit,
        quantity: c.quantity,
        unitPrice: c.unitPrice,
        amount: c.quantity * c.unitPrice,
        contractorName: payload.contractorName,
        orderIndex: order++,
      },
    });
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  return { updated, created: payload.creates.length };
}

// ---- BOQ: sửa nội dung / bổ sung dòng sau khi nhập từ Excel ----
export async function updateBoqItemTextAction(
  projectId: string,
  boqItemId: string,
  data: { rawDescription?: string; rawUnit?: string; stt?: string; note?: string }
) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.boqItem.update({ where: { id: boqItemId }, data });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Thêm dòng công tác / đầu mục trống ngay dưới 1 dòng (afterBoqItemId = null: cuối bảng)
export async function insertBoqRowAction(projectId: string, afterBoqItemId: string | null, isHeading: boolean, sheetIdParam: string | null = null) {
  await requireUser();
  await assertProjectEditable(projectId);
  let order: number;
  let sheetId: string | null = sheetIdParam;
  let anchorId: string | null = afterBoqItemId; // dòng làm mốc đánh STT (thêm dưới cụm dòng tổng thì mốc là dòng cuối trước cụm đó)
  if (afterBoqItemId) {
    let after = await prisma.boqItem.findUnique({ where: { id: afterBoqItemId } });
    if (!after) return;
    sheetId = after.sheetId;
    // các dòng tổng cuối BOQ (Tổng cộng / VAT / sau thuế) luôn nằm cuối cùng: thêm "dưới" chúng thì chèn lên trên cụm này
    const sheetRows = await prisma.boqItem.findMany({ where: { projectId, sheetId }, orderBy: { orderIndex: "asc" }, select: { id: true, rawDescription: true, isHeading: true, orderIndex: true } });
    const firstSummary = sheetRows.find((r) => r.isHeading && summaryKind(r.rawDescription));
    if (firstSummary && after.orderIndex >= firstSummary.orderIndex) {
      const prev = [...sheetRows].reverse().find((r) => r.orderIndex < firstSummary.orderIndex);
      if (prev) {
        after = (await prisma.boqItem.findUnique({ where: { id: prev.id } })) ?? after;
        anchorId = prev.id;
      }
    }
    order = after.orderIndex + 1;
    // Thêm ĐẦU MỤC mới ngay dưới 1 đầu mục đã có công tác con: đặt sau toàn bộ khối của đầu mục đó (công tác con + đầu mục con),
    // để các công tác con không bị chuyển sang đầu mục mới tạo.
    if (isHeading && after.isHeading) {
      const sheetItems = await prisma.boqItem.findMany({ where: { projectId, sheetId: after.sheetId }, orderBy: { orderIndex: "asc" }, select: { id: true, isHeading: true, stt: true, level: true, orderIndex: true, rawDescription: true } });
      const tree = computeBoqTree(sheetItems);
      const block = new Set([...(tree.scope.get(after.id) ?? []), ...(tree.headingScope.get(after.id) ?? [])]);
      for (const it of sheetItems) if (block.has(it.id)) order = Math.max(order, it.orderIndex + 1);
    }
    await prisma.boqItem.updateMany({ where: { projectId, orderIndex: { gte: order } }, data: { orderIndex: { increment: 1 } } });
  } else {
    const rows = await prisma.boqItem.findMany({ where: { projectId, sheetId }, orderBy: { orderIndex: "asc" }, select: { orderIndex: true, rawDescription: true, isHeading: true } });
    const firstSummary = rows.find((r) => r.isHeading && summaryKind(r.rawDescription));
    if (firstSummary) {
      order = firstSummary.orderIndex;
      await prisma.boqItem.updateMany({ where: { projectId, orderIndex: { gte: order } }, data: { orderIndex: { increment: 1 } } });
    } else {
      const max = await prisma.boqItem.aggregate({ where: { projectId }, _max: { orderIndex: true } });
      order = (max._max.orderIndex ?? 0) + 1;
    }
  }
  // STT ban đầu: cùng kiểu với dòng đứng trước (sau đó đánh lại số cho cả bảng)
  let stt = "";
  if (afterBoqItemId) {
    const anchor = await prisma.boqItem.findUnique({ where: { id: anchorId ?? afterBoqItemId } });
    if (anchor && anchor.isHeading === isHeading) stt = anchor.stt;
    else if (anchor && anchor.isHeading && !isHeading) stt = "1";
  }
  await prisma.boqItem.create({
    data: {
      projectId,
      isHeading,
      stt,
      sheetId,
      quantity: 0,
      rawDescription: isHeading ? "Đầu mục mới" : "Công tác mới",
      orderIndex: order,
    },
  });
  await renumberProjectBoq(projectId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Chèn 1 công tác / đầu mục ngay TRÊN dòng beforeBoqItemId (VD thêm đầu mục lớn lên trên mục A). Đầu mục mới cùng cấp
// và cùng kiểu số thứ tự với dòng đó (A, I, 1...) rồi đánh lại số cả bảng → mục mới thành "A", các mục cũ lùi xuống.
export async function insertBoqRowBeforeAction(projectId: string, beforeBoqItemId: string, isHeading: boolean) {
  await requireUser();
  await assertProjectEditable(projectId);
  const before = await prisma.boqItem.findUnique({ where: { id: beforeBoqItemId } });
  if (!before || before.projectId !== projectId) return;
  await prisma.boqItem.updateMany({ where: { projectId, orderIndex: { gte: before.orderIndex } }, data: { orderIndex: { increment: 1 } } });
  await prisma.boqItem.create({
    data: {
      projectId,
      isHeading,
      stt: before.isHeading === isHeading ? before.stt : "",
      level: isHeading && before.isHeading ? before.level : null,
      sheetId: before.sheetId,
      quantity: 0,
      rawDescription: isHeading ? "Đầu mục mới" : "Công tác mới",
      orderIndex: before.orderIndex,
    },
  });
  await renumberProjectBoq(projectId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Đổi 1 dòng BOQ giữa "đầu mục" và "công tác" (khi nhập Excel nhận diện sai)
export async function setBoqHeadingAction(projectId: string, boqItemId: string, isHeading: boolean) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.boqItem.update({
    where: { id: boqItemId },
    data: isHeading ? { isHeading: true, quantity: 0, workItemId: null, method: "DETAIL" } : { isHeading: false },
  });
  await prisma.subcontractorItem.deleteMany({ where: { boqItemId } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// ---- Tạo định mức mới thủ công (lưu vào danh mục dùng chung cho các gói thầu khác) ----
export type NewNormLine = { category: "VT" | "NC" | "TB"; code: string; name: string; unit: string; quantity: string; unitPrice: number };

export async function createManualNormAction(
  projectId: string,
  boqItemId: string,
  payload: { code: string; name: string; unit: string; lines: NewNormLine[] }
): Promise<{ ok: boolean; error?: string; workItemId?: string }> {
  const user = await requireUser();
  await assertProjectEditable(projectId);
  const code = payload.code.trim();
  const name = payload.name.trim();
  if (!code) return { ok: false, error: "Chưa nhập mã định mức mới" };
  if (!name) return { ok: false, error: "Chưa nhập tên công tác" };
  const dup = await prisma.workItem.findFirst({ where: { code } });
  if (dup) return { ok: false, error: `Mã định mức "${code}" đã có trong danh mục (${dup.name}). Hãy dùng mã khác hoặc chọn mã đó ở ô "Chọn".` };

  const parsed: (NewNormLine & { qty: number; formula: string | null })[] = [];
  for (const l of payload.lines.filter((x) => x.name.trim() || x.code.trim())) {
    const q = parseQuantityInput(l.quantity);
    if (!q.ok) return { ok: false, error: `Định mức của "${l.name || l.code}" không hợp lệ: ${q.error}` };
    parsed.push({ ...l, name: l.name.trim(), code: l.code.trim(), qty: q.value, formula: q.formula });
  }

  const existing = await prisma.resource.findMany({ select: { id: true, code: true, name: true } });
  const norm = (s: string) => normalizeText(s);
  const byName = new Map(existing.map((r) => [norm(r.name), r]));
  const byCode = new Map(existing.map((r) => [r.code.toLowerCase(), r]));
  const usedCodes = new Set(existing.map((r) => r.code.toLowerCase()));
  const PREFIX = { VT: "VT", NC: "NC", TB: "TB" } as const;
  const newResourceIds: string[] = [];

  const workItemId = await prisma.$transaction(async (tx) => {
    const workItem = await tx.workItem.create({
      data: { code, name, unit: payload.unit.trim(), section: "BỔ SUNG THỦ CÔNG", subsection: "", note: `Tạo thủ công bởi ${user.name ?? "người dùng"}` },
    });
    for (const l of parsed) {
      // ưu tiên khớp theo mã, rồi theo tên; không có thì tạo mới (mã do người dùng nhập, hoặc tự sinh)
      let res = (l.code && byCode.get(l.code.toLowerCase())) || (l.name && byName.get(norm(l.name))) || undefined;
      if (!res) {
        if (!l.name) throw new Error(`Dòng có mã "${l.code}" chưa có trong danh mục nên cần nhập cả tên`);
        let rc = l.code;
        if (!rc) {
          const slug = norm(l.name).replace(/\s+/g, "").toUpperCase().slice(0, 14) || "MOI";
          rc = `${PREFIX[l.category]}.${slug}`;
          let i = 2;
          while (usedCodes.has(rc.toLowerCase())) rc = `${PREFIX[l.category]}.${slug}${i++}`;
        }
        const created = await tx.resource.create({
          data: { code: rc, name: l.name, unit: l.unit.trim(), unitPrice: l.unitPrice || 0, sourceType: l.category, groupLabel: "(Thêm thủ công)" },
        });
        usedCodes.add(rc.toLowerCase());
        res = { id: created.id, code: rc, name: l.name };
        byCode.set(rc.toLowerCase(), res);
        byName.set(norm(l.name), res);
        newResourceIds.push(created.id);
      }
      await tx.workItemResource.create({
        data: { workItemId: workItem.id, resourceId: res.id, category: l.category, quantity: l.qty, quantityFormula: l.formula, wastageRate: 0 },
      });
    }
    const boq = await tx.boqItem.update({ where: { id: boqItemId }, data: { workItemId: workItem.id } });
    // nhớ cách gọi tên này để lần nhập BOQ sau tự khớp
    await learnAlias(tx, boq.rawDescription || name, workItem.id);
    return workItem.id;
  });

  // Người dùng thường thêm → báo cho người duyệt định mức kiểm tra / thống nhất mã
  if (!(await canDtcp("NORM_REVIEW"))) {
    await prisma.catalogChange.create({
      data: {
        userId: user.id,
        userName: user.name ?? user.username ?? "Người dùng",
        workItemId,
        workItemCode: code,
        workItemName: name,
        resourceIds: newResourceIds.join(","),
      },
    });
  }
  await syncLaborByWork(projectId);
  revalidatePath("/", "layout");
  return { ok: true, workItemId };
}

// Xoá định mức tự tạo (bấm nhầm "Bổ sung định mức"): người tạo hoặc người duyệt định mức; chỉ khi chưa dòng BOQ dự án khác dùng
export async function deleteManualNormAction(projectId: string, workItemId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  await assertProjectEditable(projectId);
  const wi = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { id: true, code: true, section: true } });
  if (!wi) return { ok: false, error: "Không tìm thấy định mức" };
  if (wi.section !== "BỔ SUNG THỦ CÔNG") return { ok: false, error: "Chỉ xoá được định mức do người dùng tự tạo (định mức chuẩn trong danh mục thì không xoá)" };
  const reviewer = await canDtcp("NORM_REVIEW");
  const changes = await prisma.catalogChange.findMany({ where: { workItemId, kind: "NORM" } });
  if (!reviewer && !changes.some((c) => c.userId === user.id)) return { ok: false, error: "Chỉ người đã tạo định mức này (hoặc người duyệt định mức) mới xoá được" };
  if (!reviewer && changes.some((c) => c.reviewed && !c.rejected)) return { ok: false, error: "Định mức này đã được duyệt thống nhất mã nên không tự xoá được — nhờ người duyệt định mức" };
  const other = await prisma.boqItem.count({ where: { workItemId, projectId: { not: projectId } } });
  if (other > 0) return { ok: false, error: `Định mức ${wi.code} đang được ${other} dòng BOQ ở dự án khác dùng nên không xoá được` };
  const resIds = changes.flatMap((c) => c.resourceIds.split(",").filter(Boolean));
  try {
    await prisma.$transaction(async (tx) => {
      await tx.boqItem.updateMany({ where: { workItemId }, data: { workItemId: null } });
      await tx.workItem.delete({ where: { id: workItemId } }); // dòng hao phí + cách gọi đã nhớ xoá theo
      for (const id of resIds) {
        if ((await tx.workItemResource.count({ where: { resourceId: id } })) === 0) await tx.resource.deleteMany({ where: { id } });
      }
      await tx.catalogChange.deleteMany({ where: { workItemId, reviewed: false } });
    });
  } catch {
    return { ok: false, error: "Định mức đang được dùng ở nơi khác nên chưa xoá được" };
  }
  await syncLaborByWork(projectId);
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---- Admin: kiểm tra / thống nhất mã định mức do người dùng tự thêm ----
export async function reviewCatalogChangeAction(
  changeId: string,
  workItemCode: string,
  resourceCodes: Record<string, string>
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireNormReviewer();
  const change = await prisma.catalogChange.findUnique({ where: { id: changeId } });
  if (!change) return { ok: false, error: "Không tìm thấy bản ghi" };

  // Thêm dòng hao phí vào định mức CÓ SẴN: không đổi mã định mức → không kiểm tra trùng mã định mức.
  // Định mức mới: chỉ báo trùng với định mức đang dùng (định mức cũ đã ẩn - VD trùng mã bộ chuẩn phần thô - bỏ qua).
  const isLines = change.kind === "LINES" || change.kind === "REMOVE";
  const wCode = isLines ? change.workItemCode : workItemCode.trim();
  if (!wCode) return { ok: false, error: "Mã định mức không được để trống" };
  if (!isLines) {
    const wDup = await prisma.workItem.findFirst({ where: { code: wCode, active: true, NOT: { id: change.workItemId } } });
    if (wDup) return { ok: false, error: `Mã định mức "${wCode}" đã dùng cho "${wDup.name}"` };
  }

  const updates: { id: string; code: string }[] = [];
  for (const [id, raw] of Object.entries(resourceCodes)) {
    const rc = raw.trim();
    if (!rc) return { ok: false, error: "Mã vật tư/nhân công/máy không được để trống" };
    const dup = await prisma.resource.findFirst({ where: { code: rc, NOT: { id } } });
    if (dup) return { ok: false, error: `Mã "${rc}" đã dùng cho "${dup.name}"` };
    updates.push({ id, code: rc });
  }
  if (new Set(updates.map((u) => u.code.toLowerCase())).size !== updates.length) return { ok: false, error: "Có 2 mã trùng nhau trong cùng bản ghi" };

  // đề nghị xoá được duyệt → xoá các dòng hao phí đó khỏi định mức
  if (change.kind === "REMOVE") await prisma.workItemResource.deleteMany({ where: { id: { in: change.lineIds.split(",").filter(Boolean) } } });
  await prisma.$transaction([
    prisma.workItem.update({ where: { id: change.workItemId }, data: { code: wCode } }),
    ...updates.map((u) => prisma.resource.update({ where: { id: u.id }, data: { code: u.code } })),
    prisma.catalogChange.update({
      where: { id: changeId },
      data: { reviewed: true, reviewedByName: admin.name ?? "admin", reviewedAt: new Date(), workItemCode: wCode },
    }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true };
}

// Không duyệt định mức do người dùng thêm: gỡ định mức khỏi các dòng BOQ đang dùng (về "chưa có định mức"), xoá định mức và các vật tư /
// nhân công / máy mới tạo kèm mà không còn nơi nào dùng. Bản ghi duyệt được giữ lại (kèm lý do) để tra cứu.
export async function rejectCatalogChangeAction(changeId: string, reason: string): Promise<{ ok: boolean; error?: string; detached?: number }> {
  const admin = await requireNormReviewer();
  const change = await prisma.catalogChange.findUnique({ where: { id: changeId } });
  if (!change) return { ok: false, error: "Không tìm thấy bản ghi" };
  if (change.reviewed) return { ok: false, error: "Bản ghi này đã được xử lý" };
  const resIds = change.resourceIds.split(",").filter(Boolean);
  let detached = 0;
  await prisma.$transaction(async (tx) => {
    if (change.kind === "REMOVE") {
      // không đồng ý xoá: giữ nguyên dòng hao phí
    } else if (change.kind === "LINES") {
      // chỉ gỡ các dòng hao phí người dùng đã thêm, định mức giữ nguyên
      await tx.workItemResource.deleteMany({ where: { id: { in: change.lineIds.split(",").filter(Boolean) } } });
    } else {
      detached = (await tx.boqItem.updateMany({ where: { workItemId: change.workItemId }, data: { workItemId: null } })).count;
      await tx.workItem.deleteMany({ where: { id: change.workItemId } }); // các dòng hao phí xoá theo
    }
    for (const id of resIds) {
      const used = await tx.workItemResource.count({ where: { resourceId: id } });
      if (used === 0) await tx.resource.deleteMany({ where: { id } });
    }
    await tx.catalogChange.update({
      where: { id: changeId },
      data: { reviewed: true, rejected: true, rejectReason: reason.trim(), reviewedByName: admin.name ?? "admin", reviewedAt: new Date() },
    });
  });
  revalidatePath("/", "layout");
  return { ok: true, detached };
}

// Xoá nhiều dòng BOQ cùng lúc (các dòng thầu phụ liên kết tự xoá theo)
export async function deleteBoqItemsAction(projectId: string, boqItemIds: string[]) {
  await requireUser();
  await assertProjectEditable(projectId);
  if (boqItemIds.length === 0) return { deleted: 0 };
  const r = await prisma.boqItem.deleteMany({ where: { projectId, id: { in: boqItemIds } } });
  await renumberProjectBoq(projectId);
  revalidatePath(`/projects/${projectId}`, "layout");
  return { deleted: r.count };
}

// ---- Xoá nhiều dòng cùng lúc cho các sheet ----
export async function deleteDtcpLinesAction(projectId: string, lineIds: string[]) {
  await requireUser();
  await assertProjectEditable(projectId);
  const all = await prisma.dtcpLine.findMany({ where: { projectId }, select: { id: true, parentId: true } });
  const ids = new Set(lineIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of all) {
      if (l.parentId && ids.has(l.parentId) && !ids.has(l.id)) {
        ids.add(l.id);
        grew = true;
      }
    }
  }
  await prisma.dtcpLine.deleteMany({ where: { projectId, id: { in: [...ids] } } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Chỉ xoá dòng thầu phụ bổ sung tự nhập (dòng link từ CHI TIẾT xoá bằng cách chuyển công tác về "Chiết tính")
export async function deleteSubItemsAction(projectId: string, ids: string[]) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.subcontractorItem.deleteMany({ where: { projectId, id: { in: ids }, boqItemId: null } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function deleteManualItemsAction(projectId: string, ids: string[]) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.sheetManualItem.deleteMany({ where: { projectId, id: { in: ids } } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function deleteWorkItemResourceLinesAction(lineIds: string[]) {
  await requireNormLineEditor();
  await prisma.workItemResource.deleteMany({ where: { id: { in: lineIds } } });
  revalidatePath("/", "layout");
}

// Ô "Tổng KL" của dòng hao phí ở CHI TIẾT: người lập DT-CP sửa khối lượng hao phí cho riêng dòng BOQ này (số hoặc công thức, dùng KL =
// khối lượng BOQ, VD "=KL/0.2" để quy từ m3 sang m2 theo bề rộng tường) mà không phải tạo định mức mới. Để trống = bỏ ghi đè, theo định mức.
export async function setLineTotalQtyAction(projectId: string, boqItemId: string, lineId: string, raw: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  await assertProjectEditable(projectId);
  const boq = await prisma.boqItem.findFirst({ where: { id: boqItemId, projectId }, select: { quantity: true } });
  if (!boq) return { ok: false, error: "Không tìm thấy dòng BOQ" };
  const text = raw.trim();
  if (!text) {
    await prisma.boqLineQty.deleteMany({ where: { boqItemId, lineId } });
  } else {
    const p = parseQtyWithKL(text, boq.quantity);
    if (!p.ok) return { ok: false, error: p.error };
    if (p.value < 0) return { ok: false, error: "Khối lượng không được âm" };
    // công thức có dùng KL (hoặc phép tính) lưu lại để tự tính theo khối lượng BOQ; số thường lưu số
    const formula = /^[+-]?\d+([.,]\d+)?$/.test(text.replace(/^=/, "")) ? "" : text.replace(/^=/, "");
    await prisma.boqLineQty.upsert({
      where: { boqItemId_lineId: { boqItemId, lineId } },
      create: { projectId, boqItemId, lineId, qty: p.value, formula },
      update: { qty: p.value, formula },
    });
  }
  await syncLaborByWork(projectId);
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

// Đặt cấp cho các đầu mục lớn của BOQ (0 = cấp lớn nhất; null = tự nhận theo STT)
export async function setBoqHeadingLevelAction(projectId: string, boqItemIds: string[], level: number | null) {
  await requireUser();
  await assertProjectEditable(projectId);
  if (level === null) {
    await prisma.boqItem.updateMany({ where: { projectId, id: { in: boqItemIds }, isHeading: true }, data: { level: null } });
  } else {
    // Đổi cấp 1 đầu mục → các đầu mục con cháu bên trong dời theo cùng số cấp (công tác con tự theo đầu mục chứa nó),
    // giống thụt / ra 1 cấp cả nhóm trong Excel. Đầu mục được chọn trực tiếp luôn nhận đúng cấp đã chọn.
    const target = Math.max(0, Math.min(8, Math.round(level)));
    const selected = await prisma.boqItem.findMany({ where: { projectId, id: { in: boqItemIds }, isHeading: true }, select: { id: true, sheetId: true } });
    const next = new Map<string, number>();
    for (const sheetId of new Set(selected.map((s) => s.sheetId))) {
      const items = await prisma.boqItem.findMany({ where: { projectId, sheetId }, orderBy: { orderIndex: "asc" }, select: { id: true, isHeading: true, stt: true, level: true, rawDescription: true } });
      const tree = computeBoqTree(items);
      for (const s of selected.filter((x) => x.sheetId === sheetId)) {
        const delta = target - (tree.depthOf.get(s.id) ?? 0);
        for (const d of tree.headingScope.get(s.id) ?? []) if (!next.has(d)) next.set(d, Math.max(0, Math.min(8, (tree.depthOf.get(d) ?? 0) + delta)));
      }
    }
    for (const s of selected) next.set(s.id, target);
    await prisma.$transaction([...next].map(([id, lv]) => prisma.boqItem.update({ where: { id }, data: { level: lv } })));
  }
  await renumberProjectBoq(projectId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Đánh lại STT toàn bộ BOQ của dự án theo đúng thứ tự dòng hiện tại (gọi tự động sau khi chèn / xoá / đổi cấp)
async function renumberProjectBoq(projectId: string) {
  const items = await prisma.boqItem.findMany({
    where: { projectId },
    orderBy: { orderIndex: "asc" },
    select: { id: true, isHeading: true, stt: true, level: true, rawDescription: true },
  });
  const bySheet = new Map<string, typeof items>();
  const all = await prisma.boqItem.findMany({ where: { projectId }, select: { id: true, sheetId: true } });
  const sheetOf = new Map(all.map((a) => [a.id, a.sheetId ?? ""]));
  for (const it of items) {
    const k = sheetOf.get(it.id) ?? "";
    if (!bySheet.has(k)) bySheet.set(k, []);
    bySheet.get(k)!.push(it);
  }
  const changes = new Map<string, string>();
  for (const list of bySheet.values()) for (const [id, v] of renumberBoq(list)) changes.set(id, v);
  if (changes.size === 0) return 0;
  await prisma.$transaction([...changes].map(([id, stt]) => prisma.boqItem.update({ where: { id }, data: { stt } })));
  return changes.size;
}

export async function renumberBoqAction(projectId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  const changed = await renumberProjectBoq(projectId);
  revalidatePath(`/projects/${projectId}`, "layout");
  return { changed };
}

// Dán nhiều giá trị cùng lúc vào 1 cột của BOQ (khối lượng hoặc giá báo CĐT), theo thứ tự các dòng
export async function setBoqColumnValuesAction(
  projectId: string,
  field: "quantity" | "quoted",
  entries: { id: string; value: number | null }[] // null = xoá trống (giá báo → chưa nhập; khối lượng → 0)
) {
  await requireUser();
  await assertProjectEditable(projectId);
  if (entries.length === 0) return { updated: 0 };
  await prisma.$transaction(
    entries.map((e) =>
      prisma.boqItem.updateMany({
        where: { id: e.id, projectId, isHeading: false },
        data: field === "quantity" ? { quantity: e.value ?? 0 } : { quotedUnitPrice: e.value },
      })
    )
  );
  revalidatePath(`/projects/${projectId}`, "layout");
  return { updated: entries.length };
}

// ---- Sheet bổ sung: tạo / đổi tên / xoá; bảng tự do (GRID) ----
export async function createBlankSheetAction(projectId: string, name: string, rows: number, cols: number) {
  await requireUser();
  await assertProjectEditable(projectId);
  const r = Math.max(1, Math.min(500, Math.round(rows) || 10));
  const c = Math.max(1, Math.min(30, Math.round(cols) || 5));
  const max = await prisma.projectSheet.aggregate({ where: { projectId }, _max: { orderIndex: true } });
  const sheet = await prisma.projectSheet.create({
    data: {
      projectId,
      name: name.trim() || "Sheet mới",
      kind: "GRID",
      orderIndex: (max._max.orderIndex ?? 0) + 1,
      rowCount: r,
      colTitles: JSON.stringify(Array.from({ length: c }, (_, i) => `Cột ${i + 1}`)),
      // bảng mới luôn có cột "Thành tiền" (mặc định cột cuối) → có subtotal ở đầu mục + dòng TỔNG CỘNG cuối bảng; đổi được
      amountCol: c - 1,
    },
  });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { sheetId: sheet.id };
}

export async function renameSheetAction(projectId: string, sheetId: string, name: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  if (!name.trim()) return;
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { name: name.trim() } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function deleteSheetAction(projectId: string, sheetId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.projectSheet.delete({ where: { id: sheetId } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

async function loadGrid(sheetId: string) {
  const sheet = await prisma.projectSheet.findUnique({ where: { id: sheetId } });
  if (!sheet || sheet.kind !== "GRID") throw new Error("Không phải bảng tự do");
  return sheet;
}

// Ghi nhiều ô (dán khối từ Excel cũng dùng hàm này); tự mở rộng số dòng / số cột nếu ô vượt quá
export async function gridSetCellsAction(projectId: string, sheetId: string, cells: { row: number; col: number; value: string }[]) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const titles: string[] = JSON.parse(sheet.colTitles);
  let rowCount = sheet.rowCount;
  for (const c of cells) {
    rowCount = Math.max(rowCount, c.row + 1);
    while (titles.length < c.col + 1 && titles.length < 30) titles.push(`Cột ${titles.length + 1}`);
  }
  await prisma.$transaction([
    ...cells
      .filter((c) => c.col < titles.length)
      .map((c) =>
        c.value === ""
          ? // xoá nội dung: ô vẫn còn nếu có định dạng
            prisma.gridCell.updateMany({ where: { sheetId, row: c.row, col: c.col }, data: { value: "" } })
          : prisma.gridCell.upsert({
              where: { sheetId_row_col: { sheetId, row: c.row, col: c.col } },
              create: { sheetId, row: c.row, col: c.col, value: c.value },
              update: { value: c.value },
            })
      ),
    prisma.gridCell.deleteMany({ where: { sheetId, value: "", style: "" } }),
    prisma.projectSheet.update({ where: { id: sheetId }, data: { rowCount, colTitles: JSON.stringify(titles) } }),
  ]);
  await syncGridStt(sheetId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Ghi định dạng nhiều ô (thanh công cụ: in đậm, căn lề, màu, %, số lẻ, sao chép định dạng...). style = JSON CellStyle, rỗng = xoá định dạng
export async function gridSetStylesAction(projectId: string, sheetId: string, entries: { row: number; col: number; style: string }[]) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const nCols = (JSON.parse(sheet.colTitles) as string[]).length;
  const valid = entries.filter((e) => Number.isInteger(e.row) && Number.isInteger(e.col) && e.row >= 0 && e.row < sheet.rowCount && e.col >= 0 && e.col < nCols).slice(0, 5000);
  await prisma.$transaction(async (tx) => {
    for (const e of valid) {
      const style = stringifyStyle(parseStyle(e.style));
      const where = { sheetId_row_col: { sheetId, row: e.row, col: e.col } };
      const existing = await tx.gridCell.findUnique({ where });
      if (existing) {
        if (style === "" && existing.value === "") await tx.gridCell.delete({ where });
        else await tx.gridCell.update({ where, data: { style } });
      } else if (style !== "") {
        await tx.gridCell.create({ data: { sheetId, row: e.row, col: e.col, value: "", style } });
      }
    }
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Gộp ô (vùng chữ nhật, không chứa dòng đầu mục): giữ nội dung ô trên-trái, xoá nội dung các ô còn lại; vùng đè lên ô gộp cũ thì ô gộp cũ bị bỏ
export async function gridMergeAction(projectId: string, sheetId: string, range: GridMerge) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const nCols = (JSON.parse(sheet.colTitles) as string[]).length;
  const m = normalizeMerge(range);
  const extraHeader = (JSON.parse(sheet.headerRows) as string[][]).length;
  if (m.r2 >= sheet.rowCount || m.c2 >= nCols || m.r1 < -1 - extraHeader || (m.r1 === m.r2 && m.c1 === m.c2)) throw new Error("Chọn từ 2 ô trở lên để gộp");
  if (m.r1 < 0 && m.r2 >= 0) throw new Error("Ô tiêu đề chỉ gộp với các ô tiêu đề khác; muốn gộp xuống dòng dữ liệu hãy chọn các ô dữ liệu");
  const metas = await prisma.gridRowMeta.findMany({ where: { sheetId } });
  if (metas.some((x) => x.row >= m.r1 && x.row <= m.r2)) throw new Error("Không gộp ô qua dòng đầu mục");
  const merges = parseMerges(sheet.merges).filter((x) => !mergesIntersect(x, m));
  merges.push(m);
  if (m.r1 < 0) {
    // gộp ô tiêu đề: chữ các ô bị che vẫn được giữ lại, tách ô là hiện lại
    await prisma.projectSheet.update({ where: { id: sheetId }, data: { merges: JSON.stringify(merges) } });
    revalidatePath(`/projects/${projectId}`, "layout");
    return;
  }
  await prisma.$transaction([
    prisma.gridCell.updateMany({
      where: { sheetId, row: { gte: m.r1, lte: m.r2 }, col: { gte: m.c1, lte: m.c2 }, NOT: { row: m.r1, col: m.c1 } },
      data: { value: "" },
    }),
    prisma.gridCell.deleteMany({ where: { sheetId, value: "", style: "" } }),
    prisma.projectSheet.update({ where: { id: sheetId }, data: { merges: JSON.stringify(merges) } }),
  ]);
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Dòng tiêu đề phụ (phía trên dòng tên cột): thêm 1 dòng trên cùng / bớt dòng trên cùng / sửa chữ 1 ô.
// j = 0 là dòng sát dòng tên cột nhất (chỉ số dòng -2), j = 1 là dòng phía trên nó (-3)...
export async function gridAddHeaderRowAction(projectId: string, sheetId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const rows = JSON.parse(sheet.headerRows) as string[][];
  if (rows.length >= 8) throw new Error("Tối đa 9 dòng tiêu đề");
  rows.push([]);
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { headerRows: JSON.stringify(rows) } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function gridRemoveHeaderRowAction(projectId: string, sheetId: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const rows = JSON.parse(sheet.headerRows) as string[][];
  if (rows.length === 0) return;
  rows.pop();
  const lowest = -1 - rows.length; // dòng tiêu đề trên cùng còn lại
  // ô gộp chạm dòng vừa bỏ: co lại cho vừa, còn 1 ô thì bỏ
  const merges = parseMerges(sheet.merges)
    .map((m) => (m.r1 < 0 ? { ...m, r1: Math.max(m.r1, lowest) } : m))
    .filter((m) => m.r2 >= m.r1 && (m.r2 > m.r1 || m.c2 > m.c1));
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { headerRows: JSON.stringify(rows), merges: JSON.stringify(merges) } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function gridSetHeaderCellAction(projectId: string, sheetId: string, j: number, col: number, text: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const rows = JSON.parse(sheet.headerRows) as string[][];
  const nCols = (JSON.parse(sheet.colTitles) as string[]).length;
  if (!Number.isInteger(j) || j < 0 || j >= rows.length || !Number.isInteger(col) || col < 0 || col >= nCols) return;
  const row = Array.from({ length: nCols }, (_, c) => rows[j][c] ?? "");
  row[col] = text;
  rows[j] = row;
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { headerRows: JSON.stringify(rows) } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Bật / tắt tự đánh số STT (cột đầu) theo các dòng đã có tên công việc (cột thứ 2); bật thì đánh số ngay
export async function gridSetAutoSttAction(projectId: string, sheetId: string, on: boolean) {
  await requireUser();
  await assertProjectEditable(projectId);
  await loadGrid(sheetId);
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { autoStt: on } });
  if (on) await syncGridStt(sheetId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Tách ô: bỏ mọi ô gộp có chạm vào vùng đang chọn
export async function gridUnmergeAction(projectId: string, sheetId: string, range: GridMerge) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const m = normalizeMerge(range);
  const merges = parseMerges(sheet.merges).filter((x) => !mergesIntersect(x, m));
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { merges: JSON.stringify(merges) } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function gridAddRowsAction(projectId: string, sheetId: string, count: number) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { rowCount: Math.min(2000, sheet.rowCount + Math.max(1, count)) } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function gridAddColAction(projectId: string, sheetId: string) {
  await assertProjectEditable(projectId);
  await gridInsertColAction(projectId, sheetId, Number.MAX_SAFE_INTEGER);
}

// Ghi lại vị trí các ô theo bản đồ cột (null = xoá cột đó); dùng cho chèn / xoá cột
async function remapGrid(sheetId: string, opts: { rowMap?: (r: number) => number | null; colMap?: (c: number) => number | null }) {
  const cells = await prisma.gridCell.findMany({ where: { sheetId } });
  const metas = await prisma.gridRowMeta.findMany({ where: { sheetId } });
  const sheetRow = await prisma.projectSheet.findUnique({ where: { id: sheetId }, select: { merges: true, headerRows: true } });
  const rowMap = opts.rowMap ?? ((r: number) => r);
  const colMap = opts.colMap ?? ((c: number) => c);
  const newCells = cells
    .map((c) => ({ sheetId, row: rowMap(c.row), col: colMap(c.col), value: remapFormula(c.value, rowMap, colMap), style: c.style }))
    .filter((c): c is { sheetId: string; row: number; col: number; value: string; style: string } => c.row !== null && c.col !== null);
  await prisma.$transaction(async (tx) => {
    await tx.gridCell.deleteMany({ where: { sheetId } });
    if (newCells.length) await tx.gridCell.createMany({ data: newCells });
    // dòng đầu mục: giữ nguyên id (liên kết DT-CP dùng id), đổi vị trí 2 pha để không vướng ràng buộc duy nhất
    for (let i = 0; i < metas.length; i++) await tx.gridRowMeta.update({ where: { id: metas[i].id }, data: { row: -(i + 1) } });
    const newHeadingRows = new Set<number>();
    for (const m of metas) {
      const nr = rowMap(m.row);
      if (nr === null) await tx.gridRowMeta.delete({ where: { id: m.id } });
      else {
        await tx.gridRowMeta.update({ where: { id: m.id }, data: { row: nr } });
        newHeadingRows.add(nr);
      }
    }
    // ô gộp đi theo dòng / cột được chèn, xoá, chuyển
    const merges = remapMerges(parseMerges(sheetRow?.merges), rowMap, colMap, newHeadingRows);
    // chữ ở các dòng tiêu đề phụ đi theo cột được chèn / xoá
    const headerRows = (JSON.parse(sheetRow?.headerRows ?? "[]") as string[][]).map((row) => {
      const next: string[] = [];
      row.forEach((text, c) => {
        const nc = colMap(c);
        if (nc !== null) next[nc] = text;
      });
      return Array.from(next, (x) => x ?? "");
    });
    await tx.projectSheet.update({ where: { id: sheetId }, data: { merges: JSON.stringify(merges), headerRows: JSON.stringify(headerRows) } });
  });
}

export async function gridInsertColAction(projectId: string, sheetId: string, afterCol: number) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const titles: string[] = JSON.parse(sheet.colTitles);
  if (titles.length >= 30) return;
  const at = Math.min(afterCol, titles.length - 1) + 1; // vị trí cột mới
  titles.splice(at, 0, `Cột ${titles.length + 1}`);
  await remapGrid(sheetId, { colMap: (c) => (c >= at ? c + 1 : c) });
  const amountCol = sheet.amountCol !== null && sheet.amountCol >= at ? sheet.amountCol + 1 : sheet.amountCol;
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { colTitles: JSON.stringify(titles), amountCol } });
  await syncGridStt(sheetId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function gridRenameColAction(projectId: string, sheetId: string, col: number, title: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const titles: string[] = JSON.parse(sheet.colTitles);
  if (col < 0 || col >= titles.length) return;
  titles[col] = title;
  // sheet chưa chọn cột "Thành tiền" mà vừa đặt tên cột là "Thành tiền" → tự chọn cột đó (để có tổng)
  const amountCol = sheet.amountCol === null ? detectAmountCol(titles) : sheet.amountCol;
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { colTitles: JSON.stringify(titles), amountCol } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function gridDeleteColAction(projectId: string, sheetId: string, col: number) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const titles: string[] = JSON.parse(sheet.colTitles);
  if (titles.length <= 1 || col < 0 || col >= titles.length) return;
  titles.splice(col, 1);
  let amountCol = sheet.amountCol;
  if (amountCol !== null) amountCol = amountCol === col ? null : amountCol > col ? amountCol - 1 : amountCol;
  await remapGrid(sheetId, { colMap: (c) => (c === col ? null : c > col ? c - 1 : c) });
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { colTitles: JSON.stringify(titles), amountCol } });
  await syncGridStt(sheetId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Chèn 1 dòng (hoặc 1 dòng ĐẦU MỤC) ngay dưới dòng afterRow (-1 = đầu bảng)
export async function gridInsertRowAction(projectId: string, sheetId: string, afterRow: number, heading = false, title = "") {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const at = Math.max(0, Math.min(sheet.rowCount, afterRow + 1));
  await remapGrid(sheetId, { rowMap: (r) => (r >= at ? r + 1 : r) });
  if (heading) {
    // đầu mục mới cùng cấp với đầu mục ngay phía trên (đổi cấp bằng nút thụt vào / ra)
    const above = await prisma.gridRowMeta.findFirst({ where: { sheetId, row: { lt: at } }, orderBy: { row: "desc" } });
    await prisma.gridRowMeta.create({ data: { sheetId, row: at, title: title || "Đầu mục mới", level: above?.level ?? 0 } });
  }
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { rowCount: sheet.rowCount + 1 } });
  await syncGridStt(sheetId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Chuyển dòng đang có thành ĐẦU MỤC (tên = ô "Nội dung" - cột 2, không có thì ô chữ đầu tiên; cấp = cấp đầu mục phía
// trên) hoặc ngược lại đầu mục → dòng thường (tên đầu mục trả về ô cột 2 nếu ô đó trống). Ô số của dòng giữ nguyên
// trong dữ liệu (đầu mục chỉ hiện tổng phụ) nên chuyển qua lại không mất gì.
export async function gridSetRowsHeadingAction(projectId: string, sheetId: string, rows: number[], toHeading: boolean): Promise<{ ok: boolean; count: number }> {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const nCols = (JSON.parse(sheet.colTitles) as string[]).length;
  const textCol = nCols > 1 ? 1 : 0;
  const metas = await prisma.gridRowMeta.findMany({ where: { sheetId }, orderBy: { row: "asc" } });
  const metaByRow = new Map(metas.map((m) => [m.row, m]));
  const cells = await prisma.gridCell.findMany({ where: { sheetId, row: { in: rows } } });
  let count = 0;
  for (const r of [...new Set(rows)].filter((x) => x >= 0 && x < sheet.rowCount).sort((a, b) => a - b)) {
    const m = metaByRow.get(r);
    const rowCells = cells.filter((c) => c.row === r).sort((a, b) => a.col - b.col);
    if (toHeading && !m) {
      const isText = (v: string) => v.trim() !== "" && !v.trim().startsWith("=") && !/^[\s\d.,%-]+$/.test(v);
      const title = (rowCells.find((c) => c.col === textCol && isText(c.value)) ?? rowCells.find((c) => isText(c.value)))?.value.trim() ?? "Đầu mục mới";
      const above = [...metaByRow.values()].filter((x) => x.row < r).sort((a, b) => b.row - a.row)[0];
      metaByRow.set(r, await prisma.gridRowMeta.create({ data: { sheetId, row: r, title, level: above?.level ?? 0 } }));
      count++;
    } else if (!toHeading && m) {
      if (m.title.trim() && !rowCells.some((c) => c.col === textCol && c.value.trim() !== "")) {
        await prisma.gridCell.upsert({ where: { sheetId_row_col: { sheetId, row: r, col: textCol } }, create: { sheetId, row: r, col: textCol, value: m.title }, update: { value: m.title } });
      }
      await prisma.gridRowMeta.delete({ where: { id: m.id } });
      metaByRow.delete(r);
      count++;
    }
  }
  await syncGridStt(sheetId);
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, count };
}

// Số thứ tự của đầu mục do người dùng tự gõ (rỗng = tự đánh số lại theo cấp)
export async function gridSetHeadingSttAction(projectId: string, sheetId: string, metaId: string, stt: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.gridRowMeta.updateMany({ where: { id: metaId, sheetId }, data: { stt: stt.trim() === "" ? null : stt.trim().slice(0, 30) } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Cấp của đầu mục (0 = lớn nhất; cấp sâu hơn nằm trong đầu mục cấp trước nó). Chỉ được sâu hơn đầu mục ngay phía trên 1 cấp.
export async function gridSetHeadingLevelAction(projectId: string, sheetId: string, metaId: string, level: number) {
  await requireUser();
  await assertProjectEditable(projectId);
  const metas = await prisma.gridRowMeta.findMany({ where: { sheetId }, orderBy: { row: "asc" } });
  const i = metas.findIndex((m) => m.id === metaId);
  if (i < 0) return;
  const maxLevel = i === 0 ? 0 : Math.min(5, metas[i - 1].level + 1);
  const next = Math.max(0, Math.min(maxLevel, Math.round(level)));
  if (next === metas[i].level) return;
  const delta = next - metas[i].level;
  // các đầu mục con ngay sau nó (cấp sâu hơn cấp cũ) đi theo cùng độ dời
  await prisma.$transaction(async (tx) => {
    await tx.gridRowMeta.update({ where: { id: metaId }, data: { level: next } });
    for (let j = i + 1; j < metas.length && metas[j].level > metas[i].level; j++) {
      await tx.gridRowMeta.update({ where: { id: metas[j].id }, data: { level: Math.max(0, Math.min(5, metas[j].level + delta)) } });
    }
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function gridRenameHeadingAction(projectId: string, sheetId: string, metaId: string, title: string) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.gridRowMeta.updateMany({ where: { id: metaId, sheetId }, data: { title } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Bật/tắt hiện đầu mục của sheet bảng tự do (GRID) thành 1 dòng riêng bên sheet DT-CP (mặc định gắn
// dưới "CHI PHÍ TRỰC TIẾP", kéo thả sang chỗ khác trong DT-CP nếu cần)
export async function setGridHeadingShowInDtcpAction(projectId: string, sheetId: string, metaId: string, show: boolean) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.gridRowMeta.updateMany({ where: { id: metaId, sheetId }, data: { showInDtcp: show } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// "Chuyển tới": đưa dòng fromRow xuống cuối khối của đầu mục toHeadingId (null = phần chưa thuộc đầu mục nào, đầu bảng)
export async function gridMoveRowAction(projectId: string, sheetId: string, fromRow: number, toHeadingId: string | null) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const metas = await prisma.gridRowMeta.findMany({ where: { sheetId }, orderBy: { row: "asc" } });
  const headingRows = new Set(metas.map((m) => m.row));
  const target = toHeadingId ? metas.find((m) => m.id === toHeadingId) : null;
  if (toHeadingId && !target) return;
  const rows = Array.from({ length: sheet.rowCount }, (_, i) => i).filter((r) => r !== fromRow);
  // vị trí chèn trong danh sách đã bỏ dòng nguồn: cuối khối đích
  let insertAt: number;
  if (!target) {
    const firstHeading = rows.findIndex((r) => headingRows.has(r));
    insertAt = firstHeading === -1 ? rows.length : firstHeading;
  } else {
    const start = rows.indexOf(target.row);
    let end = start + 1;
    while (end < rows.length && !headingRows.has(rows[end])) end++;
    insertAt = end;
  }
  rows.splice(insertAt, 0, fromRow);
  const newPos = new Map(rows.map((oldRow, i) => [oldRow, i]));
  await remapGrid(sheetId, { rowMap: (r) => newPos.get(r) ?? r });
  await syncGridStt(sheetId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function gridDeleteRowsAction(projectId: string, sheetId: string, rows: number[]) {
  await requireUser();
  await assertProjectEditable(projectId);
  const sheet = await loadGrid(sheetId);
  const del = new Set(rows.filter((r) => r >= 0 && r < sheet.rowCount));
  if (del.size === 0) return;
  const shift: number[] = [];
  let removed = 0;
  for (let r = 0; r < sheet.rowCount; r++) {
    shift.push(r - removed);
    if (del.has(r)) removed++;
  }
  await remapGrid(sheetId, { rowMap: (r) => (del.has(r) ? null : shift[r] ?? r) });
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { rowCount: Math.max(1, sheet.rowCount - del.size) } });
  await syncGridStt(sheetId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function gridSetAmountColAction(projectId: string, sheetId: string, col: number | null) {
  await requireUser();
  await assertProjectEditable(projectId);
  await loadGrid(sheetId);
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { amountCol: col } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Đưa bảng tự do vào CHI TIẾT: thành tiền của từng dòng nằm ở cột chi phí này (null = không đưa)
export async function gridSetLinkColAction(projectId: string, sheetId: string, linkCol: string | null) {
  await requireUser();
  await assertProjectEditable(projectId);
  await loadGrid(sheetId);
  await prisma.projectSheet.update({ where: { id: sheetId }, data: { linkCol } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

// ---- Danh mục định mức (quản trị viên): sửa định mức của 1 công tác / nhập nhiều định mức từ Excel ----
export type NormEditLine = {
  id?: string; // WorkItemResource id (có = dòng đang có; không có = dòng mới thêm)
  category: "VT" | "NC" | "TB";
  code: string;
  name: string;
  unit: string;
  quantity: string;
};

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Tìm vật tư / nhân công / máy theo mã, rồi theo tên; chưa có thì tạo mới (mã tự sinh nếu để trống)
async function resolveResource(
  tx: Tx,
  cache: { byCode: Map<string, { id: string; code: string; name: string }>; byName: Map<string, { id: string; code: string; name: string }>; used: Set<string> },
  l: { category: "VT" | "NC" | "TB"; code: string; name: string; unit: string }
) {
  const norm = (s: string) => normalizeText(s);
  const hit = (l.code && cache.byCode.get(l.code.toLowerCase())) || (l.name && cache.byName.get(norm(l.name)));
  if (hit) return { res: hit, created: false };
  if (!l.name) throw new Error(`Dòng có mã "${l.code}" chưa có trong danh mục nên cần nhập cả tên`);
  let rc = l.code;
  if (!rc) {
    const slug = norm(l.name).replace(/\s+/g, "").toUpperCase().slice(0, 14) || "MOI";
    rc = `${l.category}.${slug}`;
    let i = 2;
    while (cache.used.has(rc.toLowerCase())) rc = `${l.category}.${slug}${i++}`;
  }
  const created = await tx.resource.create({ data: { code: rc, name: l.name, unit: l.unit, unitPrice: 0, sourceType: l.category, groupLabel: "(Thêm thủ công)" } });
  const res = { id: created.id, code: rc, name: l.name };
  cache.used.add(rc.toLowerCase());
  cache.byCode.set(rc.toLowerCase(), res);
  cache.byName.set(norm(l.name), res);
  return { res, created: true };
}

async function buildResourceCache() {
  const all = await prisma.resource.findMany({ select: { id: true, code: true, name: true } });
  return {
    byCode: new Map(all.map((r) => [r.code.toLowerCase(), r])),
    byName: new Map(all.map((r) => [normalizeText(r.name), r])),
    used: new Set(all.map((r) => r.code.toLowerCase())),
  };
}

export async function updateWorkItemNormAction(
  workItemId: string,
  payload: { code: string; name: string; unit: string; lines: NormEditLine[] }
): Promise<{ ok: boolean; error?: string }> {
  await requireNormReviewer();
  const code = payload.code.trim();
  const name = payload.name.trim();
  if (!code) return { ok: false, error: "Mã định mức không được để trống" };
  if (!name) return { ok: false, error: "Tên công tác không được để trống" };
  const dup = await prisma.workItem.findFirst({ where: { code, NOT: { id: workItemId } } });
  if (dup) return { ok: false, error: `Mã định mức "${code}" đã dùng cho "${dup.name}"` };

  const parsed: (NormEditLine & { qty: number; formula: string | null })[] = [];
  for (const l of payload.lines.filter((x) => x.name.trim() || x.code.trim() || x.id)) {
    const q = parseQuantityInput(l.quantity);
    if (!q.ok) return { ok: false, error: `Định mức của "${l.name || l.code}" không hợp lệ: ${q.error}` };
    parsed.push({ ...l, name: l.name.trim(), code: l.code.trim(), unit: l.unit.trim(), qty: q.value, formula: q.formula });
  }
  const existing = await prisma.workItemResource.findMany({ where: { workItemId }, include: { resource: true } });
  const cache = await buildResourceCache();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.workItem.update({ where: { id: workItemId }, data: { code, name, unit: payload.unit.trim() } });
      const keepIds = new Set(parsed.filter((l) => l.id).map((l) => l.id as string));
      const removed = existing.filter((e) => !keepIds.has(e.id)).map((e) => e.id);
      if (removed.length) await tx.workItemResource.deleteMany({ where: { id: { in: removed } } });

      for (const l of parsed) {
        const cur = l.id ? existing.find((e) => e.id === l.id) : undefined;
        if (cur) {
          let resourceId = cur.resourceId;
          const newCode = l.code || cur.resource.code;
          if (newCode.toLowerCase() !== cur.resource.code.toLowerCase()) {
            // đổi mã: nếu mã mới đã có ở tài nguyên khác thì chuyển dòng sang tài nguyên đó, không thì đổi mã của chính nó
            const other = cache.byCode.get(newCode.toLowerCase());
            if (other && other.id !== cur.resourceId) resourceId = other.id;
            else {
              await tx.resource.update({ where: { id: cur.resourceId }, data: { code: newCode } });
              cache.byCode.delete(cur.resource.code.toLowerCase());
              cache.byCode.set(newCode.toLowerCase(), { id: cur.resourceId, code: newCode, name: cur.resource.name });
              cache.used.add(newCode.toLowerCase());
            }
          }
          if (resourceId === cur.resourceId && ((l.name && l.name !== cur.resource.name) || l.unit !== cur.resource.unit)) {
            await tx.resource.update({ where: { id: cur.resourceId }, data: { name: l.name || cur.resource.name, unit: l.unit } });
          }
          await tx.workItemResource.update({ where: { id: cur.id }, data: { resourceId, category: l.category, quantity: l.qty, quantityFormula: l.formula } });
        } else {
          const { res } = await resolveResource(tx, cache, l);
          await tx.workItemResource.create({ data: { workItemId, resourceId: res.id, category: l.category, quantity: l.qty, quantityFormula: l.formula, wastageRate: 0 } });
        }
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Không lưu được" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export type NormImportGroup = { code: string; name: string; unit: string; lines: { category: "VT" | "NC" | "TB"; code: string; name: string; unit: string; quantity: string }[] };

// mode "skip": bỏ qua mã định mức đã có | "replace": ghi đè toàn bộ hao phí của mã đã có
export async function importNormsAction(groups: NormImportGroup[], mode: "skip" | "replace"): Promise<{ ok: boolean; error?: string; created: number; replaced: number; skipped: number }> {
  await requireNormReviewer();
  let created = 0;
  let replaced = 0;
  let skipped = 0;
  const cache = await buildResourceCache();
  try {
    for (const g of groups) {
      const code = g.code.trim();
      const name = g.name.trim();
      if (!code || !name) continue;
      const parsed: (NormImportGroup["lines"][number] & { qty: number; formula: string | null })[] = [];
      for (const l of g.lines) {
        const q = parseQuantityInput(l.quantity);
        if (!q.ok) throw new Error(`Định mức "${l.quantity}" của "${l.name || l.code}" (công tác ${code}) không hợp lệ: ${q.error}`);
        parsed.push({ ...l, name: l.name.trim(), code: l.code.trim(), unit: l.unit.trim(), qty: q.value, formula: q.formula });
      }
      const exists = await prisma.workItem.findFirst({ where: { code } });
      if (exists && mode === "skip") {
        skipped++;
        continue;
      }
      await prisma.$transaction(async (tx) => {
        let workItemId: string;
        if (exists) {
          workItemId = exists.id;
          await tx.workItem.update({ where: { id: workItemId }, data: { name, unit: g.unit.trim() || exists.unit } });
          await tx.workItemResource.deleteMany({ where: { workItemId } });
          replaced++;
        } else {
          const wi = await tx.workItem.create({ data: { code, name, unit: g.unit.trim(), section: "NHẬP TỪ EXCEL", subsection: "", note: "Nhập từ file Excel" } });
          workItemId = wi.id;
          created++;
        }
        for (const l of parsed) {
          if (!l.name && !l.code) continue;
          const { res } = await resolveResource(tx, cache, l);
          await tx.workItemResource.create({ data: { workItemId, resourceId: res.id, category: l.category, quantity: l.qty, quantityFormula: l.formula, wastageRate: 0 } });
        }
      });
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Không nhập được", created, replaced, skipped };
  }
  revalidatePath("/", "layout");
  return { ok: true, created, replaced, skipped };
}

// Thêm định mức mới thủ công ở trang Định Mức (quản trị viên)
export async function createNormAction(payload: { code: string; name: string; unit: string; lines: NormEditLine[] }): Promise<{ ok: boolean; error?: string }> {
  await requireNormReviewer();
  const code = payload.code.trim();
  const name = payload.name.trim();
  if (!code) return { ok: false, error: "Chưa nhập mã định mức mới" };
  if (!name) return { ok: false, error: "Chưa nhập tên công tác" };
  const dup = await prisma.workItem.findFirst({ where: { code } });
  if (dup) return { ok: false, error: `Mã định mức "${code}" đã có trong danh mục (${dup.name})` };

  const parsed: (NormEditLine & { qty: number; formula: string | null })[] = [];
  for (const l of payload.lines.filter((x) => x.name.trim() || x.code.trim())) {
    const q = parseQuantityInput(l.quantity);
    if (!q.ok) return { ok: false, error: `Định mức của "${l.name || l.code}" không hợp lệ: ${q.error}` };
    parsed.push({ ...l, name: l.name.trim(), code: l.code.trim(), unit: l.unit.trim(), qty: q.value, formula: q.formula });
  }
  const cache = await buildResourceCache();
  try {
    await prisma.$transaction(async (tx) => {
      const wi = await tx.workItem.create({ data: { code, name, unit: payload.unit.trim(), section: "BỔ SUNG THỦ CÔNG", subsection: "", note: "Thêm thủ công ở trang Định Mức" } });
      for (const l of parsed) {
        const { res } = await resolveResource(tx, cache, l);
        await tx.workItemResource.create({ data: { workItemId: wi.id, resourceId: res.id, category: l.category, quantity: l.qty, quantityFormula: l.formula, wastageRate: 0 } });
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Không lưu được" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---- Nhân công theo công việc BOQ (xem src/lib/labor-sync.ts) ----
export async function setLaborByWorkAction(projectId: string, on: boolean) {
  await requireUser();
  await assertProjectEditable(projectId);
  await prisma.project.update({ where: { id: projectId }, data: { laborByWork: on } });
  if (on) await syncLaborByWork(projectId);
  else await clearLaborByWork(projectId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

// Đổi tên 1 nhân công của dự án (áp cho mọi dòng BOQ đang dùng). Trùng tên + ĐVT với nhân công khác của
// dự án → gộp vào đó (các dòng BOQ chuyển sang, đơn giá theo dòng được gộp vào).
export async function renameProjectLaborAction(projectId: string, resourceId: string, name: string): Promise<{ merged: boolean }> {
  await requireUser();
  await assertProjectEditable(projectId);
  const newName = name.trim().replace(/s+/g, " ");
  const cur = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!newName || !cur || cur.projectId !== projectId) return { merged: false };
  const norm = normalizeText(newName);
  const same = (await prisma.resource.findMany({ where: { projectId, sourceType: cur.sourceType, unit: cur.unit, id: { not: resourceId } } })).find((r) => normalizeText(r.name) === norm);
  if (same) {
    await prisma.$transaction([
      prisma.boqLineResourceSwap.updateMany({ where: { projectId, resourceId }, data: { resourceId: same.id } }),
      prisma.vtPlacement.deleteMany({ where: { projectId, resourceId } }),
      prisma.resource.delete({ where: { id: resourceId } }),
    ]);
  } else {
    await prisma.resource.update({ where: { id: resourceId }, data: { name: newName } });
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  return { merged: !!same };
}
