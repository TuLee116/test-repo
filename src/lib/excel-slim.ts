import JSZip from "jszip";

// LÀM NHẸ FILE EXCEL (.xlsx) — sửa trực tiếp bên trong file (gói zip), giữ nguyên công thức, định dạng, các sheet:
//  - nén ảnh (thu cạnh dài về tối đa N px, đổi sang JPEG nếu nhẹ hơn) hoặc xoá hẳn ảnh
//  - gỡ liên kết tới file Excel khác (ô lấy số từ file khác → giữ giá trị đang hiện, như "Break Links")
//  - dọn rác: calcChain, cài đặt máy in, tên vùng lỗi #REF!
// Phần nén ảnh cần trình duyệt (canvas) → truyền hàm resize vào; chạy được cả ở Node để kiểm thử (resize = null thì bỏ qua ảnh).

export type SlimOptions = { images: "compress" | "delete" | "keep"; maxSide: number; quality: number; breakLinks: boolean; junk: boolean };
export type SlimReport = { before: number; after: number; imagesCompressed: number; imagesDeleted: number; linksRemoved: number; formulasToValues: number; namesRemoved: number; notes: string[] };
export type ResizeFn = (data: Uint8Array, mime: string, maxSide: number, quality: number) => Promise<{ data: Uint8Array; ext: "jpeg" | "png" } | null>;

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff" };
// ô công thức có nội dung: <f ...>...</f> (không khớp nhầm thẻ rỗng <f .../>)
const FORMULA = /<((?:\w+:)?f)(\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/\1>/g;
const relsOf = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");
const dirOf = (part: string) => part.replace(/[^/]+$/, "");
// đường dẫn tương đối trong rels → đường dẫn tuyệt đối trong gói
function resolve(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (dirOf(base) + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

export async function slimXlsx(input: ArrayBuffer, opt: SlimOptions, resize: ResizeFn | null, progress?: (msg: string) => void): Promise<{ data: Uint8Array; report: SlimReport }> {
  const zip = await JSZip.loadAsync(input);
  const rep: SlimReport = { before: input.byteLength, after: 0, imagesCompressed: 0, imagesDeleted: 0, linksRemoved: 0, formulasToValues: 0, namesRemoved: 0, notes: [] };
  const files = () => Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const read = (n: string) => zip.file(n)!.async("string");
  let ct = await read("[Content_Types].xml");

  // ---------- 1. Ảnh ----------
  const media = files().filter((n) => /^xl\/media\/[^/]+\.(png|jpe?g|gif|bmp|tiff?)$/i.test(n));
  // các file .rels trỏ tới ảnh (để đổi tên đuôi / gỡ khi xoá)
  const relFiles = files().filter((n) => n.endsWith(".rels"));
  const rename = new Map<string, string>(); // xl/media/a.png → xl/media/a.jpeg

  if (opt.images === "delete") {
    // gỡ khung ảnh trong drawing, gỡ quan hệ, xoá file ảnh không còn ai dùng
    const drawings = files().filter((n) => /^xl\/drawings\/[^/]+\.xml$/.test(n));
    for (const d of drawings) {
      let x = await read(d);
      const n0 = x.length;
      x = x.replace(/<((?:\w+:)?(?:twoCellAnchor|oneCellAnchor|absoluteAnchor))\b[\s\S]*?<\/\1>/g, (a) => (/<(?:\w+:)?pic\b/.test(a) ? "" : a));
      if (x.length !== n0) zip.file(d, x);
    }
    for (const r of relFiles.filter((n) => n.startsWith("xl/drawings/_rels/"))) {
      const x = await read(r);
      const y = x.replace(/<Relationship\b[^>]*Type="[^"]*\/image"[^>]*\/>/g, "");
      if (y !== x) zip.file(r, y);
    }
    // ảnh còn được nơi khác dùng (nền sheet, header/footer...) thì giữ
    const still = new Set<string>();
    for (const r of files().filter((n) => n.endsWith(".rels"))) {
      const x = await read(r);
      const owner = r.replace(/_rels\/([^/]+)\.rels$/, "$1");
      for (const m of x.matchAll(/Target="([^"]+)"/g)) still.add(resolve(owner, m[1]));
    }
    for (const m of media) {
      if (still.has(m)) continue;
      zip.remove(m);
      rep.imagesDeleted++;
    }
  } else if (opt.images === "compress" && resize) {
    let i = 0;
    for (const m of media) {
      i++;
      const f = zip.file(m)!;
      const data = await f.async("uint8array");
      if (data.byteLength < 150 * 1024) continue; // ảnh nhỏ: để nguyên
      progress?.(`Đang nén ảnh ${i}/${media.length}...`);
      const ext = m.split(".").pop()!.toLowerCase();
      const r = await resize(data, MIME[ext] ?? "image/png", opt.maxSide, opt.quality).catch(() => null);
      if (!r || r.data.byteLength >= data.byteLength * 0.9) continue;
      const name = r.ext === ext || (r.ext === "jpeg" && ext === "jpg") ? m : m.replace(/\.[^.]+$/, `.${r.ext}`);
      if (name !== m) {
        zip.remove(m);
        rename.set(m, name);
      }
      zip.file(name, r.data);
      rep.imagesCompressed++;
    }
    if (rename.size) {
      for (const r of relFiles) {
        const owner = r.replace(/_rels\/([^/]+)\.rels$/, "$1");
        const x = await read(r);
        const y = x.replace(/Target="([^"]+)"/g, (a, t: string) => {
          const to = rename.get(resolve(owner, t));
          return to ? `Target="${t.replace(/\.[^.]+$/, to.slice(to.lastIndexOf(".")))}"` : a;
        });
        if (y !== x) zip.file(r, y);
      }
      for (const [e, t] of [["jpeg", "image/jpeg"], ["png", "image/png"]])
        if (!new RegExp(`<Default\\s+Extension="${e}"`, "i").test(ct)) ct = ct.replace(/<Types\b[^>]*>/, (a) => `${a}<Default Extension="${e}" ContentType="${t}"/>`);
    }
  } else if (opt.images === "compress") rep.notes.push("Không nén được ảnh ở môi trường này");

  // ---------- 2. Gỡ liên kết tới file khác ----------
  const wbRelsPath = "xl/_rels/workbook.xml.rels";
  let wb = await read("xl/workbook.xml");
  let wbRels = await read(wbRelsPath);
  const ext = /\[\d+\]/;
  if (opt.breakLinks) {
    const links = files().filter((n) => /^xl\/externalLinks\/[^/]+\.xml$/.test(n));
    if (links.length) {
      progress?.("Đang gỡ liên kết tới file khác...");
      const sheets = files().filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n));
      for (const s of sheets) {
        const x = await read(s);
        if (!ext.test(x)) continue;
        // công thức dùng chung (shared): ô gốc có liên kết ngoài → các ô con cùng nhóm cũng chuyển thành giá trị
        const badSi = new Set<string>();
        for (const m of x.matchAll(FORMULA)) {
          const si = (m[2] ?? "").match(/\bsi="(\d+)"/)?.[1];
          if (si && /t="shared"/.test(m[2] ?? "") && ext.test(m[3])) badSi.add(si);
        }
        let n = 0;
        const y = x
          .replace(FORMULA, (a, _t, attrs: string | undefined, body: string) => {
            const si = (attrs ?? "").match(/\bsi="(\d+)"/)?.[1];
            if (ext.test(body) || (si && badSi.has(si))) {
              n++;
              return "";
            }
            return a;
          })
          .replace(/<((?:\w+:)?f)(\s[^>]*)\/>/g, (a, _t, attrs: string) => {
            const si = attrs.match(/\bsi="(\d+)"/)?.[1];
            if (si && badSi.has(si)) {
              n++;
              return "";
            }
            return a;
          });
        if (n) {
          zip.file(s, y);
          rep.formulasToValues += n;
        }
      }
      for (const l of links) {
        zip.remove(l);
        zip.remove(relsOf(l));
      }
      rep.linksRemoved = links.length;
      wb = wb.replace(/<((?:\w+:)?externalReferences)\b[\s\S]*?<\/\1>/, "");
      wbRels = wbRels.replace(/<Relationship\b[^>]*Type="[^"]*\/externalLink"[^>]*\/>/g, "");
      ct = ct.replace(/<Override\b[^>]*PartName="\/xl\/externalLinks\/[^"]+"[^>]*\/>/g, "");
      // tên vùng trỏ ra file khác
      wb = wb.replace(/<((?:\w+:)?definedName)\b[^>]*>([\s\S]*?)<\/\1>/g, (a, _t, body: string) => {
        if (ext.test(body)) {
          rep.namesRemoved++;
          return "";
        }
        return a;
      });
    }
  }

  // ---------- 3. Dọn rác ----------
  if (opt.junk || (opt.breakLinks && rep.formulasToValues)) {
    if (zip.file("xl/calcChain.xml")) {
      zip.remove("xl/calcChain.xml");
      wbRels = wbRels.replace(/<Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/>/g, "");
      ct = ct.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/g, "");
    }
  }
  if (opt.junk) {
    // tên vùng lỗi #REF!
    wb = wb.replace(/<((?:\w+:)?definedName)\b[^>]*>([\s\S]*?)<\/\1>/g, (a, _t, body: string) => {
      if (/#REF!/.test(body)) {
        rep.namesRemoved++;
        return "";
      }
      return a;
    });
    // cài đặt máy in của từng sheet
    const ps = files().filter((n) => /^xl\/printerSettings\//.test(n));
    if (ps.length) {
      for (const r of files().filter((n) => /^xl\/(worksheets|chartsheets)\/_rels\/.+\.rels$/.test(n))) {
        const x = await read(r);
        const ids = [...x.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Type="[^"]*\/printerSettings"[^>]*\/>/g)].map((m) => m[1]);
        if (!ids.length) continue;
        zip.file(r, x.replace(/<Relationship\b[^>]*Type="[^"]*\/printerSettings"[^>]*\/>/g, ""));
        const sheet = r.replace(/_rels\/([^/]+)\.rels$/, "$1");
        const sx = await read(sheet);
        zip.file(sheet, sx.replace(/(<(?:\w+:)?pageSetup\b[^>]*?)\s+r:id="([^"]+)"/g, (a, head: string, id: string) => (ids.includes(id) ? head : a)));
      }
      for (const p of ps) zip.remove(p);
    }
  }
  // tên vùng trống <definedNames></definedNames> làm Excel báo lỗi
  wb = wb.replace(/<((?:\w+:)?definedNames)\b[^>]*>\s*<\/\1>/, "");
  zip.file("xl/workbook.xml", wb);
  zip.file(wbRelsPath, wbRels);
  zip.file("[Content_Types].xml", ct);

  progress?.("Đang đóng gói file...");
  const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  rep.after = data.byteLength;
  return { data, report: rep };
}

// Nén ảnh bằng canvas của trình duyệt: thu nhỏ, nền trắng, xuất JPEG (ảnh có ít màu thì giữ PNG nếu nhẹ hơn)
export const browserResize: ResizeFn = async (data, mime, maxSide, quality) => {
  if (typeof document === "undefined") return null;
  const bmp = await createImageBitmap(new Blob([data as BlobPart], { type: mime }));
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = (type: string, q?: number) => new Promise<Blob | null>((ok) => c.toBlob(ok, type, q));
  const [jpg, png] = await Promise.all([blob("image/jpeg", quality), k < 1 ? blob("image/png") : Promise.resolve(null)]);
  const best = [jpg && { b: jpg, ext: "jpeg" as const }, png && { b: png, ext: "png" as const }].filter(Boolean).sort((a, b) => a!.b.size - b!.b.size)[0];
  if (!best) return null;
  return { data: new Uint8Array(await best.b.arrayBuffer()), ext: best.ext };
};
