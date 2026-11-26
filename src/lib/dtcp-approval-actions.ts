"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAccess, inAreas, type Access } from "@/lib/access";
import { DTCP_TPS, parseTp } from "@/lib/dtcp-approval";
import { qsttUsers } from "@/lib/dtcp-qstt";
import { ensureContractFromProject } from "@/lib/hop-dong-project";
import { pickSite, syncSite } from "@/lib/project-site";

// Trình duyệt DT-CP: QSĐT lập xong bấm "Trình DT-CP" → QSTT kiểm tra, trình 3 Trưởng phòng → đủ 3 TP xem & đồng ý
// → trình Phó Tổng → Phó Tổng duyệt (DT-CP khoá). Bước nào cũng trả lại được (về Đang lập, kèm ý kiến).
type R = { ok: boolean; error?: string };

const has = (a: Access, c: string) => a.isAdmin || (a.apps.has("DTCP") && a.dtcp.has(c));
const log = (id: string, action: string, user: string, note = "") => prisma.procLog.create({ data: { entity: "DTCP", entityId: id, action, userName: user, note } });

async function load(projectId: string) {
  const a = await getAccess();
  if (!a) throw new Error("Chưa đăng nhập");
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, area: true, dtcpStatus: true, dtcpTp: true, dtcpQsttId: true, dtcpQsttName: true, dtcpTpKey: true } });
  if (!p) throw new Error("Không tìm thấy DT-CP");
  if (!inAreas(a, p.area)) throw new Error("DT-CP thuộc khu vực ngoài phạm vi làm việc của bạn");
  return { a, p };
}

async function run(projectId: string, fn: (ctx: Awaited<ReturnType<typeof load>>) => Promise<string | void>): Promise<R> {
  try {
    const err = await fn(await load(projectId));
    if (err) return { ok: false, error: err };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi không xác định" };
  }
}

// QSĐT trình DT-CP qua QSTT: BẮT BUỘC nhập SỐ HỢP ĐỒNG (lúc này đã có hợp đồng), chọn DỰ ÁN trong Danh mục dự án (đang lập để đấu thầu thì chưa cần)
// và chọn QSTT kiểm tra (DT-CP hiện ở "Việc của tôi" của QSTT đó)
export async function submitDtcpAction(projectId: string, contractNo: string, qsttId: string, siteId = ""): Promise<R> {
  return run(projectId, async ({ a, p }) => {
    if (!has(a, "EDIT")) return "Chỉ người lập DT-CP (QSĐT) mới trình được";
    if (p.dtcpStatus !== "DRAFT") return "DT-CP đã trình rồi";
    const no = contractNo.trim().replace(/\s+/g, " ");
    if (!no) return "Nhập SỐ HỢP ĐỒNG trước khi trình DT-CP";
    const site = await pickSite(siteId).catch(() => null);
    if (!site) return "Chọn DỰ ÁN (mã dự án) trong Danh mục dự án trước khi trình DT-CP";
    const q = (await qsttUsers(p.area)).find((x) => x.id === qsttId);
    if (!q) return "Chọn QSTT kiểm tra DT-CP (người được cấp quyền QSTT của khu vực này)";
    await prisma.project.update({
      where: { id: projectId },
      data: { siteId: site.id, ...(!p.area && site.area ? { area: site.area } : {}), dtcpStatus: "QSTT", dtcpTp: "{}", dtcpNote: "", contractNo: no, dtcpQsttId: q.id, dtcpQsttName: q.name, dtcpSubmittedBy: a.name, dtcpSubmittedAt: new Date(), dtcpApprovedBy: "", dtcpApprovedAt: null },
    });
    await prisma.costContract.updateMany({ where: { projectId, source: "APP" }, data: { contractNo: no, siteId: site.id } }); // hợp đồng trong Trình giá đội (DT-CP phần mềm) lấy luôn số hợp đồng + dự án
    await syncSite(site.id); // tên dự án của DT-CP = tên chuẩn trong danh mục
    await log(projectId, `Trình DT-CP qua QSTT ${q.name}`, a.name, `Dự án: ${site.code ? `${site.code} · ` : ""}${site.name} · Số hợp đồng: ${no}`);
  });
}

