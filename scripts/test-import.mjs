// Script kiểm thử nhanh luồng nhập BOQ từ Excel (không qua UI) — chạy: node scripts/test-import.mjs
import ExcelJS from "exceljs";

const BASE = "http://localhost:3210";

async function login() {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfCookie = csrfRes.headers.get("set-cookie");
  const { csrfToken } = await csrfRes.json();

  const body = new URLSearchParams({
    username: "admin",
    password: "tmn@2026",
    csrfToken,
    callbackUrl: `${BASE}/projects`,
    json: "true",
  });

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: csrfCookie },
    body,
    redirect: "manual",
  });

  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
  const allCookies = [...(csrfCookie ? [csrfCookie] : []), ...setCookies].filter(Boolean);
  const cookieHeader = allCookies.map((c) => c.split(";")[0]).join("; ");
  return cookieHeader;
}

async function buildTestXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ Mời thầu");
  ws.addRow(["STT", "Ghi chú", "Mô tả công việc", "ĐVT", "Khối lượng"]);
  ws.addRow([1, "", "Gia công, lắp dựng và tháo dỡ ván khuôn dầm, sàn nâng", "m2", 30]);
  ws.addRow([2, "", "gia cong lap dung thao do van khuon dam san nang", "m2", 20]); // không dấu, viết thường -> nên fuzzy/exact match
  ws.addRow([3, "", "Công tác lạ hoàn toàn không có trong danh mục XYZ123", "cái", 5]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function main() {
  const cookie = await login();
  if (!cookie.includes("session")) {
    console.log("Cookie sau login:", cookie);
  }

  const fileBuf = await buildTestXlsx();
  const fd1 = new FormData();
  fd1.append("file", new Blob([fileBuf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "test-boq.xlsx");

  const inspectRes = await fetch(`${BASE}/api/import/inspect`, { method: "POST", headers: { cookie }, body: fd1 });
  console.log("inspect status:", inspectRes.status);
  const inspectData = await inspectRes.json();
  console.log("sheets:", JSON.stringify(inspectData.sheets?.map((s) => ({ name: s.name, rowCount: s.rowCount, colCount: s.colCount, previewRow2: s.preview[1] })), null, 2));

  const fd2 = new FormData();
  fd2.append("file", new Blob([fileBuf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "test-boq.xlsx");
  fd2.append("sheetName", "BOQ Mời thầu");
  fd2.append("startRow", "2");
  fd2.append("colStt", "1");
  fd2.append("colDesc", "3");
  fd2.append("colUnit", "4");
  fd2.append("colQty", "5");

  const parseRes = await fetch(`${BASE}/api/import/parse`, { method: "POST", headers: { cookie }, body: fd2 });
  console.log("parse status:", parseRes.status);
  const parseData = await parseRes.json();
  console.log("rows:", JSON.stringify(parseData.rows, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
