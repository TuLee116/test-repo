# Làm tiếp phần mềm ở máy khác (máy nhà)

Mã nguồn đồng bộ qua kho GitHub **riêng tư**. Dữ liệu (`dev.db`), file `.env` và ghi nhớ của Claude **không** nằm trên GitHub: chép tay bằng USB.

## A. Cài đặt lần đầu ở máy nhà (khoảng 30–60 phút)

1. Cài phần mềm:
   - **Node.js 24 LTS**: https://nodejs.org (máy công ty đang dùng v24.19.0)
   - **Git for Windows**: https://git-scm.com (cài mặc định, có sẵn Git Credential Manager để đăng nhập GitHub)
   - **Ứng dụng Claude** (desktop), đăng nhập cùng tài khoản đang dùng ở công ty
2. Tải mã nguồn về **đúng đường dẫn như máy công ty** (để Claude nhận ra cùng dự án):
   ```bat
   mkdir "D:\13. Phần Mềm"
   cd /d "D:\13. Phần Mềm"
   git clone <địa chỉ kho GitHub> dtcp-online
   ```
   Lần đầu Git mở cửa sổ đăng nhập GitHub: anh tự đăng nhập.
3. Chép từ máy công ty sang (USB), đặt vào `D:\13. Phần Mềm\dtcp-online\`:
   - file **`.env`**
   - file **`dev.db`** (dữ liệu, có giá / hợp đồng / tài khoản thật: giữ cẩn thận, không gửi qua mạng công cộng). Hoặc lấy bản sao lưu ở trang Người dùng → Sao lưu.
   - thư mục **`uploads`** (ảnh BOQ), nếu cần
4. Chép **ghi nhớ của Claude**:
   từ `C:\Users\nqdat\.claude\projects\D--13--Ph-n-M-m\memory\`
   sang cùng chỗ ở máy nhà: `C:\Users\<tên user máy nhà>\.claude\projects\D--13--Ph-n-M-m\memory\`
5. Cài thư viện và chuẩn bị:
   ```bat
   cd /d "D:\13. Phần Mềm\dtcp-online"
   npm install
   npx prisma migrate deploy
   npx prisma generate
   ```
6. Bấm đúp **`Bat-server-DTCP-dev.bat`**, rồi mở http://localhost:3210.
7. Mở app Claude → tab Code → chọn thư mục `D:\13. Phần Mềm\dtcp-online` để làm tiếp.

## B. Mỗi ngày làm việc (BẮT BUỘC, nếu không 2 máy sẽ lệch nhau)

- **Bắt đầu** (ở máy nào cũng vậy): bảo Claude *"tải bản mới từ GitHub"* (hoặc tự chạy `git pull`). Có migration mới thì chạy thêm `npx prisma migrate deploy` + `npx prisma generate`.
- **Trước khi rời máy**: bảo Claude *"commit và đẩy lên GitHub"*.
- Không sửa cùng lúc ở 2 máy.

## C. Lưu ý về dữ liệu

- Dữ liệu ở máy nhà và máy công ty là **2 bản riêng**: sửa dữ liệu (tạo hợp đồng, duyệt giá…) ở nhà không tự sang công ty. Chỉ **mã nguồn** được đồng bộ.
- Không bao giờ chép `dev.db` ở nhà đè lên máy công ty (máy công ty có dữ liệu đồng nghiệp đang dùng).
