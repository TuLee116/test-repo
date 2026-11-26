import { prisma } from "@/lib/prisma";
import { areaWhere, getAccess } from "@/lib/access";
import { dtcpTodoOf } from "@/lib/dtcp-approval";
import { getProcUser } from "@/lib/proc";
import { getTaskCounts } from "@/lib/proc-tasks";
import { asSub, CATEGORIES, contractAreaWhere, getPriceUser, subAreaWhere, type PriceUser } from "@/lib/gia-doi";
import { subTodoOf } from "@/lib/thau-phu-calc";

// "VIỆC CỦA TÔI": các việc đang chờ người dùng xử lý ở mọi phân hệ — dùng cho chuông nhắc trên thanh menu + hộp nhắc khi đăng nhập.
// Chỉ tính theo VAI TRÒ ĐƯỢC GÁN (không tính quyền quản trị) để quản trị không bị nhắc mọi việc của mọi người.
export type MyTask = { app: string; label: string; count: number; href: string };

// Đệ trình giá đội: điều kiện "việc của tôi" dùng chung cho trang danh sách
export function priceTaskWhere(u: PriceUser) {
  const myCats = CATEGORIES.filter((c) => u.roles.has(c.role)).map((c) => c.value as string);
  const qs = u.roles.has("QSTT");
  return { qs, myCats };
}

// Trình giá thầu phụ: đếm việc theo từng loại (Trưởng phòng duyệt, Phó Tổng phê duyệt / xem, QSTT trình / trình lại / lên HĐ)
export async function subTaskCounts(u: PriceUser): Promise<Map<string, number>> {
  const { qs, myCats } = priceTaskWhere(u);
  const roles = { qs, ptg: u.roles.has("PTG"), cats: myCats, dt: u.roles.has("QSDT"), uid: u.id };
  const out = new Map<string, number>();
  if (!qs && !roles.ptg && !roles.dt && !myCats.length) return out;
  const ps = await prisma.subProposal.findMany({ where: { AND: [{ OR: [{ status: { not: "APPROVED" } }, { hdNo: "" }, { ptgAt: null }, { mailSentAt: null }] }, subAreaWhere(u)] }, select: { id: true, status: true, branch: true, category: true, ptgAt: true, hdNo: true, parentId: true, createdById: true, mailSentAt: true } });
  const parents = new Set(ps.map((p) => p.parentId).filter(Boolean));
  for (const p of ps) {
    const t = subTodoOf({ ...p, superseded: parents.has(p.id) }, roles);
    if (t) out.set(t, (out.get(t) ?? 0) + 1);
  }
  // QSĐT người trình: hồ sơ vừa được Trưởng phòng / Phó Tổng duyệt hoặc không duyệt mà chưa mở xem → báo trên chuông
  if (roles.dt) {
    const decided = await prisma.subProposal.count({ where: { createdById: u.id, status: { in: ["APPROVED", "REJECTED"] }, makerSeenAt: null } });
    if (decided) out.set("Kết quả duyệt hồ sơ thầu phụ (Trưởng phòng / Phó Tổng đã xử lý)", decided);
  }
  // QSTT: QSĐT đã bổ sung hồ sơ theo yêu cầu của Trưởng phòng (hồ sơ đã lên thẳng Trưởng phòng) → báo để nắm
  if (qs) {
    const n = await prisma.subProposal.count({ where: { infoNotice: true, AND: [subAreaWhere(u)] } });
    if (n) out.set("QSĐT đã bổ sung theo yêu cầu của Trưởng phòng (xem để nắm)", n);
  }
  return out;
}

