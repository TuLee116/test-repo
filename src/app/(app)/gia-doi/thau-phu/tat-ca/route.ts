import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { canExportSub, getPriceUser, subAreaWhere } from "@/lib/gia-doi";
import { subWorkbook } from "@/lib/thau-phu-actions";

// XUẤT TẤT CẢ FILE ĐỀ XUẤT THẦU PHỤ (đã duyệt) trong khoảng thời gian / bộ lọc → 1 file ZIP.
// Mỗi hồ sơ = 1 file Excel đúng mẫu đề xuất (giống nút tải ở trang chi tiết). Thư mục: Khu vực → Dự án.
// Tên file: "Số HĐ CĐT - Hạng mục - Tên thầu phụ". Tham số giống file tổng hợp: ky=week|month|year|range, v | from,to, theo=trinh|duyet, kv, pj, ct.
const MAX = 200;
const DAY = 86400000;
const VN = 7 * 3600000;
const fd = (d: Date) => d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

function periodOf(ky: string, v: string, from?: string, to?: string): { from: Date; to: Date } | null {
  if (ky === "range") {
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from ?? "");
    const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to ?? "");
    if (!a || !b) return null;
    const f = new Date(Date.UTC(+a[1], +a[2] - 1, +a[3]) - VN);
    const t = new Date(Date.UTC(+b[1], +b[2] - 1, +b[3]) + DAY - VN);
    return t > f ? { from: f, to: t } : null;
  }
  if (ky === "week") {
    const m = /^(\d{4})-W(\d{1,2})$/.exec(v);
    if (!m) return null;
    const jan4 = Date.UTC(+m[1], 0, 4);
    const start = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + (+m[2] - 1) * 7 * DAY;
    return { from: new Date(start - VN), to: new Date(start + 7 * DAY - VN) };
  }
  if (ky === "year") {
    const m = /^(\d{4})$/.exec(v);
    return m ? { from: new Date(Date.UTC(+m[1], 0, 1) - VN), to: new Date(Date.UTC(+m[1] + 1, 0, 1) - VN) } : null;
  }
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  return m ? { from: new Date(Date.UTC(+m[1], +m[2] - 1, 1) - VN), to: new Date(Date.UTC(+m[1], +m[2], 1) - VN) } : null;
}

// bỏ ký tự cấm trong tên file / thư mục
const safe = (s: string, max = 60) => s.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-").replace(/\s+/g, " ").trim().slice(0, max).trim() || "-";
const csv = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function GET(req: Request) {
  const u = await getPriceUser();
  if (!u || !canExportSub(u)) return new Response("Không có quyền xuất file đề xuất thầu phụ", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const ky = ["week", "year", "range"].includes(sp.get("ky") ?? "") ? (sp.get("ky") as string) : "month";
  const p = periodOf(ky, sp.get("v") ?? "", sp.get("from") ?? "", sp.get("to") ?? "");
  if (!p) return new Response("Chọn tuần / tháng / năm / khoảng ngày cần xuất", { status: 400 });
  const byTrinh = sp.get("theo") === "trinh";
  const kv = sp.get("kv") ?? "";
  if (kv && u.areas && !u.areas.includes(kv)) return new Response("Khu vực ngoài phạm vi làm việc của bạn", { status: 403 });
  const pj = (sp.get("pj") ?? "").trim().toLowerCase();
  const ct = sp.get("ct") ?? "";
  const ctWhere = ct.startsWith("c:") ? { contractId: ct.slice(2) } : ct.startsWith("t:") ? { contractId: null, cdtContract: ct.slice(2) } : {};
  const range = { gte: p.from, lt: p.to };

  const all = await prisma.subProposal.findMany({
    where: {
      AND: [
        subAreaWhere(u),
        { status: "APPROVED" },
        byTrinh ? { submittedAt: range } : { OR: [{ tpAt: range }, { ptgAt: range }] },
        kv ? { OR: [{ area: kv }, { contract: { area: kv } }] } : {},
        ctWhere,
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true, area: true, projectName: true, cdtContract: true, itemName: true, subName: true, selectedBidder: true, bidders: true, branch: true, tpAt: true, ptgAt: true, contract: { select: { area: true, name: true, contractNo: true } } },
  });
  const list = all.filter((s) => {
    if (pj && ((s.contract?.name || s.projectName || "").trim() || "(chưa có tên dự án)").toLowerCase() !== pj) return false;
    if (byTrinh) return true;
    const at = s.branch === "A" ? s.tpAt : (s.ptgAt ?? s.tpAt);
    return !!at && at >= p.from && at < p.to;
  });
  if (!list.length) return new Response("Không có hồ sơ đã duyệt nào phù hợp bộ lọc.", { status: 404 });
  if (list.length > MAX) return new Response(`Có ${list.length} hồ sơ, vượt giới hạn ${MAX} hồ sơ mỗi lần. Hãy thu hẹp khoảng thời gian hoặc chọn thêm dự án / hợp đồng.`, { status: 400 });

  const zip = new JSZip();
  const used = new Set<string>();
  const index = ["STT,Mã hồ sơ,Khu vực,Dự án,Số HĐ CĐT,Hạng mục,Thầu phụ,Tên file"];
  let n = 0;
  for (const s of list) {
    const area = s.contract?.area || s.area || "";
    const proj = (s.contract?.name || s.projectName || "").trim() || "(chưa có tên dự án)";
    const hdNo = (s.cdtContract || s.contract?.contractNo || "").trim() || "chua co so HD";
    const bidderName = (() => { try { return (JSON.parse(s.bidders || "[]") as { key: string; name: string }[]).find((b) => b.key === s.selectedBidder)?.name; } catch { return ""; } })();
    const sub = (s.subName || bidderName || "").trim() || "chua co thau phu";
    const dir = `${area ? `Khu vuc ${safe(area, 20)}` : "Chua chon khu vuc"}/${safe(proj, 50)}`;
    let base = safe(`${hdNo} - ${s.itemName || "chua co hang muc"} - ${sub}`, 120);
    if (used.has(`${dir}/${base}`.toLowerCase())) base = `${base} (${safe(s.code, 30)})`; // trùng tên → thêm mã hồ sơ
    used.add(`${dir}/${base}`.toLowerCase());
    const path = `${dir}/${base}.xlsx`;
    zip.file(path, await subWorkbook(s.id));
    n++;
    index.push([n, s.code, area, proj, hdNo, s.itemName, sub, path].map((x) => csv(String(x ?? ""))).join(","));
  }
  zip.file("Muc luc.csv", "﻿" + index.join("\r\n"));
  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const tag = ky === "range" ? `${sp.get("from")} den ${sp.get("to")}` : (sp.get("v") ?? "");
  const name = `De xuat thau phu da duyet - ${tag} (${n} ho so) - xuat ${fd(new Date()).replace(/\//g, "-")}.zip`.replace(/[\\/:*?"<>|]/g, "-");
  return new Response(buf as unknown as BodyInit, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
  });
}
