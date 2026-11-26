import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { lockedMinutes, recordFailure, recordSuccess } from "@/lib/login-limit";

// ĐĂNG NHẬP 2 BƯỚC: mật khẩu đúng → gửi mã 6 số về email công ty → nhập đúng mã mới vào được.
//
// Biến môi trường (đặt trên Railway → Variables):
//   LOGIN_EMAIL_DOMAIN  tên miền email công ty, VD "tanminhnhan.com.vn" — chỉ email đuôi này được nhận mã
//   MAIL_FROM           người gửi, VD "DT-CP Online <it@tanminhnhan.com.vn>"
//   BREVO_API_KEY       khoá API của Brevo (gửi mail qua HTTPS — Railway gói Hobby CHẶN cổng SMTP)
//   SMTP_URL            hoặc gửi qua SMTP, VD "smtps://user:pass@smtp.office365.com:465" (máy nội bộ / gói Railway Pro)
//   OTP_DEV_LOG=1       chỉ để thử trên máy: không gửi mail, in mã ra cửa sổ server
// Thiếu LOGIN_EMAIL_DOMAIN hoặc thiếu cách gửi mail → TẮT bước mã, đăng nhập bằng mật khẩu như cũ
// (để đẩy bản mới lên không khoá ai; nhập email cho mọi người xong mới đặt biến để bật).

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export function emailDomain(): string {
  return (process.env.LOGIN_EMAIL_DOMAIN || "").trim().toLowerCase().replace(/^@/, "");
}

function mailConfigured() {
  return !!(process.env.OTP_DEV_LOG === "1" || process.env.BREVO_API_KEY || process.env.SMTP_URL);
}

export function otpEnabled(): boolean {
  return !!emailDomain() && mailConfigured();
}

/** Email hợp lệ và đúng đuôi công ty (khi chưa đặt LOGIN_EMAIL_DOMAIN thì chỉ kiểm tra hợp lệ). */
export function emailAllowed(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  const d = emailDomain();
  return !d || e.endsWith("@" + d);
}

/** Email nhận mã: ô Email của tài khoản; để trống mà tên đăng nhập đã là email (VD "trinhdtt@tanminhnhan.com.vn") thì dùng luôn tên đăng nhập. */
export function userEmail(u: { email: string; username: string }): string {
  return (u.email || (u.username.includes("@") ? u.username : "")).trim().toLowerCase();
}

export function maskEmail(email: string): string {
  const [name, dom] = email.split("@");
  return (name.length <= 2 ? name[0] + "*" : name.slice(0, 2) + "*".repeat(Math.min(6, name.length - 2))) + "@" + dom;
}

type PwUser = { id: string; name: string; username: string; role: string; email: string };
type Result = { ok: true; user: PwUser } | { ok: false; code: string };

/** Bước 1: kiểm tra mật khẩu, có chống dò (src/lib/login-limit.ts). Mã lỗi: "locked:<phút>" / "bad:<số lần còn>". */
export async function checkPassword(username: string, password: string, ip: string): Promise<Result> {
  const wait = lockedMinutes(username, ip);
  if (wait > 0) return { ok: false, code: `locked:${wait}` };
  const user = await prisma.user.findUnique({ where: { username } });
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !valid) {
    const left = recordFailure(username, ip);
    return { ok: false, code: left > 0 ? `bad:${left}` : "locked:15" };
  }
  recordSuccess(username);
  return { ok: true, user };
}

const hashCode = (otpId: string, code: string) => crypto.createHash("sha256").update(otpId + ":" + code).digest("hex");

/** Tạo mã mới (huỷ mã cũ của người đó) và gửi về email. */
export async function issueOtp(user: PwUser): Promise<{ otpId: string }> {
  await prisma.loginOtp.deleteMany({ where: { OR: [{ userId: user.id }, { expiresAt: { lt: new Date() } }] } });
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const otp = await prisma.loginOtp.create({ data: { userId: user.id, codeHash: "", expiresAt: new Date(Date.now() + OTP_TTL_MS) } });
  await prisma.loginOtp.update({ where: { id: otp.id }, data: { codeHash: hashCode(otp.id, code) } });
  try {
    await sendMail(
      userEmail(user),
      `Mã đăng nhập DT-CP Online: ${code}`,
      `<p>Chào ${escapeHtml(user.name)},</p>
<p>Mã đăng nhập của bạn là:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
<p>Mã có hiệu lực trong 5 phút. Nếu bạn không đăng nhập, hãy bỏ qua thư này và báo cho quản trị hệ thống.</p>`,
    );
  } catch (e) {
    await prisma.loginOtp.delete({ where: { id: otp.id } }).catch(() => {});
    throw e;
  }
  return { otpId: otp.id };
}

/** Bước 2: kiểm tra mã. Mã lỗi: "otpbad:<số lần còn>" / "otpdead" (hết hạn hoặc sai quá 5 lần) / "locked:<phút>". */
export async function verifyOtp(otpId: string, code: string, ip: string): Promise<Result> {
  const otp = await prisma.loginOtp.findUnique({ where: { id: otpId }, include: { user: true } });
  if (!otp || otp.expiresAt < new Date() || otp.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, code: "otpdead" };
  const wait = lockedMinutes(otp.user.username, ip);
  if (wait > 0) return { ok: false, code: `locked:${wait}` };
  const a = Buffer.from(hashCode(otp.id, code.trim()));
  const b = Buffer.from(otp.codeHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const attempts = otp.attempts + 1;
    await prisma.loginOtp.update({ where: { id: otp.id }, data: { attempts } });
    const left = recordFailure(otp.user.username, ip);
    if (left === 0) return { ok: false, code: "locked:15" };
    return attempts >= OTP_MAX_ATTEMPTS ? { ok: false, code: "otpdead" } : { ok: false, code: `otpbad:${OTP_MAX_ATTEMPTS - attempts}` };
  }
  await prisma.loginOtp.delete({ where: { id: otp.id } });
  recordSuccess(otp.user.username);
  return { ok: true, user: otp.user };
}

/** Câu báo lỗi tiếng Việt cho các mã lỗi ở trên. */
export function loginErrorText(code: string): string {
  const [kind, n] = code.split(":");
  if (kind === "locked") return `Đăng nhập sai quá nhiều lần. Tài khoản tạm khoá, thử lại sau ${n} phút.`;
  if (kind === "bad") return `Sai tên đăng nhập hoặc mật khẩu. Còn ${n} lần thử trước khi bị tạm khoá 15 phút.`;
  if (kind === "otpbad") return `Mã không đúng. Còn ${n} lần thử.`;
  if (kind === "otpdead") return "Mã đã hết hạn hoặc nhập sai quá nhiều lần. Bấm \"Quay lại\" để nhận mã mới.";
  return "Sai tên đăng nhập hoặc mật khẩu.";
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].replace(/^"|"$/g, "") || "DT-CP Online", email: m[2] } : { name: "DT-CP Online", email: from.trim() };
}

async function sendMail(to: string, subject: string, html: string) {
  if (process.env.OTP_DEV_LOG === "1") {
    console.log(`[OTP thử nghiệm] gửi tới ${to}: ${subject}`);
    return;
  }
  const from = process.env.MAIL_FROM || "";
  if (!from) throw new Error("Chưa đặt MAIL_FROM");
  if (process.env.BREVO_API_KEY) {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: parseFrom(from), to: [{ email: to }], subject, htmlContent: html }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  const transport = nodemailer.createTransport(process.env.SMTP_URL!);
  await transport.sendMail({ from, to, subject, html });
}
