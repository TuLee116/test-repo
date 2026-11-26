import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { emailAllowed, emailDomain, otpEnabled, userEmail } from "@/lib/login-otp";
import { deleteUserAction } from "@/lib/actions";
import { parseApps } from "@/lib/apps";
import { parseAreas, parseCodes, PERM_MODULES, type PermModule } from "@/lib/perms";
import ConfirmButton from "../../ConfirmButton";
import ResetPasswordButton from "./ResetPasswordButton";
import UserAccessForm from "./UserAccessForm";
import EditAccessButton from "./EditAccessButton";
import { lastStatus, listBackups } from "@/lib/db-backup";
import { backupNowAction } from "@/lib/db-backup-actions";

// nhãn ngắn cho bảng tóm tắt quyền
const SHORT: Record<string, Record<string, string>> = {
  dtcp: { VIEW: "Xem", EDIT: "Lập/điều chỉnh", QSTT: "QSTT kiểm tra", TP_KC: "TP ĐT Cấp 1 (Kết cấu)", TP_HTPQ: "TP ĐT Cấp 1 (Hoàn thiện)", TP_HTKV: "TP ĐT Cấp 2 (Hoàn thiện)", PTG: "Phó Tổng duyệt", NORM: "Định mức", NORM_REVIEW: "Duyệt định mức", PRICE: "Đơn giá gốc" },
  proc: { GS: "Giám sát", CHT: "CHT", CBVT: "Cán bộ VT", KTVT: "Kế toán VT", PTGD: "PTGĐ", KT: "Kế toán" },
  price: { QSTT: "QSTT", QSDT: "Nhập DT-CP HĐ", TP_KC: "TP ĐT Cấp 1 (Kết cấu)", TP_HTPQ: "TP ĐT Cấp 1 (Hoàn thiện)", TP_HTKV: "TP ĐT Cấp 2 (Hoàn thiện)", VIEW: "Xem" },
  sub: { QSDT: "QSĐT lập", QSTT: "QSTT trình", TP_KC: "TP ĐT Cấp 1 (Kết cấu)", TP_HTPQ: "TP ĐT Cấp 1 (Hoàn thiện)", TP_HTKV: "TP ĐT Cấp 2 (Hoàn thiện)", PTG: "Phó Tổng", VIEW: "Xem" },
};
const CHIP: Record<PermModule["key"], string> = { dtcp: "bg-sky-100 text-sky-800", proc: "bg-emerald-100 text-emerald-800", price: "bg-amber-100 text-amber-800", sub: "bg-violet-100 text-violet-800" };

