import { prisma } from "@/lib/prisma";
import { canPrice, proposedPriceOf, type PriceUser } from "@/lib/gia-doi";
import { latestPrice, lineKeyOf, parsePrices, priceAt, similarity, type DtcpRef, type Version } from "@/lib/hop-dong-calc";

// Hợp đồng (DT-CP) + SỔ GIÁ ĐỘI trên TH Nhân Công: trạng thái từng dòng, giá duyệt theo đội (áp dụng từ ngày duyệt),
// lũy kế khối lượng đã trình, tự khớp dòng đề xuất với dòng DT-CP.

export const canManageContracts = (u: PriceUser) => canPrice(u, "QSTT", "QSDT") || ["QSTT", "QSDT"].some((r) => u.sub.has(r as "QSTT"));

export const parseVersions = (s: string): Version[] => {
  try {
    return JSON.parse(s) as Version[];
  } catch {
    return [];
  }
};
// thời điểm dùng kiểm soát giá: thời điểm đánh dấu "Đã duyệt"; chưa có thì thời điểm mới nhất
export const controlVersion = (c: { approvedVersion: number; versions: string }) => c.approvedVersion || Math.max(0, ...parseVersions(c.versions).map((v) => v.n));

const fd = (d: Date) => d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

// Các hồ sơ "thay thế" (đã có lần trình sau) không tính vào lũy kế / trạng thái
async function supersededIds(contractId: string) {
  const subs = await prisma.priceSubmission.findMany({ where: { contractId }, select: { parentId: true } });
  return new Set(subs.map((s) => s.parentId).filter((x): x is string => !!x));
}

// Tổ tiên của 1 hồ sơ (các lần trình trước của cùng đề xuất) — không cộng vào lũy kế của chính nó
export async function ancestorIds(id: string): Promise<Set<string>> {
  const out = new Set<string>([id]);
  let cur = await prisma.priceSubmission.findUnique({ where: { id }, select: { parentId: true } });
  while (cur?.parentId && !out.has(cur.parentId)) {
    out.add(cur.parentId);
    cur = await prisma.priceSubmission.findUnique({ where: { id: cur.parentId }, select: { parentId: true } });
  }
  return out;
}

export type LedgerRow = {
  key: string;
  level: string;
  stt: string;
  name: string;
  unit: string;
  qty: number | null;
  amount: number | null;
  vatPct: number | null; // VAT % (dòng chuẩn hoá từ DT-CP cũ); amount là TRƯỚC VAT
  price: number | null; // đơn giá thời điểm kiểm soát
  latest: number | null;
  prices: Record<string, number>;
  status: "APPROVED" | "PENDING" | "REJECTED" | "NONE";
  pending: boolean;
  crews: { crew: string; price: number; date: string; code: string; revision: number; batch: string; by: string }[]; // giá hiện hành theo đội
  history: { crew: string; price: number; date: string; code: string; revision: number; by: string }[];
  future: { crew: string; price: number; date: string; code: string }[]; // đã duyệt, chờ tới giờ hiệu lực
  cumQty: number;
  extra: boolean; // dòng phát sinh bổ sung từ sổ giá
};

