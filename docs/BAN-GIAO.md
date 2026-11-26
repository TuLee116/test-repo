# DT-CP Online — Tài liệu bàn giao cho bộ phận IT

Phần mềm nội bộ của Công ty Tân Minh Nhân (TMN) để lập **Dự toán – Chi phí (DT-CP)** cho các gói thầu xây dựng: nhập BOQ của chủ đầu tư, gán định mức, chiết tính đơn giá, tổng hợp vật tư / nhân công / thiết bị / thầu phụ, và lập bảng DT-CP (doanh thu – chi phí) xuất ra Excel có công thức thật.

- Đã chạy thử với người dùng thật trên Railway từ 10/10/2026: https://dtcp-online-production.up.railway.app
- Khoảng 21.000 dòng TypeScript, 40 migration cơ sở dữ liệu, 26 bảng.
- Chủ sở hữu nghiệp vụ: anh Nguyễn Quốc Đạt (TMN).

> Bàn giao gồm mã nguồn và bản sao lưu toàn bộ dữ liệu. **Không** gồm file `.env` (khoá bí mật, mật khẩu): IT tự tạo theo `.env.example`.

---

## 1. Công nghệ

| Thành phần | Dùng gì | Ghi chú |
|---|---|---|
| Web framework | **Next.js 16** (App Router, Turbopack, React 19, Server Components + Server Actions) | Next 16 có thay đổi so với các bản cũ — xem `node_modules/next/dist/docs/` trước khi sửa |
| Ngôn ngữ / giao diện | TypeScript, Tailwind CSS 4 | |
| Cơ sở dữ liệu | **SQLite** qua **Prisma 7** + driver adapter `@prisma/adapter-better-sqlite3` | Prisma Client sinh ra ở `src/generated/prisma` (không commit, chạy `prisma generate`) |
| Đăng nhập | NextAuth v5 (Credentials + JWT), mật khẩu bcrypt | Bảng `User`, 3 vai trò ADMIN / EDITOR / VIEWER |
| Excel | ExcelJS (đọc stream + xuất), JSZip (đọc ảnh trong xlsx) | |
| Ảnh | sharp (nén ảnh ≤ 1MB, ảnh thu nhỏ) | File ảnh nằm trên ổ đĩa, không trong DB |
| Đóng gói | Dockerfile (node:22-bookworm-slim) | Đang chạy trên Railway, có ổ đĩa bền `/data` |

Yêu cầu: Node.js 22 (tối thiểu 20.9), npm.

## 2. Cấu trúc thư mục

```
dtcp-online/
├─ prisma/
│  ├─ schema.prisma          mô hình dữ liệu (chú thích tiếng Việt từng bảng / cột)
│  ├─ migrations/            40 migration SQL (áp dụng bằng prisma migrate deploy)
│  ├─ seed.ts, seed-data/    nạp danh mục định mức + bảng giá gốc vào DB trống
├─ prisma7.config.ts         cấu hình Prisma CLI (đọc DATABASE_URL từ .env)
├─ src/
│  ├─ auth.ts, proxy.ts      đăng nhập (NextAuth) + chặn trang khi chưa đăng nhập (proxy = middleware của Next 16)
│  ├─ app/
│  │  ├─ login/              trang đăng nhập
│  │  ├─ (app)/projects/     danh sách dự án (Khu vực → Dự án → Gói thầu) và các sheet của 1 dự án
│  │  ├─ (app)/catalog/      danh mục định mức + bảng giá gốc
│  │  ├─ (app)/admin/        người dùng, sao lưu dữ liệu, duyệt định mức người dùng bổ sung
│  │  └─ api/                nhập Excel, xuất Excel, ảnh BOQ, sao lưu, tra cứu danh mục
│  ├─ lib/                   toàn bộ logic nghiệp vụ (xem mục 4)
│  └─ generated/prisma/      (sinh tự động, không sửa tay)
├─ scripts/                  script vận hành (nạp danh mục, định mức chuẩn, khởi động Railway, dọn ảnh...)
├─ data/source/              file Excel gốc "Dữ Liệu Chiết Tính" — nguồn danh mục định mức ban đầu
├─ Dockerfile, scripts/railway-start.sh   đóng gói & khởi động bản chạy thật
└─ docs/                     tài liệu (file này, hướng dẫn Railway)
```

