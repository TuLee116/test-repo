"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canPrice, getPriceUser, inPriceAreas, proposedPriceOf, type PriceUser } from "@/lib/gia-doi";
import { controlVersion } from "@/lib/hop-dong";
import { lineKeyOf, PS_GROUP_KEY, PS_GROUP_NAME, type DtcpRef } from "@/lib/hop-dong-calc";

// ĐỐI CHIẾU SỔ GIÁ ĐỘI VỚI DT-CP: các dòng giá đã duyệt chưa khớp dòng TH Nhân Công của hợp đồng → QSTT
//  ① khớp vào dòng DT-CP có sẵn (nhớ cách khớp cho các đợt sau)
//  ② thêm vào DT-CP thành dòng PHÁT SINH (đầu mục "PHÁT SINH – BỔ SUNG TỪ SỔ GIÁ"; DT-CP lập trên phần mềm: thêm luôn vào sheet
//     TH Nhân Công mục B của dự án — ghi nhận phát sinh, không phải trình duyệt lại DT-CP)
//  ③ giữ ngoài DT-CP (đã xem, xác nhận là chi phí ngoài)
type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
class DcError extends Error {}
const fail = (m: string): never => {
  throw new DcError(m);
};
async function run<T extends object>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    const r = await fn();
    revalidatePath("/gia-doi", "layout");
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof DcError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Lỗi hệ thống, thử lại hoặc báo quản trị." };
  }
}
async function need(contractId: string): Promise<{ u: PriceUser; c: { id: string; source: string; projectId: string | null; area: string; approvedVersion: number; versions: string } }> {
  const u = await getPriceUser();
  if (!u) fail("Chưa đăng nhập");
  if (!canPrice(u!, "QSTT")) fail("Chỉ QSTT / quản trị được đối chiếu và bổ sung DT-CP");
  const c = await prisma.costContract.findUnique({ where: { id: contractId }, select: { id: true, source: true, projectId: true, area: true, approvedVersion: true, versions: true } });
  if (!c) fail("Không tìm thấy hợp đồng");
  if (!inPriceAreas(u!, c!.area)) fail("Hợp đồng thuộc khu vực bạn không được làm việc");
  return { u: u!, c: c! };
}

// Gắn các dòng (theo tên + ĐVT chuẩn hoá) vào lineKey: sổ giá đã duyệt + dòng hồ sơ cùng hợp đồng + nhớ khớp.
// lineKey "" = trả về "chưa đối chiếu" (chỉ áp cho dòng đang "giữ ngoài")
async function applyMatch(contractId: string, srcKeys: string[], lineKey: string) {
  const src = new Set(srcKeys);
  const from = lineKey === "" ? ["-"] : ["", "-"];
  const [aps, pls] = await Promise.all([
    prisma.approvedPrice.findMany({ where: { contractId, kind: "NC", lineKey: { in: from } }, select: { id: true, name: true, unit: true } }),
    prisma.priceLine.findMany({ where: { submission: { contractId }, level: "ITEM", lineKey: { in: from } }, select: { id: true, content: true, unit: true } }),
  ]);
  const apIds = aps.filter((a) => src.has(lineKeyOf(a.name, a.unit))).map((a) => a.id);
  const plIds = pls.filter((l) => src.has(lineKeyOf(l.content, l.unit))).map((l) => l.id);
  await prisma.$transaction(async (tx) => {
    await tx.approvedPrice.updateMany({ where: { id: { in: apIds } }, data: { lineKey } });
    await tx.priceLine.updateMany({ where: { id: { in: plIds } }, data: { lineKey } });
    if (!lineKey) await tx.priceMatch.deleteMany({ where: { contractId, srcKey: { in: srcKeys } } });
    else for (const srcKey of srcKeys) await tx.priceMatch.upsert({ where: { contractId_srcKey: { contractId, srcKey } }, create: { contractId, srcKey, lineKey }, update: { lineKey } });
  });
  return apIds.length;
}

