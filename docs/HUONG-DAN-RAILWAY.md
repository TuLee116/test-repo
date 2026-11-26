# Đưa DT-CP Online lên Railway (dùng thử 1 tuần)

## Đã chuẩn bị sẵn trong thư mục dự án
- `Dockerfile`: đóng gói phần mềm.
- `scripts/railway-start.sh`: lần đầu chạy sẽ tạo cơ sở dữ liệu từ bản mẫu, các lần sau giữ nguyên dữ liệu.
- `deploy/seed-data.sqlite3`: **bản chụp dữ liệu hiện tại của anh** (danh mục định mức, các dự án, tài khoản) — chỉ nạp **một lần** khi ổ đĩa còn trống.
- `scripts/reset-admin.mjs`: đặt lại mật khẩu admin theo biến `ADMIN_RESET_PASSWORD`.

## Các bước (làm trên máy anh)

### 1. Tạo tài khoản
Vào https://railway.com → đăng nhập bằng GitHub/email. Thêm thẻ thanh toán khi được yêu cầu (có thể có tín dụng dùng thử).

### 2. Cài công cụ Railway (một lần)
Mở **Command Prompt** (không dùng PowerShell để khỏi bị chặn script):
```
npm i -g @railway/cli
railway login
```

### 3. Tạo dự án và đẩy mã lên
Trong thư mục `D:\13. Phần Mềm\dtcp-online`:
```
railway init
railway up
```
(`railway init` đặt tên dự án; `railway up` tải mã lên và build, mất vài phút. Lần đầu có thể báo lỗi vì chưa có ổ đĩa/biến — làm bước 4 rồi `railway up` lại.)

### 4. Cài đặt trên trang web Railway
Mở dự án → bấm vào service:
1. **Volume** (ổ đĩa lưu cố định): chuột phải vào khung service → *Add Volume* → *Mount path* = `/data`. **Bắt buộc**, nếu không dữ liệu mất mỗi lần chạy lại.
2. **Variables** (thêm các biến):
   - `AUTH_SECRET` = chuỗi ngẫu nhiên dài. Tạo bằng lệnh: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - `ADMIN_RESET_PASSWORD` = mật khẩu admin anh muốn dùng (từ 8 ký tự trở lên)
3. **Settings → Networking → Generate Domain** → Railway cấp link dạng `https://xxxx.up.railway.app`.

Sau khi lưu biến, Railway tự chạy lại. Nếu chưa, bấm *Redeploy* (hoặc `railway up`).

### 5. Đăng nhập và tạo tài khoản cho mọi người
- Vào link, đăng nhập `admin` + mật khẩu đã đặt ở `ADMIN_RESET_PASSWORD`.
- **Xoá biến `ADMIN_RESET_PASSWORD`** trong Variables sau khi đăng nhập được (nếu để lại, mỗi lần khởi động mật khẩu admin bị đặt lại).
- Vào **Người dùng** tạo tài khoản cho từng người, phân quyền Chỉ xem hoặc Chỉnh sửa.

### 6. Kết thúc dùng thử
Xuất dữ liệu cần giữ (nút "Xuất Excel"), rồi xoá dự án trên Railway (Settings → Delete project) để ngừng tính tiền.

## Lưu ý
- Dữ liệu trên Railway tách khỏi máy anh: sửa trên máy anh không tự sang Railway và ngược lại.
- Cập nhật phần mềm: chạy lại `railway up` (dữ liệu trong ổ đĩa `/data` giữ nguyên, bản mẫu `deploy/seed-data.sqlite3` không nạp lại).
- Bản mẫu đang chứa các dự án thử trên máy anh. Nếu không muốn mang theo, xoá bớt dự án trước khi chạy `railway up`.