## 3. Nghiệp vụ & các màn hình

### 3.1 Dự án
Mỗi **Project** là 1 gói thầu (tên dự án + tên gói thầu + khu vực + loại gói thầu: Thô / Hoàn thiện / Nội thất / MEP / Tổng thầu). Danh sách dự án gom theo **Khu vực → Dự án → Gói thầu**. Nhiều DT-CP có thể gom vào 1 **Hợp đồng** (`Contract`, DT-CP gốc + phụ lục).

Mỗi dự án có 8 sheet chuẩn (tab) + sheet bổ sung do người dùng tạo:

| Tab | Nội dung |
|---|---|
| **DT-CP** | Bảng Doanh thu (A) – Chi phí (B) dạng cây, tự thêm/bớt dòng; dòng lá lấy số từ "liên kết" (tổng BOQ, TH vật tư mục A/B, nhân công, thiết bị, thầu phụ, sheet tự do...) hoặc nhập tay / công thức. Có cột so sánh tự thêm. |
| **BOQ** | Bảng khối lượng mời thầu: STT, mô tả, **mã định mức**, ĐVT, khối lượng, đơn giá trực tiếp phí (tự tính), Dg0, **giá báo CĐT** (nhập), cột ảnh. Đầu mục nhiều cấp có Subtotal. Dòng "Tổng cộng trước thuế / VAT / sau thuế" nhận diện theo tên. Đầu mục không có dòng con có thể **liên kết giá** (theo % 1 đầu mục khác, hoặc lấy từ sheet tự do). |
| **CHI TIẾT** | Chiết tính từng công tác BOQ: các dòng hao phí (vật tư / nhân công / thiết bị) của định mức × khối lượng; đổi vật liệu cho riêng 1 dòng (spec CĐT); bổ sung / đề nghị xoá hao phí; giao thầu phụ toàn bộ hoặc 1 phần. |
| **TH Vật Tư** | Tổng hợp khối lượng vật tư; chia mục **A (mua từ Hợp Nhân) / B (đối tác khác)** và đầu mục lớn; đơn giá riêng dự án, VAT, hao hụt; công thức kiểu Excel trong ô. |
| **TH Nhân Công** | Tổng hợp nhân công; mục B "Nhân công khác" tự bổ sung (kể cả **vận chuyển vật tư** = % khối lượng vật tư). |
| **TH Thiết Bị** | Tương tự cho thiết bị. |
| **TH Thầu Phụ** | Công tác giao thầu phụ (lấy khối lượng từ BOQ, nhập đơn giá thầu phụ) + thầu phụ bổ sung; gom theo tên nhà thầu phụ. |
| **Thông tin dự án** | Tên, chủ đầu tư, địa điểm, tỷ lệ chi phí chung, thuế VAT, tỷ lệ nhân công khác / thiết bị / MMTB... |
| Sheet bổ sung | `kind = "BOQ"`: thêm 1 bảng khối lượng (VD BOQ hạng mục hoàn thiện) — đi vào CHI TIẾT như BOQ chính. `kind = "GRID"`: bảng tự do kiểu Excel (công thức, gộp ô, định dạng, đầu mục) — đầu mục / cột thành tiền có thể liên kết sang DT-CP hoặc BOQ. |

**Xuất Excel** (nút trên đầu dự án, `src/lib/excel-export.ts`): xuất mọi sheet, các ô tiền / tổng / liên kết là **công thức Excel thật** (SUBTOTAL, SUMIF, tham chiếu chéo sheet), ô nhập gốc chữ xanh, ảnh BOQ ở cột K.

### 3.2 Công thức tính chính

- **Đơn giá 1 công tác (chiết tính)** = Σ (định mức hao phí × đơn giá tài nguyên × (1 + hao hụt)), tách VL / NC / M (`src/lib/cost.ts`).
- **Đơn giá trực tiếp phí trên BOQ** = (VL + NC + M + NC × (tỷ lệ nhân công khác + tỷ lệ thiết bị)) × (1 + tỷ lệ MMTB & vật tư phụ), cộng phần giao thầu phụ 1 phần (giá trị phần giao ÷ khối lượng BOQ). Công tác giao thầu phụ trọn gói = đơn giá thầu phụ.
- **Dg0** = (Giá báo CĐT − Đơn giá trực tiếp phí) ÷ Đơn giá trực tiếp phí.
- **Đơn giá tài nguyên** = giá riêng của dự án (`ProjectResourcePrice`) nếu có, nếu không thì giá gốc (`Resource.unitPrice`).
- DT-CP: dòng cha = tổng dòng con; "Hợp đồng (sau VAT)" = tổng báo giá CĐT × (1 + VAT dự án).

