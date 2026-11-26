import JSZip from "jszip";

// Đọc ảnh nằm trong 1 sheet của file .xlsx (đọc thẳng gói zip - exceljs bản stream không đọc ảnh), gắn mỗi
// ảnh với số dòng Excel (1-based) mà ảnh nằm trên. Hỗ trợ 2 kiểu chèn ảnh:
//  1) ảnh nổi trên ô (Insert > Pictures): xl/drawings/drawingN.xml, neo theo ô (twoCellAnchor/oneCellAnchor);
//     ảnh trải qua nhiều dòng thì lấy dòng ở giữa ảnh
//  2) ảnh nằm trong ô (Excel 365 "Place in Cell" / hàm IMAGE): ô có thuộc tính vm → xl/richData
// Trả về theo từng dòng, mỗi dòng các ảnh xếp từ trái sang phải.

export type SheetImage = { row: number; col: number; data: Buffer; name: string; top?: number }; // top = dòng mép trên của ảnh (1-based)

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m ? decode(m[1]) : null;
}

// Đường dẫn đích của 1 quan hệ (Target) tính từ file nguồn
function resolveTarget(fromFile: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromFile.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

async function readRels(zip: JSZip, file: string): Promise<Map<string, string>> {
  const relsFile = file.replace(/([^/]+)$/, "_rels/$1.rels");
  const xml = await zip.file(relsFile)?.async("string");
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target && attr(m[0], "TargetMode") !== "External") map.set(id, resolveTarget(file, target));
  }
  return map;
}

const num = (xml: string, tag: string) => {
  const m = new RegExp(`<(?:\\w+:)?${tag}>\\s*(-?\\d+)\\s*</(?:\\w+:)?${tag}>`).exec(xml);
  return m ? Number(m[1]) : 0;
};