export async function getMyTasks(): Promise<MyTask[]> {
  const access = await getAccess();
  if (!access) return [];
  const out: MyTask[] = [];

  // ---- Duyệt DT-CP ----
  if (access.apps.has("DTCP") && ["QSTT", "TP_KC", "TP_HTPQ", "TP_HTKV", "PTG"].some((c) => access.dtcp.has(c))) {
    const ps = await prisma.project.findMany({ where: { dtcpStatus: { in: ["QSTT", "TP", "PTG", "TPOK"] }, ...areaWhere(access) }, select: { id: true, name: true, dtcpStatus: true, dtcpTp: true, dtcpQsttId: true, dtcpTpKey: true } });
    // mỗi DT-CP 1 việc riêng, bấm vào mở thẳng DT-CP đó (không về trang tổng quan)
    for (const p of ps) {
      const t = dtcpTodoOf(p, access.dtcp, access.id);
      if (!t) continue;
      out.push({ app: "Duyệt DT-CP", label: `DT-CP ${p.name}: ${t}`, count: 1, href: `/projects/${p.id}` });
    }
  }

  // ---- Đệ trình giá đội ----
  const pu = access.apps.has("PRICE") ? await getPriceUser() : null;
  if (pu) {
    const { qs, myCats } = priceTaskWhere(pu);
    const [draft, back, review, later, waiting] = await Promise.all([
      qs ? prisma.priceSubmission.count({ where: { status: "DRAFT", createdById: pu.id, ...contractAreaWhere(pu) } }) : 0,
      qs ? prisma.priceSubmission.count({ where: { status: { in: ["APPROVED", "REJECTED"] }, mailSentAt: null, createdById: pu.id, ...contractAreaWhere(pu) } }) : 0,
      myCats.length ? prisma.priceSubmission.count({ where: { status: "SUBMITTED", category: { in: myCats }, ...contractAreaWhere(pu) } }) : 0,
      qs ? prisma.priceSubmission.count({ where: { status: "APPROVED", dtcpLater: true, contractId: null, createdById: pu.id, ...contractAreaWhere(pu) } }) : 0,
      qs ? prisma.priceSubmission.count({ where: { status: "SUBMITTED", createdById: pu.id, ...contractAreaWhere(pu) } }) : 0,
    ]);
    const app = "Đệ trình giá đội";
    if (back) out.push({ app, label: "A. Hồ sơ giá đội đã duyệt, chưa gửi mail cho công trình", count: back, href: "/gia-doi" });
    if (review) out.push({ app, label: "B. Hồ sơ giá đội chờ bạn duyệt", count: review, href: "/gia-doi" });
    if (waiting) out.push({ app, label: "B. Hồ sơ giá đội đã trình, chờ Trưởng phòng duyệt", count: waiting, href: "/gia-doi" });
    if (draft) out.push({ app, label: "Hồ sơ giá đội cần kiểm tra & trình Trưởng phòng", count: draft, href: "/gia-doi" });
    if (later) out.push({ app, label: "Hồ sơ giá đội đã duyệt nhưng CHƯA CÓ DT-CP, cần bổ sung", count: later, href: "/gia-doi" });
    for (const [label, count] of await subTaskCounts(asSub(pu))) out.push({ app: "Trình giá thầu phụ", label: `Hồ sơ thầu phụ: ${label}`, count, href: "/gia-doi/thau-phu" });
  }

  // ---- Mua vật tư ----
  const pr = access.apps.has("PROC") ? await getProcUser() : null;
  if (pr && pr.roles.size) {
    const t = await getTaskCounts({ ...pr, isAdmin: false });
    const app = "Mua vật tư";
    const rows: [number, string, string][] = [
      [t.reqToApprove, "Phiếu đề nghị vật tư chờ bạn duyệt", "/mua-vat-tu/de-nghi"],
      [t.reqMine, "Phiếu đề nghị nháp / bị trả lại của bạn", "/mua-vat-tu/de-nghi"],
      [t.toOrder, "Dòng đề nghị đã duyệt chờ lên đơn hàng", "/mua-vat-tu/don-hang"],
      [t.poDraft, "Đơn hàng nháp chờ chuyển lấy báo giá", "/mua-vat-tu/don-hang"],
      [t.poQuoting, "Đơn hàng chờ lấy báo giá / so sánh giá", "/mua-vat-tu/don-hang"],
      [t.poPending, "Bảng so sánh giá chờ bạn duyệt", "/mua-vat-tu/don-hang"],
      [t.poApproved, "Đơn hàng đã duyệt chờ đặt hàng", "/mua-vat-tu/don-hang"],
      [t.poOrdered, "Đơn hàng đã đặt chờ báo nhận hàng", "/mua-vat-tu/nhan-hang"],
      [t.unbilled, "Dòng hàng đã nhận chưa lên công nợ", "/mua-vat-tu/cong-no"],
      [t.paySent, "Công nợ nhà cung cấp chờ thanh toán", "/mua-vat-tu/cong-no"],
    ];
    for (const [count, label, href] of rows) if (count) out.push({ app, label, count, href });
  }
  return out;
}
