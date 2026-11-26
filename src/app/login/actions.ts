"use server";

import { headers } from "next/headers";
import { signIn } from "@/auth";
import { AuthError, CredentialsSignin } from "next-auth";
import { clientIp } from "@/lib/login-limit";
import { checkPassword, emailAllowed, emailDomain, issueOtp, loginErrorText, maskEmail, otpEnabled, userEmail } from "@/lib/login-otp";

export type LoginState = { error?: string; otp?: { otpId: string; email: string; username: string } } | undefined;

// Đăng nhập: khi bật 2 bước (src/lib/login-otp.ts) thì bước 1 kiểm mật khẩu + gửi mã về email, bước 2 nhập mã.
export async function loginAction(prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") || "");
  const password = String(formData.get("password") || "");
  const callbackUrl = String(formData.get("callbackUrl") || "/");
  const otpId = String(formData.get("otpId") || "");
  const code = String(formData.get("code") || "");

  // bước 1 của đăng nhập 2 bước
  if (otpEnabled() && !otpId) {
    const r = await checkPassword(username, password, clientIp(await headers()));
    if (!r.ok) return { error: loginErrorText(r.code) };
    const email = userEmail(r.user);
    if (!emailAllowed(email)) {
      return { error: `Tài khoản chưa có email @${emailDomain()} để nhận mã đăng nhập. Liên hệ quản trị hệ thống để cập nhật email.` };
    }
    try {
      const { otpId: id } = await issueOtp(r.user);
      return { otp: { otpId: id, email: maskEmail(email), username } };
    } catch (e) {
      console.error("[OTP] gửi mail lỗi:", e);
      return { error: "Không gửi được mã về email. Thử lại sau ít phút hoặc báo quản trị hệ thống." };
    }
  }

  try {
    if (otpId) await signIn("credentials", { otpId, code, redirectTo: callbackUrl });
    else await signIn("credentials", { username, password, redirectTo: callbackUrl });
    return {};
  } catch (err) {
    if (err instanceof CredentialsSignin) {
      const msg = loginErrorText(String(err.code || ""));
      // sai mã thì vẫn ở bước nhập mã
      return otpId && prev?.otp ? { error: msg, otp: prev.otp } : { error: msg };
    }
    if (err instanceof AuthError) {
      return otpId && prev?.otp ? { error: "Mã không đúng.", otp: prev.otp } : { error: "Sai tên đăng nhập hoặc mật khẩu." };
    }
    throw err;
  }
}