export default async function UsersAdminPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/projects");
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const otpOn = otpEnabled();
  const domain = emailDomain();
  const noEmail = users.filter((u) => !emailAllowed(userEmail(u))).length;

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <h2 className="font-medium text-slate-900">Sao lưu dữ liệu</h2>
          <p className="mt-0.5 text-xs text-slate-500">Tải 1 file .zip gồm toàn bộ cơ sở dữ liệu (dự án, BOQ, định mức, người dùng) và ảnh BOQ. Có dữ liệu thật — bảo quản cẩn thận.</p>
        </div>
        <a href="/api/admin/backup" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          ⬇ Tải bản sao lưu
        </a>
        {/* SAO LƯU TỰ ĐỘNG 02:00 hằng ngày (src/lib/db-backup.ts) */}
        <div className="w-full border-t border-slate-100 pt-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-slate-900">Sao lưu tự động hằng ngày (02:00)</b>
            {(() => {
              const s = lastStatus();
              return s ? (
                <span className={`rounded-full px-2 py-0.5 text-xs ${s.ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>
                  Lần gần nhất {new Date(s.at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} ({s.reason}): {s.ok ? "thành công" : `lỗi — ${s.error}`}
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">chưa chạy lần nào</span>
              );
            })()}
            <form action={backupNowAction} className="ml-auto">
              <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">Sao lưu ngay</button>
            </form>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Giữ {Math.max(1, Number(process.env.BACKUP_KEEP) || 5)} bản mới nhất, nén .gz, nằm cùng ổ đĩa máy chủ (chống xoá nhầm / hỏng dữ liệu, không chống mất ổ đĩa) — nên tải 1 bản về máy mỗi tuần.
          </p>
          {listBackups().length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {listBackups().map((b) => (
                <li key={b.name} className="flex items-center gap-3">
                  <a href={`/api/admin/backup?file=${encodeURIComponent(b.name)}`} className="font-mono text-sky-700 hover:underline">
                    ⬇ {b.name}
                  </a>
                  <span className="text-slate-500">{(b.size / 1048576).toFixed(1)} MB</span>
                  <span className="text-slate-500">{b.at.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className={`rounded-lg border p-4 text-sm ${otpOn ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        <h2 className="font-medium">
          Đăng nhập 2 bước (mã gửi qua email): {otpOn ? "ĐANG BẬT" : "đang tắt"}
          {domain && <span className="font-normal"> — chỉ email @{domain}</span>}
        </h2>
        <p className="mt-1 text-xs">
          {otpOn
            ? "Mỗi lần đăng nhập: nhập mật khẩu → nhận mã 6 số qua email → nhập mã. Tài khoản chưa có email đúng đuôi sẽ KHÔNG đăng nhập được."
            : "Đang đăng nhập chỉ bằng mật khẩu. Nhập email công ty cho TẤT CẢ tài khoản (kể cả quản trị) trước, rồi báo người cài đặt bật trên server."}
          {noEmail > 0 && <b className="text-red-700"> Còn {noEmail} tài khoản chưa có email hợp lệ.</b>}
        </p>
      </section>
      <section>
        <h1 className="text-xl font-semibold text-slate-900">Người dùng & checklist quyền</h1>
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Tên / đăng nhập</th>
                <th className="px-3 py-2 font-medium">Chức danh</th>
                <th className="px-3 py-2 font-medium">Khu vực</th>
                {PERM_MODULES.map((m) => (
                  <th key={m.key} className="px-3 py-2 font-medium">
                    {m.title}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const remove = async () => {
                  "use server";
                  await deleteUserAction(u.id);
                };
                const apps = parseApps(u.apps);
                const val = {
                  dtcp: apps.has("DTCP") ? parseCodes(u.dtcpPerms, "dtcp") : [],
                  proc: apps.has("PROC") ? parseCodes(u.procRoles, "proc") : [],
                  price: apps.has("PRICE") ? parseCodes(u.priceRoles, "price") : [],
                  sub: apps.has("PRICE") ? parseCodes(u.subRoles, "sub") : [],
                };
                const areas = parseAreas(u.areas);
                const admin = u.role === "ADMIN";
                return (
                  <tr key={u.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <span className="text-slate-800">{u.name}</span>
                      <span className="block text-xs text-slate-500">{u.username}</span>
                      {emailAllowed(userEmail(u)) ? (
                        u.email && u.email !== u.username.toLowerCase() && <span className="block text-xs text-slate-500">✉ {u.email}</span>
                      ) : (
                        <span className="mt-0.5 inline-block rounded bg-red-50 px-1.5 text-xs text-red-700">{u.email ? `Email sai đuôi: ${u.email}` : "Chưa có email"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-700">{u.position || <span className="font-normal text-slate-400">—</span>}</td>
                    <td className="px-3 py-2 text-xs">{admin || !areas.length ? "Tất cả" : areas.map((a) => `KV ${a}`).join(", ")}</td>
                    {PERM_MODULES.map((m) => (
                      <td key={m.key} className="px-3 py-2">
                        {admin ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Quản trị</span>
                        ) : val[m.key].length ? (
                          val[m.key].map((c) => (
                            <span key={c} className={`mb-1 mr-1 inline-block rounded-full px-2 py-0.5 text-xs ${CHIP[m.key]}`}>
                              {SHORT[m.key][c] ?? c}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <span className="mr-4 inline-block">
                        <EditAccessButton userId={u.id} initial={{ name: u.name, position: u.position, email: u.email, isAdmin: admin, ...val, areas }} />
                      </span>
                      <span className="mr-4 inline-block">
                        <ResetPasswordButton userId={u.id} name={u.name} />
                      </span>
                      {u.id !== session.user.id && (
                        <form action={remove} className="inline-block">
                          <ConfirmButton className="text-xs text-red-500 hover:underline" message={`⚠ Bạn có chắc chắn muốn XOÁ tài khoản "${u.name}" không?`}>
                            Xoá
                          </ConfirmButton>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">Tạo người dùng mới</h2>
        <UserAccessForm userId={null} initial={{ name: "", position: "", email: "", isAdmin: false, dtcp: [], proc: [], price: [], sub: [], areas: [] }} />
      </section>
    </div>
  );
}
