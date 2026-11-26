import { prisma } from "@/lib/prisma";
import { controlVersion } from "@/lib/hop-dong";
import { lineKeyOf, parsePrices, priceAt, suggestScore } from "@/lib/hop-dong-calc";

// Dữ liệu tab "Đối chiếu với DT-CP": dòng giá đội đã duyệt chưa khớp TH Nhân Công, gom theo tên + ĐVT, kèm 3 gợi ý dòng DT-CP
export type DcOption = { key: string; name: string; unit: string; price: number | null; extra: boolean };
export type DcRow = {
  srcKey: string;
  name: string;
  unit: string;
  count: number; // số lần duyệt
  crews: string[];
  price: number; // giá duyệt gần nhất
  date: string;
  qty: number; // lũy kế KL đã duyệt
  value: number; // Σ giá × KL
  codes: string[];
  confirmed: boolean; // đã xác nhận giữ ngoài DT-CP
  sugg: { key: string; score: number }[];
};

export async function loadOutside(contractId: string): Promise<{ rows: DcRow[]; options: DcOption[] }> {
  const c = await prisma.costContract.findUnique({ where: { id: contractId }, select: { approvedVersion: true, versions: true } });
  if (!c) return { rows: [], options: [] };
  const v = controlVersion(c);
  const [lines, aps] = await Promise.all([
    prisma.costLine.findMany({ where: { contractId, kind: "NC", level: "ITEM" }, orderBy: { orderIndex: "asc" }, select: { key: true, name: true, unit: true, prices: true, extra: true } }),
    prisma.approvedPrice.findMany({ where: { contractId, kind: "NC", lineKey: { in: ["", "-"] } }, orderBy: { approvedAt: "desc" } }),
  ]);
  const options: DcOption[] = lines.map((l) => ({ key: l.key, name: l.name, unit: l.unit, price: priceAt(parsePrices(l.prices), v), extra: l.extra }));
  const by = new Map<string, typeof aps>();
  for (const a of aps) {
    const k = lineKeyOf(a.name, a.unit);
    by.set(k, [...(by.get(k) ?? []), a]);
  }
  const rows: DcRow[] = [...by.entries()].map(([srcKey, xs]) => {
    const a = xs[0];
    const sugg = options
      .map((o) => ({ key: o.key, score: suggestScore(a.name, a.unit, o.name, o.unit) }))
      .filter((s) => s.score >= 0.25)
      .sort((x, y) => y.score - x.score)
      .slice(0, 3);
    return {
      srcKey,
      name: a.name,
      unit: a.unit,
      count: xs.length,
      crews: [...new Set(xs.map((x) => x.crew || "(chưa có đội)"))],
      price: a.price,
      date: a.approvedAt.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      qty: xs.reduce((s, x) => s + (x.qty ?? 0), 0),
      value: xs.reduce((s, x) => s + x.price * (x.qty ?? 0), 0),
      codes: [...new Set(xs.map((x) => x.submissionCode))],
      confirmed: xs.every((x) => x.lineKey === "-"),
      sugg,
    };
  });
  rows.sort((x, y) => Number(x.confirmed) - Number(y.confirmed) || (y.sugg[0]?.score ?? 0) - (x.sugg[0]?.score ?? 0) || y.value - x.value);
  return { rows, options };
}
