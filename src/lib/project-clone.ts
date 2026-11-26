import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { imagePath } from "@/lib/uploads";
import { fmtTmnCode, nextTmnNumber } from "@/lib/resource-code";

// Nhân bản 1 DT-CP thành 1 DT-CP mới ĐỘC LẬP (VD tháp 2 gần giống tháp 1): chép toàn bộ BOQ, sheet bổ sung / bảng tự do,
// chiết tính (vật tư thay thế, hao hụt, đơn giá, VAT), các sheet tổng hợp (đầu mục, dòng tự thêm, % quản lý), thầu phụ,
// sheet DT-CP, công thức & liên kết, ảnh BOQ, bản tính thiết bị thi công. KHÔNG chép dữ liệu Mua vật tư (chứng từ phát sinh thật) và lịch sử.
//
// Mọi dòng được cấp id mới. Các chỗ lưu id dạng chữ (công thức =LINK("gridh:<id>"), liên kết gridc:/vtg:/tpi:...,
// directBaseId, coveredLines, khoá công thức FieldFormula...) được đổi theo bảng id cũ → mới: id (cuid, duy nhất toàn
// hệ thống) nào thuộc dự án gốc thì đổi sang id tương ứng của bản sao; id của danh mục chung (định mức, bảng giá gốc)
// giữ nguyên. Vật liệu / nhân công riêng của dự án gốc cũng được chép thành bản riêng của dự án mới, nên sửa bên này
// không ảnh hưởng bên kia.

const ID_RE = /c[a-z0-9]{24}/g;

function newId(): string {
  // cùng dạng cuid (c + 24 ký tự a-z0-9) để các chỗ dò id trong chữ vẫn nhận ra
  const t = Date.now().toString(36).padStart(9, "0").slice(-9);
  let r = "";
  for (const b of crypto.randomBytes(15)) r += (b % 36).toString(36);
  return `c${t}${r}`;
}

type Row = Record<string, unknown> & { id: string };