export async function extractSheetImages(buffer: Buffer, sheetName: string): Promise<SheetImage[]> {
  const zip = await JSZip.loadAsync(buffer);
  const wbXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!wbXml) return [];
  let rid: string | null = null;
  for (const m of wbXml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    if (attr(m[0], "name") === sheetName) rid = attr(m[0], "r:id") ?? attr(m[0], "id");
  }
  if (!rid) return [];
  const sheetFile = (await readRels(zip, "xl/workbook.xml")).get(rid);
  const sheetXml = sheetFile ? await zip.file(sheetFile)?.async("string") : null;
  if (!sheetFile || !sheetXml) return [];
  const sheetRels = await readRels(zip, sheetFile);
  const out: SheetImage[] = [];
  const media = async (path: string | undefined) => (path ? await zip.file(path)?.async("nodebuffer") : undefined);

  // 1) ảnh nổi trên ô
  for (const dm of sheetXml.matchAll(/<(?:\w+:)?drawing\b[^>]*>/g)) {
    const drawingFile = sheetRels.get(attr(dm[0], "r:id") ?? "");
    const dXml = drawingFile ? await zip.file(drawingFile)?.async("string") : null;
    if (!drawingFile || !dXml) continue;
    const dRels = await readRels(zip, drawingFile);
    for (const am of dXml.matchAll(/<((?:\w+:)?)(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/\1\2>/g)) {
      const anchor = am[0];
      const from = /<(?:\w+:)?from>([\s\S]*?)<\/(?:\w+:)?from>/.exec(anchor)?.[1];
      if (!from) continue;
      const r0 = num(from, "row");
      const c0 = num(from, "col");
      let r1 = r0;
      const to = /<(?:\w+:)?to>([\s\S]*?)<\/(?:\w+:)?to>/.exec(anchor)?.[1];
      if (to) {
        r1 = num(to, "row");
        if (r1 > r0 && num(to, "rowOff") === 0) r1--; // ảnh kết thúc đúng mép trên dòng sau → chưa sang dòng đó
      }
      const row = Math.floor((r0 + Math.max(r0, r1)) / 2) + 1;
      // mọi ảnh trong neo (kể cả nhóm ảnh grpSp)
      for (const bm of anchor.matchAll(/<(?:\w+:)?blip\b[^>]*>/g)) {
        const target = dRels.get(attr(bm[0], "r:embed") ?? "");
        const data = await media(target);
        if (data) out.push({ row, col: c0, data, name: target!.split("/").pop()!, top: r0 + 1 });
      }
    }
  }

  // 2) ảnh nằm trong ô (richData)
  if (/\svm="\d+"/.test(sheetXml)) {
    const rvXml = await zip.file("xl/richData/rdrichvalue.xml")?.async("string");
    const relXml = await zip.file("xl/richData/richValueRel.xml")?.async("string");
    if (rvXml && relXml) {
      const structXml = (await zip.file("xl/richData/rdrichvaluestructure.xml")?.async("string")) ?? "";
      const structs = [...structXml.matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/g)].map((s) => [...s[1].matchAll(/<k\b[^>]*>/g)].map((k) => attr(k[0], "n") ?? ""));
      const rvs = [...rvXml.matchAll(/<rv\b([^>]*)>([\s\S]*?)<\/rv>/g)].map((m) => {
        const keys = structs[Number(attr(m[1], "s") ?? 0)] ?? [];
        const vals = [...m[2].matchAll(/<v\b[^>]*>([^<]*)<\/v>/g)].map((v) => v[1]);
        const k = keys.indexOf("_rvRel:LocalImageIdentifier");
        return k >= 0 ? Number(vals[k]) : keys.length ? NaN : Number(vals[0]);
      });
      const relIds = [...relXml.matchAll(/<(?:\w+:)?rel\b[^>]*>/g)].map((m) => attr(m[0], "r:id") ?? "");
      const relTargets = await readRels(zip, "xl/richData/richValueRel.xml");
      // vm (1-based) → valueMetadata → futureMetadata XLRICHVALUE → chỉ số rich value; thiếu metadata thì vm-1
      const vmToRv: number[] = [];
      const metaXml = await zip.file("xl/metadata.xml")?.async("string");
      if (metaXml) {
        const fm = /<futureMetadata\b[^>]*name="XLRICHVALUE"[^>]*>([\s\S]*?)<\/futureMetadata>/.exec(metaXml)?.[1] ?? "";
        const fmRv = [...fm.matchAll(/<(?:\w+:)?rvb\b[^>]*>/g)].map((m) => Number(attr(m[0], "i")));
        const vmBlock = /<valueMetadata\b[^>]*>([\s\S]*?)<\/valueMetadata>/.exec(metaXml)?.[1] ?? "";
        for (const bk of vmBlock.matchAll(/<bk>([\s\S]*?)<\/bk>/g)) {
          const rc = /<rc\b[^>]*>/.exec(bk[1]);
          const v = rc ? Number(attr(rc[0], "v")) : NaN;
          vmToRv.push(Number.isFinite(fmRv[v]) ? fmRv[v] : v);
        }
      }
      for (const cm of sheetXml.matchAll(/<c\b[^>]*\svm="(\d+)"[^>]*>/g)) {
        const ref = attr(cm[0], "r") ?? "";
        const rm = /^([A-Z]+)(\d+)$/.exec(ref);
        if (!rm) continue;
        const vm = Number(cm[1]);
        const rvIdx = vmToRv.length ? vmToRv[vm - 1] : vm - 1;
        const relIdx = rvs[rvIdx];
        if (!Number.isFinite(relIdx)) continue;
        const target = relTargets.get(relIds[relIdx] ?? "");
        const data = await media(target);
        const col = [...rm[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        if (data) out.push({ row: Number(rm[2]), col, data, name: target!.split("/").pop()! });
      }
    }
  }

  return out.sort((a, b) => a.row - b.row || a.col - b.col);
}
