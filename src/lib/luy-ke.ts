import { prisma } from "@/lib/prisma";
import { controlVersion } from "@/lib/hop-dong";
import { lineKeyOf, parsePrices, priceAt } from "@/lib/hop-dong-calc";

// TỔNG HỢP LŨY KẾ CÁC ĐỢT DUYỆT ĐƠN GIÁ ĐỘI của 1 hợp đồng: mỗi dòng = 1 công việc × 1 đội, mỗi đợt duyệt = 1 nhóm cột
// (KL, đơn giá, thành tiền), cuối bảng lũy kế KL / thành tiền và so với DT-CP.
// Hồ sơ đã được TRÌNH LẠI và lần sau đã duyệt thì không tính (tránh cộng 2 lần cùng 1 đề xuất).

export type CumBatch = { key: string; label: string; date: string; at: number }; // at = ngày TRÌNH sớm nhất của đợt (xếp cột đợt theo ngày trình)
export type CumCell = { qty: number; price: number; amount: number };
export type CumRow = {
  key: string;
  stt: string;
  name: string;
  unit: string;
  crew: string;
  lineKey: string; // dòng TH Nhân Công ("" = ngoài DT-CP)
  outside: boolean; // ngoài DT-CP
  dtQty: number | null;
  dtPrice: number | null;
  cells: Record<string, CumCell>;
  qty: number;
  amount: number;
};

const fd = (d: Date) => d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

export async function loadCumulative(contractId: string) {
  const c = await prisma.costContract.findUnique({ where: { id: contractId } });
  if (!c) return null;
  const v = controlVersion(c);
  const [lines, approvals, subs] = await Promise.all([
    prisma.costLine.findMany({ where: { contractId, kind: "NC", level: "ITEM" }, orderBy: { orderIndex: "asc" }, select: { key: true, stt: true, name: true, unit: true, qty: true, prices: true } }),
    prisma.approvedPrice.findMany({ where: { contractId, kind: "NC", approvedAt: { lte: new Date() } }, orderBy: { approvedAt: "asc" } }),
    prisma.priceSubmission.findMany({ where: { contractId }, select: { id: true, parentId: true, status: true, submittedAt: true } }),
  ]);
  const childOf = new Map(subs.filter((s) => s.parentId).map((s) => [s.parentId!, s.id]));
  const status = new Map(subs.map((s) => [s.id, s.status]));
  const subAt = new Map(subs.map((s) => [s.id, s.submittedAt]));
  const replaced = (id: string) => {
    for (let k = childOf.get(id), n = 0; k && n < 50; k = childOf.get(k), n++) if (status.get(k) === "APPROVED") return true;
    return false;
  };

  // đợt: theo tên đợt của hồ sơ (trống thì theo số hồ sơ), xếp theo ngày duyệt sớm nhất
  const batches: CumBatch[] = [];
  const byKey = new Map<string, CumRow>();
  const lineMap = new Map(lines.map((l, i) => [l.key, { ...l, i }]));
  for (const a of approvals) {
    if (replaced(a.submissionId)) continue;
    const bk = a.batch.trim() || a.submissionCode;
    const at = (subAt.get(a.submissionId) ?? a.approvedAt).getTime();
    const ob = batches.find((b) => b.key === bk);
    if (!ob) batches.push({ key: bk, label: !a.batch.trim() || /^đ[ợo]t/i.test(bk) ? bk : `Đợt ${bk}`, date: fd(a.approvedAt), at });
    else ob.at = Math.min(ob.at, at);
    const dt = a.lineKey && a.lineKey !== "-" ? lineMap.get(a.lineKey) : undefined;
    const rk = `${dt ? dt.key : `x:${lineKeyOf(a.name, a.unit)}`}|${a.crew.trim().toLowerCase()}`;
    let row = byKey.get(rk);
    if (!row) {
      row = {
        key: rk,
        stt: dt?.stt ?? "",
        name: dt?.name ?? a.name,
        unit: dt?.unit ?? a.unit,
        lineKey: dt?.key ?? "",
        crew: a.crew,
        outside: !dt,
        dtQty: dt?.qty ?? null,
        dtPrice: dt ? priceAt(parsePrices(dt.prices), v) : null,
        cells: {},
        qty: 0,
        amount: 0,
      };
      byKey.set(rk, row);
    }
    const q = a.qty ?? 0;
    const cell = (row.cells[bk] ??= { qty: 0, price: 0, amount: 0 });
    cell.qty += q;
    cell.amount += q * a.price;
    cell.price = cell.qty ? cell.amount / cell.qty : a.price;
    row.qty += q;
    row.amount += q * a.price;
  }
  batches.sort((x, y) => x.at - y.at); // cột đợt theo ngày trình → đợt cuối = đơn giá mới nhất
  const order = (r: CumRow) => (r.outside ? 1e9 : (lineMap.get(r.lineKey)?.i ?? 1e9));
  const rows = [...byKey.values()].sort((x, y) => order(x) - order(y) || x.name.localeCompare(y.name, "vi") || x.crew.localeCompare(y.crew, "vi"));
  // cùng 1 dòng DT-CP có nhiều đội: tổng lũy kế KL của mọi đội để so với KL DT-CP
  const lineQty = new Map<string, number>();
  for (const r of rows) if (!r.outside) lineQty.set(r.lineKey, (lineQty.get(r.lineKey) ?? 0) + r.qty);
  return { contract: c, batches, rows, lineQty };
}