// ① khớp vào dòng DT-CP có sẵn / ③ giữ ngoài ("-") / bỏ giữ ngoài ("")
// pairs: mỗi dòng (srcKey) một đích riêng → khớp hàng loạt theo cột "Khớp vào dòng DT-CP"
export async function matchOutsideAction(contractId: string, pairs: { srcKey: string; lineKey: string }[]) {
  return run(async () => {
    await need(contractId);
    if (!pairs.length) fail("Chưa chọn dòng nào");
    const keys = new Set((await prisma.costLine.findMany({ where: { contractId, kind: "NC", level: "ITEM" }, select: { key: true } })).map((l) => l.key));
    const by = new Map<string, string[]>();
    for (const p of pairs) {
      if (p.lineKey && p.lineKey !== "-" && !keys.has(p.lineKey)) fail("Không tìm thấy dòng DT-CP đã chọn — tải lại trang");
      by.set(p.lineKey, [...(by.get(p.lineKey) ?? []), p.srcKey]);
    }
    let n = 0;
    for (const [lineKey, srcKeys] of by) n += await applyMatch(contractId, srcKeys, lineKey);
    return { n };
  });
}

type NewLine = { srcKeys: string[]; name: string; unit: string; price: number; qty: number | null; note: string };

// Tạo dòng phát sinh trong TH Nhân Công của hợp đồng (+ sheet TH Nhân Công của dự án nếu DT-CP lập trên phần mềm)
async function addLines(c: Awaited<ReturnType<typeof need>>["c"], items: NewLine[]): Promise<{ added: number; matched: number; keys: string[] }> {
  const existing = await prisma.costLine.findMany({ where: { contractId: c.id, kind: "NC" }, select: { key: true, level: true, orderIndex: true } });
  const itemKeys = new Set(existing.filter((l) => l.level === "ITEM").map((l) => l.key));
  let order = Math.max(-1, ...existing.map((l) => l.orderIndex)) + 1;

  // DT-CP trên phần mềm: dòng tự bổ sung ở mục B, đầu mục phát sinh
  let groupKey = PS_GROUP_KEY;
  let proj: { id: string; groupId: string; order: number } | null = null;
  if (c.source === "APP" && c.projectId) {
    const p = await prisma.project.findUnique({ where: { id: c.projectId }, select: { id: true, dtcpStatus: true } });
    if (!p) fail("Không tìm thấy DT-CP trên phần mềm của hợp đồng");
    if (p!.dtcpStatus !== "DRAFT" && p!.dtcpStatus !== "APPROVED") fail("DT-CP của dự án đang trong quá trình trình duyệt — chờ duyệt xong (hoặc trả về) rồi mới bổ sung phát sinh");
    const g =
      (await prisma.vtGroup.findFirst({ where: { projectId: p!.id, kind: "NC", section: "B", name: PS_GROUP_NAME } })) ??
      (await prisma.vtGroup.create({ data: { projectId: p!.id, kind: "NC", section: "B", name: PS_GROUP_NAME, orderIndex: ((await prisma.vtGroup.aggregate({ where: { projectId: p!.id, kind: "NC" }, _max: { orderIndex: true } }))._max.orderIndex ?? 0) + 1 } }));
    groupKey = `#grp-${g.id}`;
    proj = { id: p!.id, groupId: g.id, order: (await prisma.sheetManualItem.aggregate({ where: { projectId: p!.id, kind: "NC" }, _max: { orderIndex: true } }))._max.orderIndex ?? 0 };
  }
  if (!existing.some((l) => l.key === groupKey)) {
    await prisma.costLine.create({ data: { contractId: c.id, kind: "NC", key: groupKey, level: "GROUP", stt: "PS", name: PS_GROUP_NAME, orderIndex: order++, extra: true } });
  }

  let added = 0;
  let matched = 0;
  const keys: string[] = [];
  const nPs = existing.filter((l) => l.level === "ITEM").length;
  for (const it of items) {
    const name = it.name.trim();
    if (!name) fail("Tên công việc bổ sung không được trống");
    const key = lineKeyOf(name, it.unit);
    keys.push(key);
    if (!itemKeys.has(key)) {
      const price = Math.round(it.price);
      await prisma.costLine.create({
        data: {
          contractId: c.id,
          kind: "NC",
          key,
          level: "ITEM",
          stt: `PS${nPs + added + 1}`,
          name,
          unit: it.unit.trim(),
          qty: it.qty,
          prices: JSON.stringify({ "0": price }),
          amount: it.qty != null ? it.qty * price : null,
          note: it.note,
          orderIndex: order++,
          extra: true,
        },
      });
      if (proj)
        await prisma.sheetManualItem.create({ data: { projectId: proj.id, kind: "NC", groupId: proj.groupId, name, unit: it.unit.trim(), quantity: it.qty ?? 0, unitPrice: price, note: it.note, orderIndex: ++proj.order } });
      itemKeys.add(key);
      added++;
    }
    matched += await applyMatch(c.id, it.srcKeys, key);
  }
  if (proj) revalidatePath(`/projects/${proj.id}`, "layout");
  return { added, matched, keys };
}

