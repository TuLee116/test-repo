// Đọc "data/source/Du-Lieu-Chiet-Tinh.xlsx" và xuất ra prisma/seed-data/*.json
// Chạy lại script này (npm run import:catalog) mỗi khi file Excel nguồn được cập nhật.
import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "data", "source", "Du-Lieu-Chiet-Tinh.xlsx");
const OUT_DIR = path.join(__dirname, "..", "prisma", "seed-data");

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(SRC);

function cellText(row, col) {
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "richText" in v) {
    return v.richText.map((t) => t.text).join("");
  }
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  return String(v).trim();
}

function cellNum(row, col) {
  const v = row.getCell(col).value;
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && "result" in v) return typeof v.result === "number" ? v.result : null;
  return typeof v === "number" ? v : null;
}

// ---------- 1) Bảng giá gốc: Vật tư / Thiết bị / Nhân công ----------
function parseResourceSheet(sheetName, sourceType, colMap) {
  const ws = wb.getWorksheet(sheetName);
  const resources = [];
  let groupLabel = "";
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < colMap.headerRow + 1) return;
    const code = cellText(row, colMap.code);
    const name = cellText(row, colMap.name);
    const unit = cellText(row, colMap.unit);
    const price = cellNum(row, colMap.price);
    if (!code && name && !unit) {
      // dòng nhóm kiểu "I  BÊ TÔNG" (không có mã, không có đơn vị)
      groupLabel = name;
      return;
    }
    if (!code) return;
    resources.push({
      code,
      name,
      unit,
      unitPrice: price ?? 0,
      sourceType,
      groupLabel,
    });
  });
  return resources;
}

const resourcesVT = parseResourceSheet("2. Vat Tu", "VT", {
  headerRow: 3,
  code: 2,
  name: 3,
  unit: 4,
  price: 6,
});
const resourcesTB = parseResourceSheet("3. Thiet Bi", "TB", {
  headerRow: 3,
  code: 2,
  name: 3,
  unit: 4,
  price: 6,
});
const resourcesNC = parseResourceSheet("4. Nhan Cong", "NC", {
  headerRow: 4,
  code: 2,
  name: 3,
  unit: 4,
  price: 5,
});

const allResources = [...resourcesVT, ...resourcesTB, ...resourcesNC];

// Mã trùng giữa các nhóm nhưng có 2 dòng khác giá trong "4. Nhan Cong" (NC.BT.Cauth, NC.VK.Cauth,
// NC.BT.Lanhto...) là dữ liệu chủ đích của TMN (dùng chung 1 mã cho các vị trí khác nhau nhưng cùng giá).
// Khi trùng mã, giữ dòng đầu tiên (giá giống nhau theo xác nhận trong skill dự án).
const resourceByCode = new Map();
for (const r of allResources) {
  if (!resourceByCode.has(r.code)) resourceByCode.set(r.code, r);
}
const resources = [...resourceByCode.values()];

// ---------- 2) "1. Dinh Muc": danh mục công tác + chiết tính hao phí ----------
const ws = wb.getWorksheet("1. Dinh Muc");
const HEADER_ROW = 3;
const COL = { stt: 1, code: 2, desc: 3, unit: 4, qty: 5, wastage: 6, basePrice: 7, vt: 8, tb: 9, nc: 10, total: 11, note: 12 };

const workItems = [];
let currentSection = "";
let currentSubsection = "";
let currentItem = null;
let currentCategory = null; // 'VT' | 'TB' | 'NC'

function isRomanOrLetterLabel(a) {
  return typeof a === "string" && /^[A-Z]+$/.test(a.trim()) && a.trim().length <= 4;
}