// QSĐT rút lại khi chưa duyệt xong
export async function recallDtcpAction(projectId: string): Promise<R> {
  return run(projectId, async ({ a, p }) => {
    if (!has(a, "EDIT")) return "Chỉ người lập DT-CP mới rút lại được";
    if (!["QSTT", "TP", "PTG"].includes(p.dtcpStatus)) return "DT-CP không ở bước đang trình";
    await prisma.project.update({ where: { id: projectId }, data: { dtcpStatus: "DRAFT", dtcpTp: "{}" } });
    await log(projectId, "Rút lại DT-CP để điều chỉnh", a.name);
  });
}

// QSTT kiểm tra xong, CHỌN 1 trong 3 Trưởng phòng để trình duyệt
export async function qsttForwardDtcpAction(projectId: string, tpKey: string, note: string): Promise<R> {
  return run(projectId, async ({ a, p }) => {
    if (!has(a, "QSTT")) return "Chỉ QSTT mới trình Trưởng phòng được";
    if (p.dtcpStatus !== "QSTT") return "DT-CP không ở bước chờ QSTT kiểm tra";
    if (p.dtcpQsttId && p.dtcpQsttId !== a.id && !a.isAdmin) return `DT-CP này đã trình cho QSTT ${p.dtcpQsttName || "khác"} kiểm tra`;
    const t = DTCP_TPS.find((x) => x.key === tpKey);
    if (!t) return "Chọn 1 trong 3 Trưởng phòng để trình duyệt";
    await prisma.project.update({ where: { id: projectId }, data: { dtcpStatus: "TP", dtcpTp: "{}", dtcpTpKey: t.key } });
    await log(projectId, `QSTT đã kiểm tra, trình ${t.label} duyệt`, a.name, note.trim());
  });
}

// Trưởng phòng được chọn DUYỆT DT-CP → DT-CP CÓ HIỆU LỰC (tự tạo hợp đồng trong Trình giá đội / thầu phụ), chờ QSTT gửi công trình.
// Quản trị duyệt thay được. DT-CP cũ (chưa chọn Trưởng phòng, trình 3 TP) giữ cách cũ: đủ 3 TP → Phó Tổng.
export async function tpAgreeDtcpAction(projectId: string, key: string, note: string): Promise<R> {
  return run(projectId, async ({ a, p }) => {
    const t = DTCP_TPS.find((x) => x.key === key);
    if (!t) return "Trưởng phòng không hợp lệ";
    if (!has(a, t.perm)) return `Bạn không phải ${t.label}`;
    if (p.dtcpStatus !== "TP") return "DT-CP không ở bước chờ Trưởng phòng duyệt";
    const tp = parseTp(p.dtcpTp);
    if (tp[t.key]) return `${t.label} đã duyệt rồi`;
    tp[t.key] = { by: a.name, at: new Date().toISOString() };
    if (p.dtcpTpKey) {
      if (p.dtcpTpKey !== t.key) return `DT-CP này đang chờ ${DTCP_TPS.find((x) => x.key === p.dtcpTpKey)?.label ?? "Trưởng phòng khác"} duyệt`;
      await prisma.project.update({ where: { id: projectId }, data: { dtcpTp: JSON.stringify(tp), dtcpStatus: "TPOK", dtcpApprovedBy: a.name, dtcpApprovedAt: new Date() } });
      await ensureContractFromProject(projectId, { id: a.id, name: a.name }); // có hiệu lực → đưa qua trình giá đội / thầu phụ
      await log(projectId, `${t.label} DUYỆT DT-CP — DT-CP có hiệu lực, chờ QSTT gửi công trình`, a.name, note.trim());
      return;
    }
    const all = DTCP_TPS.every((x) => tp[x.key]);
    await prisma.project.update({ where: { id: projectId }, data: { dtcpTp: JSON.stringify(tp), ...(all ? { dtcpStatus: "PTG" } : {}) } });
    await log(projectId, `${t.label} đồng ý trình Phó Tổng${all ? " — đủ 3 Trưởng phòng, chuyển Phó Tổng duyệt" : ""}`, a.name, note.trim());
  });
}