### 3.3 Danh mục định mức (catalog)
- `WorkItem` (công tác / định mức, mã + tên + ĐVT) có nhiều `WorkItemResource` (dòng hao phí) tham chiếu `Resource` (bảng giá gốc vật tư / nhân công / thiết bị). Nguồn ban đầu: file `data/source/Du-Lieu-Chiet-Tinh.xlsx` (`npm run db:refresh`).
- **Định mức chuẩn phần thô** (`src/lib/rough-norms.ts`, `scripts/seed-rough-norms.ts`): bộ mã theo định mức nhà nước TT 38/2026/TT-BXD (bê tông theo mác, bơm cần / bơm ngang; ván khuôn phủ phim / nhôm; cốt thép theo cấu kiện – đường kính – chiều cao; xây gạch). Tiêu đề định mức nhà nước ở `src/data/state-norm-headings.json`.
- Người dùng thường (không phải admin) **tạo định mức mới / thêm hao phí / đề nghị xoá hao phí** → ghi vào `CatalogChange` (NORM / LINES / REMOVE) để admin **duyệt** ở trang *Duyệt định mức*.
- Admin có thể nhập định mức hàng loạt từ Excel (`api/import/norms-parse`).

### 3.4 Nhập BOQ từ Excel & tự khớp định mức
- Wizard **Nhập từ Excel** (`import/ImportWizard.tsx` → `api/import/parse`): chọn sheet, dòng bắt đầu, cột STT / mô tả / ĐVT / khối lượng; dòng không khối lượng + không ĐVT = đầu mục. Tùy chọn **nhập kèm hình ảnh** (ảnh nằm trên dòng nào gắn vào dòng đó).
- Wizard **Cập nhật BOQ** (`UpdateBoqWizard.tsx`, `src/lib/boq-diff.ts`): khi CĐT gửi BOQ sửa đổi — khớp từng dòng mới với dòng cũ theo mô tả để **giữ** mã định mức / giá / phương án đã gán, chỉ cập nhật khối lượng; dòng cũ không còn chỉ bị xoá khi người dùng xác nhận.
- **Bộ khớp định mức** (`src/lib/boq-match.ts`): ưu tiên *bí danh đã xác nhận* (`WorkItemAlias.confirmed` — học từ lựa chọn của người dùng) > *quy tắc phần thô* > bí danh cũ > khớp chữ y hệt > khớp gần đúng (tách đặc trưng: loại công tác, cấu kiện, mác, đường kính, vật liệu, hệ sơn bả / lót / phủ...). Cột "Mã định mức" trên BOQ hiện 💡 gợi ý và ⚠ cảnh báo mã lệch kèm lý do.

### 3.5 Nhân công theo công việc
Mỗi dự án có cờ `laborByWork` (đang bật cho mọi dự án): hao phí nhân công đặt tên theo **tên công việc BOQ rút gọn** (mỗi tên = 1 tài nguyên nhân công riêng của dự án) thay cho mã nhân công của định mức. Đồng bộ trong `src/lib/labor-sync.ts` (qua `BoqLineResourceSwap`); đổi tên ở TH Nhân Công.

### 3.6 Ảnh BOQ
Bảng `BoqImage` + file ảnh trên ổ đĩa (`src/lib/uploads.ts`): `UPLOAD_DIR`, hoặc `/data/uploads` nếu có `/data` (Railway), hoặc `./uploads`. Mỗi ảnh tự nén ≤ 1MB (sharp), ảnh thu nhỏ `*.thumb.jpg` tạo khi cần. Chỉ người đăng nhập mới xem được (`api/boq-images/[id]`). `scripts/sweep-orphan-images.ts` dọn file của dòng / dự án đã xoá (chạy lúc khởi động).

### 3.7 Phân quyền
- **ADMIN**: quản lý người dùng, sửa danh mục / bảng giá gốc, duyệt định mức, tải bản sao lưu.
- **EDITOR / VIEWER**: hiện **chỉ khác nhau trên giao diện tạo người dùng** — các server action mới kiểm tra *đã đăng nhập* (`requireUser`), chưa chặn VIEWER ghi dữ liệu. Xem mục 9.