function flushItem() {
  if (currentItem) {
    // Nếu không tách được dòng hao phí nào nhưng tổng ở dòng đầu > 0 -> dùng số cố định làm fallback
    if (currentItem.lines.length === 0 && currentItem._headerTotals) {
      const { vt, tb, nc } = currentItem._headerTotals;
      currentItem.fixedVT = vt || 0;
      currentItem.fixedTB = tb || 0;
      currentItem.fixedNC = nc || 0;
    }
    delete currentItem._headerTotals;
    workItems.push(currentItem);
  }
  currentItem = null;
}

ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
  if (rowNumber <= HEADER_ROW) return;
  const A = cellText(row, COL.stt);
  const B = cellText(row, COL.code);
  const C = cellText(row, COL.desc);
  const D = cellText(row, COL.unit);
  const E = cellNum(row, COL.qty);
  const F = cellNum(row, COL.wastage);
  const G = cellNum(row, COL.basePrice);
  const H = cellNum(row, COL.vt);
  const I = cellNum(row, COL.tb);
  const J = cellNum(row, COL.nc);
  const K = cellNum(row, COL.total);
  const note = cellText(row, COL.note);

  if (C === "Vật tư:") { currentCategory = "VT"; return; }
  if (C === "Thiết bị:") { currentCategory = "TB"; return; }
  if (C === "Nhân công:") { currentCategory = "NC"; return; }
  if (C === "Cộng chi phí trực tiếp") return;

  // Dòng nhóm "Phần" (A = 1 chữ cái, VD "A") hoặc nhóm La Mã (A = "I","II"...) không có B/D và không có K
  if (isRomanOrLetterLabel(A) && !B && !D && !K) {
    flushItem();
    currentCategory = null;
    if (A.length === 1 && /^[A-Z]$/.test(A)) {
      currentSection = C;
      currentSubsection = "";
    } else {
      currentSubsection = C;
    }
    return;
  }

  // Dòng đầu công tác: có tổng cộng (K khác 0/null) -> bắt đầu 1 work item mới
  if (K !== null && K !== 0) {
    flushItem();
    currentCategory = null;
    currentItem = {
      code: B,
      name: C,
      unit: D,
      section: currentSection,
      subsection: currentSubsection,
      note,
      lines: [],
      _headerTotals: { vt: H || 0, tb: I || 0, nc: J || 0 },
    };
    return;
  }

  // Dòng hao phí tài nguyên (có mã B)
  if (B && currentItem) {
    // Bù lỗi thiếu nhãn "Nhân công:" (VD AF.81132-1/-2 "Ván khuôn cột hầm"): mã nguồn từ
    // "4. Nhan Cong" luôn là chi phí nhân công, không phụ thuộc nhãn Vật tư:/Thiết bị: phía trên.
    if (!resourceByCode.has(B)) {
      // Mã tài nguyên chưa có trong "2. Vat Tu"/"3. Thiet Bi"/"4. Nhan Cong" (VD AE.91347,
      // TMN.PK.003/004 - dòng hao phí = 0, TMN chưa lập giá) -> tạo placeholder giá 0 để không
      // vỡ ràng buộc dữ liệu; cần TMN bổ sung giá thật sau qua màn hình quản trị.
      const placeholder = {
        code: B,
        name: C || B,
        unit: D || "",
        unitPrice: G ?? 0,
        sourceType: currentCategory ?? "VT",
        groupLabel: "(Tự phát sinh - chưa có giá gốc, cần TMN bổ sung)",
      };
      resourceByCode.set(B, placeholder);
      resources.push(placeholder);
    }
    const sourceType = resourceByCode.get(B)?.sourceType;
    const category = sourceType === "NC" ? "NC" : currentCategory;
    if (category) {
      currentItem.lines.push({
        resourceCode: B,
        quantity: E ?? 1,
        wastageRate: F ?? 0,
        category,
      });
    }
  }
});
flushItem();

// Validate: mọi resourceCode tham chiếu phải tồn tại trong bảng resources
const codeSet = new Set(resources.map((r) => r.code));
const missing = new Set();
for (const item of workItems) {
  for (const line of item.lines) {
    if (!codeSet.has(line.resourceCode)) missing.add(line.resourceCode);
  }
}

// Mã công tác (WorkItem.code) phải duy nhất
const itemCodeCount = new Map();
for (const it of workItems) itemCodeCount.set(it.code, (itemCodeCount.get(it.code) || 0) + 1);
const dupCodes = [...itemCodeCount.entries()].filter(([, n]) => n > 1);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "resources.json"), JSON.stringify(resources, null, 2), "utf8");
fs.writeFileSync(path.join(OUT_DIR, "work-items.json"), JSON.stringify(workItems, null, 2), "utf8");

console.log(`Resources: ${resources.length} (VT=${resourcesVT.length}, TB=${resourcesTB.length}, NC=${resourcesNC.length})`);
console.log(`Work items: ${workItems.length}`);
console.log(`Missing resource codes referenced: ${missing.size}`, [...missing].slice(0, 20));
console.log(`Duplicate work item codes: ${dupCodes.length}`, dupCodes.slice(0, 20));