// QSTT gửi DT-CP (đã được Trưởng phòng duyệt, có hiệu lực) cho công trình
export async function qsttSendDtcpAction(projectId: string, note: string): Promise<R> {
  return run(projectId, async ({ a, p }) => {
    if (!has(a, "QSTT")) return "Chỉ QSTT mới gửi DT-CP cho công trình được";
    if (p.dtcpStatus !== "TPOK") return "DT-CP chưa được Trưởng phòng duyệt";
    if (p.dtcpQsttId && p.dtcpQsttId !== a.id && !a.isAdmin) return `DT-CP này do QSTT ${p.dtcpQsttName || "khác"} phụ trách`;
    await prisma.project.update({ where: { id: projectId }, data: { dtcpStatus: "APPROVED", dtcpSentAt: new Date() } });
    await log(projectId, "QSTT đã gửi DT-CP cho công trình", a.name, note.trim());
  });
}

// Phó Tổng duyệt → DT-CP khoá
export async function ptgApproveDtcpAction(projectId: string, note: string): Promise<R> {
  return run(projectId, async ({ a, p }) => {
    if (!has(a, "PTG")) return "Chỉ Phó Tổng mới duyệt được";
    if (p.dtcpStatus !== "PTG") return "DT-CP không ở bước chờ Phó Tổng duyệt";
    await prisma.project.update({ where: { id: projectId }, data: { dtcpStatus: "APPROVED", dtcpApprovedBy: a.name, dtcpApprovedAt: new Date() } });
    await log(projectId, "Phó Tổng duyệt DT-CP", a.name, note.trim());
  });
}

// Trả lại cho QSĐT điều chỉnh (người đang giữ bước hiện tại)
export async function returnDtcpAction(projectId: string, note: string): Promise<R> {
  return run(projectId, async ({ a, p }) => {
    const n = note.trim();
    if (!n) return "Ghi lý do trả lại để QSĐT biết cần điều chỉnh gì";
    const ok =
      (p.dtcpStatus === "QSTT" && has(a, "QSTT")) ||
      (p.dtcpStatus === "TP" && (p.dtcpTpKey ? has(a, DTCP_TPS.find((t) => t.key === p.dtcpTpKey)?.perm ?? "-") : DTCP_TPS.some((t) => has(a, t.perm)))) ||
      (p.dtcpStatus === "PTG" && has(a, "PTG"));
    if (!ok) return "Bạn không giữ bước duyệt hiện tại của DT-CP này";
    await prisma.project.update({ where: { id: projectId }, data: { dtcpStatus: "DRAFT", dtcpTp: "{}", dtcpNote: `${a.name}: ${n}` } });
    await log(projectId, "Trả lại DT-CP cho QSĐT điều chỉnh", a.name, n);
  });
}

// DT-CP đã duyệt cần sửa → mở lại (phải trình duyệt lại từ đầu)
export async function reopenDtcpAction(projectId: string, reason: string): Promise<R> {
  return run(projectId, async ({ a, p }) => {
    const n = reason.trim();
    if (!n) return "Ghi lý do mở lại";
    if (!has(a, "EDIT")) return "Chỉ người lập DT-CP mới mở lại được";
    if (p.dtcpStatus !== "APPROVED" && p.dtcpStatus !== "TPOK") return "DT-CP chưa được duyệt";
    await prisma.project.update({ where: { id: projectId }, data: { dtcpStatus: "DRAFT", dtcpTp: "{}", dtcpNote: `Mở lại để điều chỉnh: ${n}` } });
    await log(projectId, "Mở lại DT-CP đã duyệt để điều chỉnh", a.name, n);
  });
}