## 4. Bản đồ mã nguồn (`src/lib`)

| File | Vai trò |
|---|---|
| `actions.ts` | **Toàn bộ Server Actions** (ghi dữ liệu). Quy ước: lỗi cần báo người dùng thì **trả về `{ ok, error }`**, không `throw` (bản production giấu nội dung lỗi, chỉ hiện mã #441). |
| `project-data.ts` | Tải 1 dự án đầy đủ (`getProjectWithBoq`) + danh mục cho ô chọn định mức |
| `cost.ts`, `boq-amounts.ts`, `boq-tree.ts` | Tính đơn giá, thành tiền, cây đầu mục BOQ, dòng tổng / VAT |
| `dtcp.ts`, `dtcp-layout.ts`, `sheet-links.ts`, `grid-links.ts` | Bảng DT-CP và các "liên kết" giữa sheet |
| `tonghop.ts`, `thauphu.ts`, `sub-portions.ts` | Sheet TH Vật Tư / Nhân Công / Thiết Bị, TH Thầu Phụ, giao thầu phụ 1 phần |
| `field-formulas.ts`, `formula.ts`, `grid-formula.ts` | Bộ tính công thức kiểu Excel (ô số các sheet TH, bảng tự do) |
| `grid-*.ts` | Bảng tự do (định dạng, gộp ô, đầu mục, STT tự động) |
| `boq-match.ts`, `rough-norms.ts`, `paint.ts`, `text-normalize.ts`, `unit-convert.ts` | Khớp định mức |
| `boq-diff.ts` | So khớp BOQ cũ / mới khi cập nhật |
| `labor-sync.ts`, `labor-names.ts` | Nhân công theo công việc BOQ |
| `excel-export.ts` | Xuất Excel có công thức |
| `uploads.ts`, `xlsx-images.ts` | Lưu / nén ảnh, đọc ảnh trong file xlsx |

Trang của 1 dự án: `src/app/(app)/projects/[id]/` (mỗi sheet 1 thư mục; component dùng chung để cùng cấp).

## 5. Cài đặt để phát triển

```bash
cd dtcp-online
npm ci
cp .env.example .env        # rồi điền AUTH_SECRET, SEED_ADMIN_PASSWORD
npx prisma generate --config prisma7.config.ts
```

Sau đó chọn **một** trong hai:

**a) Dùng dữ liệu thật đã bàn giao (khuyến nghị)** — xem mục 6.

**b) Tạo DB trống từ danh mục gốc**:
```bash
npx prisma migrate deploy --config prisma7.config.ts
npm run db:refresh                                   # nạp danh mục từ data/source/*.xlsx + tạo admin
npx tsx scripts/seed-rough-norms.ts                  # bộ định mức chuẩn phần thô (TT38/2026)
```

Chạy: `npm run dev` → http://localhost:3000

Kiểm tra trước khi giao bản mới: `npx tsc --noEmit` và `npm run lint` (có sẵn vài cảnh báo / lỗi lint cũ ở `excel-export.ts`, không ảnh hưởng chạy).

### Biến môi trường

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | có | `file:./dev.db` (máy) / `file:/data/prod.db` (Railway) |
| `AUTH_SECRET` | có | chuỗi ngẫu nhiên dài, ký JWT phiên đăng nhập. Tạo: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Đổi khoá = mọi người phải đăng nhập lại |
| `AUTH_TRUST_HOST` | khi chạy sau proxy / domain riêng | `true` |
| `UPLOAD_DIR` | không | thư mục lưu ảnh BOQ (mặc định như mục 3.6) |
| `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD` | khi seed DB trống | tạo admin đầu tiên (mật khẩu ≥ 8 ký tự) |
| `ADMIN_RESET_PASSWORD` (+ `ADMIN_RESET_USERNAME`) | chỉ khi cần | `scripts/reset-admin.mjs` đặt lại mật khẩu admin **mỗi lần khởi động** — đặt tạm, đăng nhập xong phải xoá |

## 6. Dữ liệu bàn giao & khôi phục

