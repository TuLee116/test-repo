import { computeBoqTree } from "@/lib/boq-tree";
import { prisma } from "@/lib/prisma";
import { fkey } from "@/lib/field-formulas";
import { scopeLabel } from "@/lib/sub-portions";
import type { getProjectWithBoq } from "@/lib/project-data";
import { subAmountVat, type ContractorGroup, type SubGroup, type SubHeadingRow, type SubItemRow, type SubSheet } from "@/lib/thauphu-shared";

type Project = NonNullable<Awaited<ReturnType<typeof getProjectWithBoq>>>;

export async function loadSubSheet(project: Project): Promise<SubSheet> {
  const [groupsDb, nameToggles] = await Promise.all([
    prisma.vtGroup.findMany({ where: { projectId: project.id, kind: "TP" }, orderBy: { orderIndex: "asc" } }),
    prisma.subcontractorNameToggle.findMany({ where: { projectId: project.id } }),
  ]);
  const tree = computeBoqTree(project.boqItems);
  // project.subcontractorItems đã được getProjectWithBoq tính lại amount (= đơn giá × KL BOQ) cho dòng link BOQ
  const subsByBoq = new Map<string, (typeof project.subcontractorItems)[number][]>();
  for (const s of project.subcontractorItems) if (s.boqItemId) subsByBoq.set(s.boqItemId, [...(subsByBoq.get(s.boqItemId) ?? []), s]);

  const boqRows: (SubHeadingRow | SubItemRow)[] = [];
  let seq = 0;
  for (const b of project.boqItems) {
    if (b.isHeading) {
      const ids = (tree.scope.get(b.id) ?? []).flatMap((x) => subsByBoq.get(x) ?? []);
      if (ids.length === 0) continue; // chỉ hiện đầu mục có công tác thầu phụ
      boqRows.push({
        type: "heading",
        id: b.id,
        depth: tree.depthOf.get(b.id) ?? 0,
        stt: b.stt,
        text: b.rawDescription,
        total: ids.reduce((s, x) => s + x.amount, 0),
        totalVat: ids.reduce((s, x) => s + subAmountVat(x), 0),
        itemIds: ids.map((x) => x.id),
      });
      seq = 0;
      continue;
    }
    const mine = subsByBoq.get(b.id) ?? [];
    if (!mine.length) continue;
    const portions = b.method === "SUB" ? mine.slice(0, 1) : mine;
    portions.forEach((sub, pi) => {
      seq++;
      const partial = !sub.followBoq;
      boqRows.push({
        type: "item",
        id: sub.id,
        depth: tree.depthOf.get(b.id) ?? 0,
        stt: (b.stt || String(seq)) + (partial && portions.length > 1 ? `.${pi + 1}` : ""),
        name: (b.rawDescription || b.workItem?.name || sub.name) + (partial ? ` (phần giao thầu phụ ${pi + 1}/${portions.length})` : ""),
        unit: b.rawUnit || b.workItem?.unit || "",
        qty: partial ? sub.quantity : b.quantity,
        qtyEditable: partial && sub.percent == null,
        qtyFormula: partial ? project.formulaCtx.formulas.get(fkey("sub", sub.id, "quantity")) ?? "" : undefined,
        qtyErr: partial ? project.formulaCtx.errs.get(fkey("sub", sub.id, "quantity")) ?? "" : undefined,
        scope: partial ? scopeLabel(sub) + (sub.percent != null ? ` · ${+sub.percent.toFixed(2)}% KL` : "") : undefined,
        unitPrice: sub.unitPrice,
        quotedPct: sub.quotedPct,
        unitPriceFormula: project.formulaCtx.formulas.get(fkey("sub", sub.id, "unitPrice")) ?? "",
        unitPriceErr: project.formulaCtx.errs.get(fkey("sub", sub.id, "unitPrice")) ?? "",
        amount: sub.amount,
        mgmtFee: project.subMgmt.get(sub.id)?.fee,
        prelimPct: sub.prelimPct,
        vatRate: sub.vatRate,
        amountVat: subAmountVat(sub),
        contractorName: sub.contractorName,
        note: sub.note,
        linked: true,
      });
    });
  }

  // Các công tác nằm liền nhau dưới cùng 1 đầu mục: xếp gom theo tên thầu phụ (thầu phụ xuất hiện trước đứng trước,
  // trong mỗi thầu phụ giữ thứ tự BOQ; dòng chưa có tên thầu phụ để cuối) để nhập giá từng thầu phụ cho liền mạch.
  // Chỉ xếp trong từng đoạn giữa 2 dòng đầu mục nên đầu mục / tổng không đổi.
  for (let i = 0; i < boqRows.length; ) {
    if (boqRows[i].type !== "item") {
      i++;
      continue;
    }
    let j = i;
    while (j < boqRows.length && boqRows[j].type === "item") j++;
    const seg = boqRows.slice(i, j) as SubItemRow[];
    const rank = new Map<string, number>();
    for (const r of seg) {
      const k = r.contractorName.trim().toLocaleLowerCase("vi");
      if (k && !rank.has(k)) rank.set(k, rank.size);
    }
    const rankOf = (r: SubItemRow) => rank.get(r.contractorName.trim().toLocaleLowerCase("vi")) ?? rank.size;
    seg.sort((a, b) => rankOf(a) - rankOf(b));
    boqRows.splice(i, seg.length, ...seg);
    i = j;
  }

  const manual: SubItemRow[] = project.subcontractorItems
    .filter((s) => !s.boqItemId)
    .map((s) => {
      // dữ liệu cũ chỉ có "giá trị": hiện là SL 1 × đơn giá = giá trị
      const legacy = s.quantity === 0 && s.unitPrice === 0 && s.amount > 0;
      return {
        type: "item" as const,
        id: s.id,
        depth: 0,
        stt: "",
        name: s.name,
        unit: s.unit,
        qty: legacy ? 1 : s.quantity,
        unitPrice: legacy ? s.amount : s.unitPrice,
        quotedPct: s.quotedPct,
        unitPriceFormula: project.formulaCtx.formulas.get(fkey("sub", s.id, "unitPrice")) ?? "",
        unitPriceErr: project.formulaCtx.errs.get(fkey("sub", s.id, "unitPrice")) ?? "",
        qtyFormula: project.formulaCtx.formulas.get(fkey("sub", s.id, "quantity")) ?? "",
        qtyErr: project.formulaCtx.errs.get(fkey("sub", s.id, "quantity")) ?? "",
        amount: s.amount,
        prelimPct: s.prelimPct,
        vatRate: s.vatRate,
        amountVat: subAmountVat(s),
        contractorName: s.contractorName,
        note: s.note,
        linked: false,
        groupId: s.groupId,
      };
    })
    .map((r) => r);

  const groupIds = new Set(groupsDb.map((g) => g.id));
  const groupOf = (id: string) => project.subcontractorItems.find((s) => s.id === id)?.groupId ?? null;
  const looseItems = manual.filter((m) => {
    const g = groupOf(m.id);
    return !g || !groupIds.has(g);
  });
  const groups: SubGroup[] = groupsDb.map((g) => {
    const items = manual.filter((m) => groupOf(m.id) === g.id);
    return { id: g.id, name: g.name, total: items.reduce((s, i) => s + i.amount, 0), totalVat: items.reduce((s, i) => s + i.amountVat, 0), itemIds: items.map((i) => i.id), items, showInDtcp: g.showInDtcp };
  });

  // Tổng hợp theo tên thầu phụ - chỉ tính công tác link từ BOQ/CHI TIẾT (phần "Thầu phụ theo CHI TIẾT"
  // bên DT-CP); phần bổ sung/nhóm thủ công đã có "đầu mục lớn" riêng (groups) ở trên.
  const toggleOf = new Map(nameToggles.map((t) => [t.name, t.showInDtcp]));
  const byContractor = new Map<string, number>();
  for (const s of project.subcontractorItems) {
    if (!s.boqItemId) continue;
    const name = s.contractorName.trim();
    if (!name) continue;
    byContractor.set(name, (byContractor.get(name) ?? 0) + subAmountVat(s));
  }
  const rateOf = new Map(nameToggles.map((t) => [t.name.trim(), t]));
  const mgmtOf = new Map<string, { fee: number; vtBase: number; tbBase: number }>();
  for (const s of project.subcontractorItems) {
    const m = project.subMgmt.get(s.id);
    if (!m) continue;
    const k = s.contractorName.trim();
    const cur = mgmtOf.get(k) ?? { fee: 0, vtBase: 0, tbBase: 0 };
    mgmtOf.set(k, { fee: cur.fee + m.fee, vtBase: cur.vtBase + m.vtBase, tbBase: cur.tbBase + m.tbBase });
  }
  const contractorGroups: ContractorGroup[] = [...byContractor.entries()]
    .map(([name, total]) => ({
      name,
      total,
      showInDtcp: toggleOf.get(name) ?? true,
      mgmtVtPct: rateOf.get(name)?.mgmtVtPct ?? 0,
      mgmtTbPct: rateOf.get(name)?.mgmtTbPct ?? 0,
      mgmtFee: mgmtOf.get(name)?.fee ?? 0,
      vtBase: mgmtOf.get(name)?.vtBase ?? 0,
      tbBase: mgmtOf.get(name)?.tbBase ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));

  const total = project.subcontractorItems.reduce((s, i) => s + i.amount, 0);
  const totalVat = project.subcontractorItems.reduce((s, i) => s + subAmountVat(i), 0);
  return { boqRows, looseItems, groups, contractorGroups, total, totalVat };
}