export async function cloneProject(sourceId: string, opts: { name: string; userId: string }): Promise<string> {
  const pid = sourceId;
  const src = await prisma.project.findUnique({ where: { id: pid } });
  if (!src) throw new Error("Không tìm thấy dự án");

  const [resources, sheets, boqItems, images, groups, placements, manuals, subs, toggles, columns, lines, wastages, prices, formulas, swaps, lineQtys, others, equipCalcs] = await Promise.all([
    prisma.resource.findMany({ where: { projectId: pid } }),
    prisma.projectSheet.findMany({ where: { projectId: pid } }),
    prisma.boqItem.findMany({ where: { projectId: pid } }),
    prisma.boqImage.findMany({ where: { projectId: pid } }),
    prisma.vtGroup.findMany({ where: { projectId: pid } }),
    prisma.vtPlacement.findMany({ where: { projectId: pid } }),
    prisma.sheetManualItem.findMany({ where: { projectId: pid } }),
    prisma.subcontractorItem.findMany({ where: { projectId: pid } }),
    prisma.subcontractorNameToggle.findMany({ where: { projectId: pid } }),
    prisma.dtcpColumn.findMany({ where: { projectId: pid } }),
    prisma.dtcpLine.findMany({ where: { projectId: pid } }),
    prisma.projectResourceWastage.findMany({ where: { projectId: pid } }),
    prisma.projectResourcePrice.findMany({ where: { projectId: pid } }),
    prisma.fieldFormula.findMany({ where: { projectId: pid } }),
    prisma.boqLineResourceSwap.findMany({ where: { projectId: pid } }),
    prisma.boqLineQty.findMany({ where: { projectId: pid } }),
    prisma.otherCostItem.findMany({ where: { projectId: pid } }),
    prisma.equipCalc.findMany({ where: { projectId: pid } }),
  ]);
  const sheetIds = sheets.map((s) => s.id);
  const [cells, metas, dcells] = await Promise.all([
    prisma.gridCell.findMany({ where: { sheetId: { in: sheetIds } } }),
    prisma.gridRowMeta.findMany({ where: { sheetId: { in: sheetIds } } }),
    prisma.dtcpCell.findMany({ where: { lineId: { in: lines.map((l) => l.id) } } }),
  ]);

  // bảng id cũ → mới cho MỌI dòng thuộc dự án
  const newPid = newId();
  const map = new Map<string, string>([[pid, newPid]]);
  const all: Row[][] = [resources, sheets, boqItems, images, groups, placements, manuals, subs, toggles, columns, lines, wastages, prices, formulas, swaps, lineQtys, others, equipCalcs, cells, metas, dcells];
  for (const rows of all) for (const r of rows) map.set(r.id, newId());

  const remapStr = (s: string) => s.replace(ID_RE, (m) => map.get(m) ?? m);
  const clone = <T extends Row>(r: T, extra: Partial<T> = {}): T => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) out[k] = typeof v === "string" ? remapStr(v) : v;
    return { ...out, ...extra } as T;
  };
  const many = <T extends Row>(rows: T[], extra?: (r: T) => Partial<T>) => rows.map((r) => clone(r, extra?.(r)));

  // ảnh BOQ: chép file sang thư mục của dự án mới
  const copiedFiles: string[] = [];
  const imageRows = many(images, (r) => {
    const from = imagePath(r.fileName);
    if (!from || !fs.existsSync(from)) return {};
    const rel = `${newPid}/${crypto.randomUUID()}${path.extname(r.fileName)}`;
    const to = imagePath(rel);
    if (!to) return {};
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copiedFiles.push(to);
    return { fileName: rel };
  });

  let codeNo = await nextTmnNumber(); // vật liệu / nhân công riêng của bản sao có mã mới
  try {
    await prisma.$transaction(
      async (tx) => {
        // DT-CP mới = hợp đồng mới (như khi tạo dự án mới); đổi được ở "Điều chỉnh"
        const contract = await tx.contract.create({ data: { name: opts.name } });
        const now = new Date();
        await tx.project.create({ data: { ...clone(src), id: newPid, name: opts.name, contractId: contract.id, createdById: opts.userId, createdAt: now, updatedAt: now, dtcpStatus: "DRAFT", dtcpTp: "{}", dtcpNote: "", dtcpSubmittedBy: "", dtcpSubmittedAt: null, dtcpApprovedBy: "", dtcpApprovedAt: null } });
        await tx.resource.createMany({ data: many(resources, () => ({ code: fmtTmnCode(codeNo++) })) });
        await tx.projectSheet.createMany({ data: many(sheets) });
        await tx.boqItem.createMany({ data: many(boqItems) });
        await tx.gridCell.createMany({ data: many(cells) });
        await tx.gridRowMeta.createMany({ data: many(metas) });
        await tx.boqImage.createMany({ data: imageRows });
        await tx.vtGroup.createMany({ data: many(groups) });
        await tx.vtPlacement.createMany({ data: many(placements) });
        await tx.sheetManualItem.createMany({ data: many(manuals) });
        await tx.subcontractorItem.createMany({ data: many(subs) });
        await tx.subcontractorNameToggle.createMany({ data: many(toggles) });
        await tx.dtcpColumn.createMany({ data: many(columns) });
        await tx.dtcpLine.createMany({ data: many(lines) });
        await tx.dtcpCell.createMany({ data: many(dcells) });
        await tx.projectResourceWastage.createMany({ data: many(wastages) });
        await tx.projectResourcePrice.createMany({ data: many(prices) });
        await tx.fieldFormula.createMany({ data: many(formulas) });
        await tx.boqLineResourceSwap.createMany({ data: many(swaps) });
        await tx.boqLineQty.createMany({ data: many(lineQtys) });
        await tx.otherCostItem.createMany({ data: many(others) });
        await tx.equipCalc.createMany({ data: many(equipCalcs) });
      },
      { timeout: 120_000 }
    );
  } catch (e) {
    for (const f of copiedFiles) fs.rmSync(f, { force: true });
    throw e;
  }
  return newPid;
}