File `DTCP-saoluu-<ngày giờ>.zip` (tải từ nút **Người dùng → ⬇ Tải bản sao lưu**, chỉ admin) gồm:
- `database.db` — toàn bộ dữ liệu SQLite: dự án, BOQ, DT-CP, danh mục định mức, bí danh khớp, người dùng (mật khẩu đã băm bcrypt)...
- `uploads/<mã dự án>/*.jpg|png` — ảnh BOQ.

Khôi phục khi chạy trên máy:
```bash
# giải nén vào thư mục dtcp-online
cp database.db dev.db            # DATABASE_URL="file:./dev.db"
cp -r uploads ./uploads
npx prisma migrate deploy --config prisma7.config.ts   # an toàn: chỉ áp migration còn thiếu (nếu mã nguồn mới hơn dữ liệu)
npm run dev
```
Tài khoản & mật khẩu giữ nguyên như trên bản chạy thử. Admin quên mật khẩu → đặt `ADMIN_RESET_PASSWORD` rồi khởi động lại (xem bảng biến).

⚠ Bản sao lưu có **dữ liệu kinh doanh thật** — lưu ở nơi có kiểm soát truy cập.

## 7. Triển khai bản chạy thật

### Docker (mọi nơi chạy được container)
```bash
docker build -t dtcp-online .
docker run -d -p 3000:3000 -v /srv/dtcp-data:/data \
  -e AUTH_SECRET=... -e AUTH_TRUST_HOST=true dtcp-online
```
`scripts/railway-start.sh` khi khởi động: tạo DB nếu `/data/prod.db` chưa có → `prisma migrate deploy` → (1 lần, đánh dấu bằng file cờ trong `/data`) tạo định mức chuẩn phần thô, bật nhân công theo công việc → dọn ảnh mồ côi → đặt lại mật khẩu admin nếu có biến → `next start`. Để dùng dữ liệu bàn giao: chép `database.db` thành `/srv/dtcp-data/prod.db`, `uploads/` thành `/srv/dtcp-data/uploads/`, **và tạo sẵn 2 file cờ** `/srv/dtcp-data/.rough-norms-v2`, `/srv/dtcp-data/.labor-all-v1` (dữ liệu bàn giao đã chạy 2 bước này — không chạy lại).

### Railway (đang dùng cho chạy thử)
Xem `docs/HUONG-DAN-RAILWAY.md` (viết cho giai đoạn chạy thử). Dự án Railway `poetic-generosity`, service `dtcp-online`, volume `/data`, đẩy bản mới: `railway up --service dtcp-online`. Tài khoản Railway là của anh Đạt — IT nên chuyển sang hạ tầng công ty rồi huỷ dự án Railway.

### Không dùng Docker (VPS / Windows Server)
`npm ci && npx prisma generate --config prisma7.config.ts && npm run build`, rồi `npx prisma migrate deploy ...` và `npm start -- -p 3000` (dùng PM2 / NSSM / systemd giữ tiến trình). SQLite cần ổ đĩa cục bộ (không đặt DB trên ổ mạng).

### Sao lưu định kỳ
Nút tải bản sao lưu (thủ công), hoặc tự động: chép `prod.db` bằng `sqlite3 prod.db ".backup bak.db"` (hoặc `better-sqlite3` `db.backup()`) + thư mục `uploads/` theo lịch. **Không** chép thẳng file `.db` khi server đang ghi.

## 8. Lưu ý kỹ thuật quan trọng

- **Prisma Client sinh vào `src/generated/prisma`** (đã `.gitignore`). Sau khi sửa `schema.prisma`: tạo migration (`prisma migrate dev --config prisma7.config.ts`), `prisma generate`, và **khởi động lại dev server** (Turbopack không tự nhận thay đổi trong thư mục này).
- Luôn **sao lưu DB trước khi chạy migration / script sửa dữ liệu** trên dữ liệu thật. Script trong `scripts/` có thể sửa hàng loạt (VD `apply-rough-norms.ts`) — chạy thử bằng `--dry` / trên bản sao trước.
- Sau mỗi lần cập nhật phiên bản đang chạy, trình duyệt còn mở trang cũ có thể báo "Failed to find Server Action" → phần mềm đã có `StaleVersionGuard` hiện thông báo tải lại trang.
- `proxy.ts` (middleware) loại trừ `api/import/*` và `api/boq-images` để không bị giới hạn 10MB thân request; các route này **tự kiểm tra đăng nhập**. Thêm route API mới phải tự kiểm tra `auth()`.
- `next.config.ts`: `serverActions.bodySizeLimit = 50mb` (nhập định mức hàng loạt qua Server Action).
- Công thức người dùng gõ trong ô số: số thập phân dùng **dấu chấm** (12.5%), dấu phẩy sẽ ra `#VALUE!`.
- Ghi nhớ khớp định mức (`WorkItemAlias`) chỉ học từ **lựa chọn của người dùng**, không học mã phần mềm tự đoán.
- `npm run db:refresh` **ghi đè** danh mục từ Excel gốc — trên dữ liệu thật đã có định mức người dùng bổ sung / chuẩn phần thô thì **không nên chạy**.

