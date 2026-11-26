import { contractKey } from "@/lib/project-site-calc";
import type { DtcpTotals } from "@/lib/dtcp-summary";

// BẢNG TỔNG HỢP (trang thầu phụ / đội thi công): mỗi dòng = 1 HỢP ĐỒNG của 1 dự án; bảng tự gom Khu vực → Cụm → Dự án.
// Giá trị theo DT-CP lấy từ dtcp-summary (sau VAT, thời điểm kiểm soát); đã duyệt = tổng hồ sơ đã duyệt của hợp đồng.
export type SumRow = {
  key: string;
  area: string; // "1".."5"; "" = chưa chọn khu vực
  cluster: string;
  clusterName: string;
  siteKey: string;
  siteCode: string;
  siteName: string;
  sitePending: boolean; // dự án chưa gắn mã / chờ xác nhận
  contractCode: string; // mã hợp đồng theo BẢNG TT DỰ ÁN
  contractNo: string; // "" = hồ sơ chưa ghi số hợp đồng
  contractTitle: string; // nội dung hợp đồng theo BẢNG TT DỰ ÁN
  packageName: string; // tên gói thầu (DT-CP)
  hasDtcp: boolean; // đã có DT-CP (hợp đồng) trên phần mềm
  revenue: number | null; // giá trị hợp đồng theo DT-CP
  dtcp: number | null; // giá trị thầu phụ / đội theo DT-CP
  dtcpSrc: "DTCP" | "TH" | "";
  approved: number; // giá trị đã duyệt
  n: number; // số hồ sơ
  waiting: number; // hồ sơ đang xử lý
  last: number; // ngày mới nhất (ms)
};

export type SumItem = {
  area: string;
  site: { id: string; code: string; name: string; status: string; cluster: string; clusterName: string } | null;
  projectName: string;
  contract: { id: string; contractNo: string; appendixNo: string; packageName: string } | null;
  typedNo: string; // số HĐ gõ trên hồ sơ (chưa gắn DT-CP)
  approved: boolean;
  waiting: boolean;
  value: number; // giá trị đã duyệt của hồ sơ (chỉ tính khi approved)
  at: number;
};

export function buildSumRows<T extends SumItem>(items: T[], totals: Map<string, DtcpTotals>, kind: "tp" | "nc", info: Map<string, { code: string; title: string }>) {
  const rows = new Map<string, SumRow>();
  const members = new Map<string, T[]>();
  for (const it of items) {
    const siteKey = it.site ? `s:${it.site.id}` : `n:${(it.projectName || "").trim().toLowerCase()}`;
    const cKey = it.contract ? `c:${it.contract.id}` : it.typedNo ? `t:${it.typedNo.trim()}` : "-";
    const key = `${it.area}|${siteKey}|${cKey}`;
    let r = rows.get(key);
    if (!r) {
      const no = it.contract ? it.contract.contractNo : it.typedNo.trim();
      const ci = info.get(contractKey(no));
      const t = it.contract ? totals.get(it.contract.id) : undefined;
      r = {
        key,
        area: it.area,
        cluster: it.site?.cluster ?? "",
        clusterName: it.site?.clusterName ?? "",
        siteKey,
        siteCode: it.site?.code ?? "",
        siteName: it.site?.name || it.projectName.trim() || "(chưa có tên dự án)",
        sitePending: !it.site?.code || it.site.status === "PENDING",
        contractCode: ci?.code ?? "",
        contractNo: no ? `${no}${it.contract?.appendixNo ? ` — ${it.contract.appendixNo}` : ""}` : "",
        contractTitle: ci?.title ?? "",
        packageName: it.contract?.packageName ?? "",
        hasDtcp: !!it.contract,
        revenue: t?.revenue ?? null,
        dtcp: t ? t[kind] : null,
        dtcpSrc: t ? (kind === "tp" ? t.tpSrc : t.ncSrc) : "",
        approved: 0,
        n: 0,
        waiting: 0,
        last: 0,
      };
      rows.set(key, r);
      members.set(key, []);
    }
    r.n++;
    if (it.waiting) r.waiting++;
    if (it.approved) r.approved += it.value;
    r.last = Math.max(r.last, it.at);
    members.get(key)!.push(it);
  }
  return { rows: [...rows.values()], members };
}