export async function loadLedger(contractId: string, kind = "NC") {
  const c = await prisma.costContract.findUnique({ where: { id: contractId } });
  if (!c) return null;
  const v = controlVersion(c);
  const now = Date.now();
  // dòng đã trình (để biết đang chờ duyệt / bị trả về / lũy kế): giá đội từ hồ sơ tổ đội, giá thầu phụ từ hồ sơ thầu phụ
  type Sub = { lineKey: string; qty: number | null; tpOk: boolean; id: string; status: string; reviewedAt: Date | null };
  const subsP: Promise<Sub[]> =
    kind === "TP"
      ? prisma.subLine
          .findMany({
            where: { proposal: { contractId, status: { not: "DRAFT" } }, level: "ITEM", lineKey: { notIn: ["", "-"] } },
            select: { lineKey: true, propQty: true, tpOk: true, proposal: { select: { id: true, status: true, tpAt: true, ptgAt: true } } },
          })
          .then((xs) =>
            xs.map((x) => ({
              lineKey: x.lineKey,
              qty: x.propQty,
              tpOk: x.tpOk,
              id: x.proposal.id,
              status: x.proposal.status === "PTG_PENDING" ? "SUBMITTED" : x.proposal.status,
              reviewedAt: x.proposal.ptgAt ?? x.proposal.tpAt,
            })),
          )
      : prisma.priceLine
          .findMany({
            where: { submission: { contractId, status: { not: "DRAFT" } }, level: "ITEM", lineKey: { notIn: ["", "-"] } },
            select: { lineKey: true, qty: true, tpOk: true, submission: { select: { id: true, status: true, reviewedAt: true } } },
          })
          .then((xs) => xs.map((x) => ({ lineKey: x.lineKey, qty: x.qty, tpOk: x.tpOk, id: x.submission.id, status: x.submission.status, reviewedAt: x.submission.reviewedAt })));
  const supP =
    kind === "TP"
      ? prisma.subProposal.findMany({ where: { contractId }, select: { parentId: true } }).then((xs) => new Set(xs.map((x) => x.parentId).filter((x): x is string => !!x)))
      : supersededIds(contractId);
  const [lines, approvals, subLines, superseded] = await Promise.all([
    prisma.costLine.findMany({ where: { contractId, kind }, orderBy: { orderIndex: "asc" } }),
    prisma.approvedPrice.findMany({ where: { contractId, kind }, orderBy: { approvedAt: "desc" } }),
    subsP,
    supP,
  ]);
  const apprByKey = new Map<string, typeof approvals>();
  for (const ap of approvals) if (ap.lineKey) apprByKey.set(ap.lineKey, [...(apprByKey.get(ap.lineKey) ?? []), ap]);
  const rows: LedgerRow[] = lines.map((l) => {
    const prices = parsePrices(l.prices);
    const ap = apprByKey.get(l.key) ?? [];
    const effective = ap.filter((x) => x.approvedAt.getTime() <= now);
    const crews: LedgerRow["crews"] = [];
    for (const x of effective) if (!crews.some((y) => y.crew === x.crew)) crews.push({ crew: x.crew, price: x.price, date: fd(x.approvedAt), code: x.submissionCode, revision: x.revision, batch: x.batch, by: x.approvedByName });
    // giá đã duyệt nhưng CHƯA tới giờ hiệu lực (thầu phụ nhánh A: chờ Phó Tổng xem / đủ 24 giờ)
    const future = ap.filter((x) => x.approvedAt.getTime() > now).map((x) => ({ crew: x.crew, price: x.price, date: x.approvedAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }), code: x.submissionCode }));
    const mine = subLines.filter((x) => x.lineKey === l.key && !superseded.has(x.id));
    const pending = mine.some((x) => x.status === "SUBMITTED") || future.length > 0;
    const lastApproval = ap[0]?.approvedAt.getTime() ?? 0;
    const rejected = mine.some((x) => (x.status === "REJECTED" || (x.status === "APPROVED" && !x.tpOk)) && (x.reviewedAt?.getTime() ?? 0) > lastApproval);
    const cumQty = mine.filter((x) => x.status === "SUBMITTED" || (x.status === "APPROVED" && x.tpOk)).reduce((t, x) => t + (x.qty ?? 0), 0);
    return {
      key: l.key,
      level: l.level,
      stt: l.stt,
      name: l.name,
      unit: l.unit,
      qty: l.qty,
      amount: l.amount,
      vatPct: l.vatPct ?? null,
      price: priceAt(prices, v),
      latest: latestPrice(prices),
      prices,
      status: crews.length ? "APPROVED" : pending ? "PENDING" : rejected ? "REJECTED" : "NONE",
      pending,
      crews,
      future,
      history: ap.map((x) => ({ crew: x.crew, price: x.price, date: fd(x.approvedAt), code: x.submissionCode, revision: x.revision, by: x.approvedByName })),
      cumQty,
      extra: l.extra,
    };
  });
  // giá đã duyệt ngoài DT-CP chưa đối chiếu ("-" = đã xác nhận giữ ngoài)
  const outside = approvals.filter((x) => !x.lineKey);
  return { contract: c, version: v, rows, outside };
}

