import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { clientIp } from "@/lib/login-limit";
import { checkPassword, otpEnabled, verifyOtp } from "@/lib/login-otp";

// Mã lỗi trả về trang đăng nhập (đọc ở src/app/login/actions.ts, câu báo ở loginErrorText trong src/lib/login-otp.ts)
class LoginError extends CredentialsSignin {
  constructor(code: string) {
    super();
    this.code = code;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  // chạy production trên máy nội bộ (http://localhost, http://<tên máy>:3210): tin địa chỉ trình duyệt gọi tới
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Tên đăng nhập", type: "text" },
        password: { label: "Mật khẩu", type: "password" },
        otpId: {},
        code: { label: "Mã đăng nhập", type: "text" },
      },
      authorize: async (credentials, request) => {
        const ip = clientIp(request?.headers);
        const str = (v: unknown) => (typeof v === "string" ? v : "");
        let r;
        if (otpEnabled()) {
          // đang bật đăng nhập 2 bước: CHỈ nhận mã OTP (mật khẩu đã kiểm ở bước 1 trong loginAction) —
          // gửi thẳng tên + mật khẩu vào đây (bỏ qua bước mã) sẽ bị từ chối
          const otpId = str(credentials?.otpId);
          const code = str(credentials?.code);
          if (!otpId || !code) return null;
          r = await verifyOtp(otpId, code, ip);
        } else {
          const username = str(credentials?.username);
          const password = str(credentials?.password);
          if (!username || !password) return null;
          r = await checkPassword(username, password, ip);
        }
        if (!r.ok) throw new LoginError(r.code);
        return { id: r.user.id, name: r.user.name, username: r.user.username, role: r.user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.username = user.username;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as string;
        session.user.username = token.username as string;
      }
      return session;
    },
  },
});
