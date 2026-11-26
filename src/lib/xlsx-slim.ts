import JSZip from "jszip";
import { listSheets, openZip } from "@/lib/xlsx-subset";

// RÚT GỌN file .xlsx trước khi lưu vào cơ sở dữ liệu (giảm dung lượng hệ thống):
//  - chỉ giữ các sheet cần (các sheet khác + hình ảnh / bản vẽ của chúng bị bỏ)
//  - bỏ hình ảnh (logo BCH dán lặp lại hàng chục lần là thủ phạm làm file nặng hàng MB)
//  - bỏ mọi phần mồ côi (không còn được liên kết tới), tên vùng cũ, nén lại mức cao
// Dữ liệu, công thức, định dạng, ô gộp của sheet được giữ nguyên.

const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attrsOf = (tag: string) => {
  const o: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) o[m[1]] = unesc(m[2]);
  return o;
};
// đường dẫn đích của 1 quan hệ (Target) so với thư mục chứa file .rels
function resolveTarget(relsPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = relsPath.replace(/_rels\/[^/]*\.rels$/, ""); // thư mục của phần nguồn (tên file có thể chỉ là ".rels")
  const parts = (base + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

export async function slimXlsx(buf: ArrayBuffer | Uint8Array, keep: string[], opts: { dropImages?: boolean } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const dropImages = opts.dropImages !== false;
  const zip: JSZip = await openZip(buf);
  const sheets = await listSheets(zip);
  const want = new Set(keep);
  const kept = sheets.filter((s) => want.has(s.name));
  if (!kept.length) return new Uint8Array(buf as ArrayBuffer); // không nhận ra sheet → giữ nguyên, không đụng

  // 1) bỏ các sheet không cần khỏi workbook.xml / rels / [Content_Types].xml
  let wbXml = await zip.file("xl/workbook.xml")!.async("string");
  let relXml = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  let ctXml = await zip.file("[Content_Types].xml")!.async("string");
  for (const s of sheets.filter((x) => !want.has(x.name))) {
    wbXml = wbXml.replace(new RegExp(`<sheet\\b[^>]*\\br:id="${s.rid}"[^>]*/>`), "");
    relXml = relXml.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${s.rid}"[^>]*/>`), "");
    zip.remove(s.path);
  }
  // tên vùng cũ theo chỉ số sheet sẽ lệch → bỏ; tab đang chọn về sheet đầu
  wbXml = wbXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, "").replace(/\s(activeTab|firstSheet)="\d+"/g, "");
  zip.file("xl/workbook.xml", wbXml);
  zip.file("xl/_rels/workbook.xml.rels", relXml);

  // 2) bỏ hình ảnh của các sheet giữ lại: gỡ thẻ <drawing> + quan hệ drawing
  if (dropImages) {
    for (const s of kept) {
      const relPath = s.path.replace(/([^/]+)$/, "_rels/$1.rels");
      const rf = zip.file(relPath);
      if (!rf) continue;
      let rx = await rf.async("string");
      let sx = await zip.file(s.path)!.async("string");
      for (const m of [...rx.matchAll(/<Relationship\b[^>]*>/g)]) {
        const a = attrsOf(m[0]);
        if (!/\/drawing$/.test(a.Type ?? "")) continue;
        rx = rx.replace(m[0], "");
        sx = sx.replace(new RegExp(`<drawing\\b[^>]*\\br:id="${a.Id}"[^>]*/>`), "");
      }
      zip.file(s.path, sx);
      zip.file(relPath, rx);
    }
  }

  // 3) chỉ giữ các phần còn được liên kết từ gốc (_rels/.rels → workbook → sheet → ...)
  const reachable = new Set<string>(["[Content_Types].xml", "_rels/.rels"]);
  const queue = ["_rels/.rels"];
  while (queue.length) {
    const relsPath = queue.pop()!;
    const rf = zip.file(relsPath);
    if (!rf) continue;
    const rx = await rf.async("string");
    for (const m of rx.matchAll(/<Relationship\b[^>]*>/g)) {
      const a = attrsOf(m[0]);
      if (!a.Target || a.TargetMode === "External") continue;
      const target = resolveTarget(relsPath, a.Target);
      if (reachable.has(target)) continue;
      reachable.add(target);
      const own = target.replace(/([^/]+)$/, "_rels/$1.rels");
      if (zip.file(own)) {
        reachable.add(own);
        queue.push(own);
      }
    }
  }
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    if (!reachable.has(name)) {
      zip.remove(name);
      // gỡ khỏi [Content_Types].xml nếu có khai báo riêng
      ctXml = ctXml.replace(new RegExp(`<Override\\b[^>]*PartName="/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*/>`), "");
    }
  }
  // các phần (sheet đã bỏ...) không còn trong gói thì khai báo Override cũng phải bỏ
  ctXml = ctXml.replace(/<Override\b[^>]*PartName="\/([^"]+)"[^>]*\/>/g, (m, p: string) => (zip.file(p) ? m : ""));
  zip.file("[Content_Types].xml", ctXml);

  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
  return new Uint8Array(out); // bản sao có ArrayBuffer thường (Prisma yêu cầu)
}
