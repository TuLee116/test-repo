// Tách danh sách người nhận mail như Outlook (dùng được cả ở client lẫn server).
// Nhận mọi kiểu dán từ Outlook / Gmail:
//   vinhdn@sungroup.com.vn
//   Vinh, Doan Ngoc (BQLDADN) <vinhdn@sungroup.com.vn>
//   Hung, Nguyen Phu (BQLDADN) <hungnp@sungroup.com.vn>; Thang, Do Cao (BQLDADN) <thangdc01@sungroup.com.vn>
//   "Vinh, Doan" <a@x.vn>, b@y.vn
// Ngăn cách bằng ; , xuống dòng hoặc khoảng trắng. Tên hiển thị (kể cả có dấu phẩy) bị bỏ, chỉ lấy ĐỊA CHỈ trong <...> hoặc địa chỉ trần.
const VALID = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export function parseEmails(s: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  // 1 lượt quét: nội dung trong <...> hoặc địa chỉ trần (có @) — tên hiển thị nằm ngoài <...> nên bị bỏ qua
  for (const m of s.matchAll(/<([^<>]*)>|([^\s<>;,"']+@[^\s<>;,"']*)/g)) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    if (!raw) continue;
    if (VALID.test(raw)) {
      const key = raw.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        ok.push(raw);
      }
    } else if (raw.includes("@") || m[1] !== undefined) bad.push(raw);
  }
  return { ok, bad };
}