// Dòng DT-CP (Nhân Công) rút gọn cho màn hình hồ sơ: đơn giá kiểm soát, giá đã duyệt theo đội, lũy kế đã trình ở hồ sơ KHÁC
export async function dtcpRefs(contractId: string, submissionId: string): Promise<DtcpRef[]> {
  const led = await loadLedger(contractId, "NC");
  if (!led) return [];
  const mine = await ancestorIds(submissionId);
  const superseded = await supersededIds(contractId);
  const others = await prisma.priceLine.findMany({
    where: { submission: { contractId, status: { in: ["SUBMITTED", "APPROVED"] }, id: { notIn: [...mine] } }, level: "ITEM", lineKey: { notIn: ["", "-"] } },
    select: { lineKey: true, qty: true, tpOk: true, submission: { select: { id: true, status: true } } },
  });
  const prev = new Map<string, number>();
  for (const o of others) if (!superseded.has(o.submission.id) && (o.submission.status === "SUBMITTED" || o.tpOk)) prev.set(o.lineKey, (prev.get(o.lineKey) ?? 0) + (o.qty ?? 0));
  return led.rows
    .filter((r) => r.level === "ITEM")
    .map((r) => ({ key: r.key, name: r.name, unit: r.unit, qty: r.qty, price: r.price, latest: r.latest, approved: r.crews.map((c) => ({ crew: c.crew, price: c.price, date: c.date, code: c.code })), prevQty: prev.get(r.key) ?? 0 }));
}

// Tự khớp các dòng đề xuất CHƯA khớp: nhớ khớp cũ → trùng tên + ĐVT → tên giống nhất (≥ 0,6, cùng ĐVT nếu file có ghi ĐVT)
export async function autoMatchLines(submissionId: string, contractId: string) {
  const [lines, ncs, memo] = await Promise.all([
    prisma.priceLine.findMany({ where: { submissionId, level: "ITEM", lineKey: "" }, select: { id: true, content: true, unit: true } }),
    prisma.costLine.findMany({ where: { contractId, kind: "NC", level: "ITEM" }, select: { key: true, name: true, unit: true } }),
    prisma.priceMatch.findMany({ where: { contractId } }),
  ]);
  const memoMap = new Map(memo.map((m) => [m.srcKey, m.lineKey]));
  const keys = new Set(ncs.map((n) => n.key));
  const updates: { id: string; lineKey: string }[] = [];
  for (const l of lines) {
    const src = lineKeyOf(l.content, l.unit);
    let k = memoMap.get(src);
    if (k && !keys.has(k) && k !== "-") k = undefined;
    if (!k && keys.has(src)) k = src;
    if (!k) {
      const unit = lineKeyOf("", l.unit);
      let best: { key: string; s: number } | null = null;
      for (const n of ncs) {
        if (unit !== "|" && lineKeyOf("", n.unit) !== unit) continue; // file đề xuất trống ĐVT: không bắt cùng ĐVT
        const sc = similarity(l.content, n.name);
        if (sc >= 0.6 && (!best || sc > best.s)) best = { key: n.key, s: sc };
      }
      k = best?.key;
    }
    if (k) updates.push({ id: l.id, lineKey: k });
  }
  if (updates.length) await prisma.$transaction(updates.map((u) => prisma.priceLine.update({ where: { id: u.id }, data: { lineKey: u.lineKey } })));
  return updates.length;
}

// Kiểm tra vượt của 1 dòng: đơn giá đề xuất > GIÁ CƠ SỞ (= đơn giá DT-CP dòng đã khớp; chưa khớp thì giá cơ sở trong file),
// hoặc lũy kế KL > KL DT-CP
export function overOf(kind: string, l: Parameters<typeof proposedPriceOf>[1] & { qty: number | null; lineKey: string; basePrice: number | null }, ref: DtcpRef | undefined) {
  const p = proposedPriceOf(kind, l);
  const base = ref?.price ?? l.basePrice;
  return {
    price: p != null && base != null && base > 0 && p > base + 0.5,
    qty: !!ref && ref.qty != null && ref.prevQty + (l.qty ?? 0) > ref.qty + 1e-6,
  };
}
