import { prisma } from "@/lib/prisma";
import { lineKeyOf, PS_GROUP_NAME } from "@/lib/hop-dong-calc";
import { getProjectWithBoq } from "@/lib/project-data";
import { loadSheet } from "@/lib/tonghop";

// Lấy sổ giá từ DT-CP lập trên phần mềm: chụp TH Nhân Công thành 1 THỜI ĐIỂM (không phải server action — dùng chung cho nút trên trang hợp đồng
// và cho lúc Trưởng phòng duyệt DT-CP: DT-CP có hiệu lực → tự tạo hợp đồng để đưa qua trình giá đội / thầu phụ)
export async function snapshotNc(projectId: string) {
  const project = await getProjectWithBoq(projectId);
  if (!project) throw new Error("Không tìm thấy DT-CP");
  const { rows, groups } = await loadSheet(project, "NC");
  const out: { key: string; level: "GROUP" | "ITEM"; stt: string; name: string; unit: string; qty: number; price: number; amount: number; note: string; extra?: boolean }[] = [];
  const seen = new Map<string, number>();
  for (const sec of ["A", "B"] as const) {
    const rs = rows.filter((r) => r.section === sec);
    if (!rs.length) continue;
    out.push({ key: `#sec-${sec}`, level: "GROUP", stt: sec, name: sec === "A" ? "Nhân Công Giao Khoán" : "Nhân Công Khác", unit: "", qty: 0, price: 0, amount: 0, note: "" });
    const order = [null, ...groups.filter((g) => g.section === sec).map((g) => g.id)];
    let n = 0;
    for (const gid of order) {
      const gr = rs.filter((r) => (r.groupId ?? null) === gid);
      if (!gr.length) continue;
      const gName = groups.find((g) => g.id === gid)?.name ?? "";
      const extra = gName === PS_GROUP_NAME; // đầu mục phát sinh bổ sung từ sổ giá
      if (gid) out.push({ key: `#grp-${gid}`, level: "GROUP", stt: "", name: gName, unit: "", qty: 0, price: 0, amount: 0, note: "", extra });
      for (const r of gr) {
        let key = lineKeyOf(r.name, r.unit);
        const k = (seen.get(key) ?? 0) + 1;
        seen.set(key, k);
        if (k > 1) key = `${key}#${k}`;
        out.push({ key, level: "ITEM", stt: String(++n), name: r.name, unit: r.unit, qty: r.qty, price: r.priceAfterVat, amount: r.amount, note: r.note, extra });
      }
    }
  }
  return { project, out };
}

// Tạo hợp đồng (DT-CP phần mềm) trong trình giá nếu chưa có; đã có thì trả hợp đồng đó
export async function ensureContractFromProject(projectId: string, user: { id: string; name: string }): Promise<string> {
  const exist = await prisma.costContract.findFirst({ where: { projectId, source: "APP" } });
  if (exist) return exist.id;
  const { project, out } = await snapshotNc(projectId);
  const today = new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const c = await prisma.costContract.create({
    data: {
      area: project.area ?? "",
      name: project.name,
      siteId: (project as { siteId?: string | null }).siteId ?? null, // DANH MỤC DỰ ÁN (chọn khi QSĐT trình DT-CP)
      packageName: project.packageName ?? "",
      contractNo: (project as { contractNo?: string }).contractNo ?? "",
      source: "APP",
      projectId,
      versions: JSON.stringify([{ n: 1, label: `Thời điểm 1 (lấy từ phần mềm ${today})`, approved: true }]),
      approvedVersion: 1,
      createdById: user.id,
      createdByName: user.name,
    },
  });
  await prisma.costLine.createMany({
    data: out.map((l, i) => ({ contractId: c.id, kind: "NC", key: l.key, level: l.level, stt: l.stt, name: l.name, unit: l.unit, qty: l.level === "ITEM" ? l.qty : null, prices: JSON.stringify(l.level === "ITEM" ? { "1": l.price } : {}), amount: l.level === "ITEM" ? l.amount : null, note: l.note, orderIndex: i, extra: !!l.extra })),
  });
  return c.id;
}