## 9. Hướng tích hợp vào phần mềm chung của công ty

Chưa biết nền tảng phần mềm chung, nên có 3 hướng (từ dễ đến khó):

1. **Chạy như 1 phân hệ độc lập** (nhanh nhất): giữ nguyên ứng dụng, đặt dưới tên miền / đường dẫn của công ty (reverse proxy), nối menu từ phần mềm chung sang. Chỉ cần làm **đăng nhập dùng chung** (mục dưới).
2. **Ghép mã nguồn** (nếu phần mềm chung cũng là Next.js / React / Node): chuyển thư mục `src/app/(app)/projects`, `src/lib`, `prisma` vào; đổi sang DB và cơ chế đăng nhập chung.
3. **Viết lại trên nền tảng khác** (.NET / Java / PHP): dùng tài liệu này + `schema.prisma` (mô hình dữ liệu có chú thích) + `src/lib` (công thức) làm đặc tả; dữ liệu chuyển từ `database.db`.

**Đăng nhập dùng chung (SSO)**: `src/auth.ts` dùng NextAuth v5 — thêm provider OIDC / Azure AD / Keycloak / Google Workspace..., ánh xạ người dùng về bảng `User` (khoá theo `username` hoặc email) để giữ liên kết `Project.createdById`. Có thể bỏ Credentials sau khi chuyển xong.

**Đổi SQLite → PostgreSQL / SQL Server** (khi nhiều người ghi đồng thời, hoặc theo chuẩn công ty):
- `schema.prisma`: `provider = "postgresql"`; `src/lib/prisma.ts`: đổi adapter sang `@prisma/adapter-pg`.
- Tạo lại migration cho DB mới (thư mục `migrations/` hiện là SQL của SQLite); chuyển dữ liệu từ `database.db` (VD pgloader, hoặc script đọc / ghi qua Prisma).
- Sửa 2 chỗ dùng SQLite trực tiếp: `scripts/reset-admin.mjs`, `src/app/api/admin/backup/route.ts` (sao lưu).
- Ảnh BOQ: có thể chuyển sang lưu trữ đối tượng (S3 / MinIO / SharePoint) bằng cách thay các hàm trong `src/lib/uploads.ts`.

## 10. Hạn chế đã biết / việc nên làm tiếp

- **Phân quyền VIEWER chưa được thực thi ở server** (mục 3.7): cần thêm kiểm tra vai trò trong `requireUser()` / từng action ghi.
- Chưa có nhật ký thao tác (ai sửa gì, lúc nào) và lịch sử phiên bản đơn giá.
- Chưa có xuất PDF.
- SQLite phù hợp quy mô vài chục người dùng; đông hơn nên chuyển PostgreSQL.
- Chưa có bộ test tự động — logic tính toán đã được đối chiếu thủ công với file Excel mẫu và với file xuất (HyperFormula).
- Ảnh "Place in Cell" (Excel 365) khi nhập BOQ chưa được thử với file thật.
- Một số mã trong file Excel gốc có vấn đề dữ liệu (VD mã `AK.22123-1` dùng cho 2 công tác khác nhau) — chi tiết trong lịch sử README cũ / cần phòng dự toán xác nhận.

## 11. Bảo mật

- Không commit `.env`. `AUTH_SECRET` của bản chạy thử **phải thay mới** khi triển khai chính thức.
- Mật khẩu người dùng băm bcrypt; ứng dụng không có mật khẩu mặc định trong mã nguồn.
- Ảnh và bản sao lưu chỉ người đã đăng nhập / admin truy cập được.
- Nên đặt sau HTTPS (Railway đã có sẵn; tự host thì dùng reverse proxy có chứng chỉ).
