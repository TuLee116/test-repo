# tmn-web — bản dựng lại Khối Kinh Tế Kế Hoạch (Tân Minh Nhân)

Next.js 15 (App Router) + Tailwind CSS 4. Dữ liệu lấy từ web cũ ngày 23/11/2026, nằm trong `data/` (JSON).
**Chứa dữ liệu nội bộ thật — không đưa lên kho mã công khai.**

## Chạy

```
npm install
npm run dev      # http://localhost:3000
```

Bản chạy thật: `npm run build && npm start`.

## Các trang đã có (chỉ xem)

| Trang | Nội dung |
|---|---|
| `/projects` | Tổng quan DT-CP: lọc theo khu vực / dự án / người thực hiện, doanh thu – chi phí theo khu vực, cơ cấu chi phí |
| `/projects/[id]` | Bảng DT-CP, BOQ, lịch sử duyệt |
| `/gia-doi`, `/gia-doi/[id]` | 411 hồ sơ giá đội: tìm kiếm, lọc trạng thái/loại, chi tiết từng dòng |
| `/gia-doi/thau-phu`, `/gia-doi/thau-phu/[id]` | 71 hồ sơ trình giá thầu phụ, giá các nhà thầu, điều khoản |
| `/gia-doi/hop-dong`, `/gia-doi/hop-dong/[id]` | 96 hợp đồng: sổ giá đội theo các thời điểm, hồ sơ giá đội liên quan |
| `/catalog` | 2.857 định mức, tìm theo mã/tên, xem hao phí |
| `/admin/users` | Người dùng và vai trò trình giá |

Menu bên trái giống bản cũ (DT-CP theo khu vực → dự án → hợp đồng). Các mục chưa dựng (mua vật tư, kiểm tra bill, duyệt định mức, làm nhẹ Excel…) hiện trang "chưa được dựng lại".

## Cấu trúc

- `lib/data.ts` — **toàn bộ việc đọc dữ liệu**, kèm kiểu TypeScript cho từng loại bản ghi. Khi chuyển sang cơ sở dữ liệu (ví dụ Prisma + PostgreSQL), chỉ cần thay các hàm trong file này.
- `lib/format.ts` — định dạng số kiểu Việt Nam, nhãn trạng thái.
- `components/` — menu, bảng, thẻ số liệu.
- `data/` — tạo bởi `tools/build_webdata.py` từ gói `dttt-package`.

## Chưa có

- Đăng nhập, phân quyền.
- Mọi thao tác tạo / sửa / duyệt / xoá, gửi mail, xuất Excel/PDF.
- Phân hệ Mua vật tư (dữ liệu cũ chỉ có 1 đơn hàng, 1 đề nghị).

## Bảo vệ bằng mật khẩu

`middleware.ts` yêu cầu đăng nhập (HTTP Basic) cho toàn bộ web. Đặt biến môi trường:

- `BASIC_AUTH_USER`
- `BASIC_AUTH_PASSWORD`

Khi chạy bản production mà chưa đặt hai biến này, web sẽ trả lỗi 503 thay vì để lộ dữ liệu. Khi chạy `npm run dev` mà không đặt thì không hỏi mật khẩu.

## Triển khai Railway

Railway tự nhận Next.js: build bằng `npm run build`, chạy bằng `npm start` (Next đọc biến `PORT`). Nhớ đặt hai biến mật khẩu ở trên trong mục Variables của service.