// ② thêm các dòng sổ giá chưa khớp vào DT-CP: đơn giá = giá duyệt gần nhất, khối lượng = lũy kế KL đã duyệt
export async function addOutsideToDtcpAction(contractId: string, items: { srcKey: string; name: string; unit: string }[]) {
  return run(async () => {
    const { c } = await need(contractId);
    if (!items.length) fail("Chưa chọn dòng nào");
    const aps = await prisma.approvedPrice.findMany({ where: { contractId, kind: "NC", lineKey: { in: ["", "-"] } }, orderBy: { approvedAt: "desc" } });
    const lines: NewLine[] = items.map((it) => {
      const mine = aps.filter((a) => lineKeyOf(a.name, a.unit) === it.srcKey);
      if (!mine.length) fail(`"${it.name.slice(0, 50)}" không còn trong danh sách chưa đối chiếu — tải lại trang`);
      const qty = mine.reduce((s, a) => s + (a.qty ?? 0), 0);
      const codes = [...new Set(mine.map((a) => a.submissionCode))].join(", ");
      return { srcKeys: [it.srcKey], name: it.name, unit: it.unit, price: mine[0].price, qty: qty || null, note: `Phát sinh bổ sung từ sổ giá (${codes})` };
    });
    const r = await addLines(c, lines);
    return { added: r.added, matched: r.matched };
  });
}

// Từ màn hình hồ sơ (QSTT kiểm tra): thêm 1 dòng đề xuất chưa có trong DT-CP thành dòng phát sinh và khớp luôn
export async function addSheetLineToDtcpAction(submissionId: string, lineId: string, name: string, unit: string) {
  return run(async () => {
    const sub = await prisma.priceSubmission.findUnique({ where: { id: submissionId }, select: { contractId: true, code: true, kind: true } });
    if (!sub?.contractId) fail("Hồ sơ chưa chọn hợp đồng (DT-CP)");
    const { c } = await need(sub!.contractId!);
    const l = await prisma.priceLine.findUnique({ where: { id: lineId } });
    if (!l || l.submissionId !== submissionId) fail("Không tìm thấy dòng");
    const price = proposedPriceOf(sub!.kind, l!) ?? 0;
    const r = await addLines(c, [{ srcKeys: [lineKeyOf(l!.content, l!.unit)], name: name || l!.content, unit: unit || l!.unit, price, qty: l!.qty, note: `Phát sinh bổ sung từ hồ sơ ${sub!.code}` }]);
    const key = r.keys[0];
    await prisma.priceLine.update({ where: { id: lineId }, data: { lineKey: key } });
    const cl = await prisma.costLine.findFirst({ where: { contractId: c.id, kind: "NC", key } });
    const v = controlVersion(c);
    const prices = JSON.parse(cl?.prices || "{}") as Record<string, number>;
    const p = prices[String(v)] ?? prices["0"] ?? price;
    const ref: DtcpRef = { key, name: cl?.name ?? name, unit: cl?.unit ?? unit, qty: cl?.qty ?? null, price: p, latest: p, approved: [], prevQty: 0 };
    return { ref };
  });
}
