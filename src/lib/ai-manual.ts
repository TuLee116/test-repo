// SỔ TAY cho Trợ lý AI: nguồn kiến thức DUY NHẤT để trợ lý trả lời "cách dùng". Bổ sung / sửa khi phần mềm đổi.
// Ghi ngắn, đúng thật; chỗ nào chưa chắc thì KHÔNG ghi (trợ lý sẽ báo "chưa có hướng dẫn" và chuyển sang lập phiếu yêu cầu).
export const MANUAL = `
# 1. CHUNG
- Phần mềm "Triển Khai Kiểm Soát DT-CP Giai Đoạn Thi Công" của Khối Kinh Tế Kế Hoạch, Công ty CP XD Kiến trúc Tân Minh Nhân. Menu dọc bên trái chia theo cụm công việc: DT-CP, Kế toán vật tư, QS Thanh toán, QS Đấu thầu, Quản trị. Mỗi người chỉ thấy cụm / chức năng mình được cấp quyền.
- Quyền do QUẢN TRỊ gán ở "Người dùng & chương trình được dùng" và "Phân quyền trình giá". Thấy thiếu menu / nút → thường do chưa được gán vai trò hoặc khu vực → báo quản trị, không tự sửa được.
- Khu vực làm việc (1,2,3...) cũng do quản trị gán; người bị giới hạn khu vực chỉ thấy hồ sơ / hợp đồng của khu vực đó.
- Chuông 🔔 trên cùng bên phải = "Việc của tôi": các việc đang chờ bạn xử lý (duyệt, kiểm tra, soạn mail...). Bấm vào việc để mở thẳng hồ sơ. Sau khi đăng nhập có hộp nhắc 1 lần.
- Ô nhập số liệu thao tác như Excel: chọn ô, kéo chọn vùng, Shift+bấm, Ctrl+C / Ctrl+V (dán nhiều ô), Delete xoá, Ctrl+Z / Ctrl+Y hoàn tác, gõ "=" để nhập công thức (bấm ô khác để chèn địa chỉ). Bảng trình giá có số dòng 1,2,3... ở đầu mỗi dòng để dùng trong công thức.
- Ctrl+F trong phân hệ Đệ trình giá: tìm chữ ngay trên trang (không dấu cũng tìm được).
- Dấu phẩy là dấu thập phân (1,05); khối lượng hiển thị 2 số lẻ.
- Cửa sổ làm việc toàn màn hình: khi mở một việc (kiểm tra, duyệt...) màn hình che kín menu để tập trung; nút "✕ Về màn hình chính" hỏi Lưu nháp / Thoát / Ở lại nếu có thay đổi chưa lưu.

# 2. ĐỆ TRÌNH GIÁ ĐỘI (menu QS Thanh toán → Trình giá đội)
Quy trình: BCH công trình gửi file Excel "ĐỀ XUẤT ĐƠN GIÁ TỔ ĐỘI" cho QSTT (ngoài phần mềm) → QSTT tải file lên → QSTT kiểm tra, ghi chú, chọn hạng mục và TRÌNH Trưởng phòng → Trưởng phòng duyệt từng dòng (sửa đơn giá nếu cần) rồi Duyệt / Không duyệt → hồ sơ trả về QSTT → QSTT soạn mail kết quả.
- Vai trò: QSTT; 3 Trưởng phòng theo hạng mục: TP Kết cấu, TP Hoàn thiện Phú Quốc, TP Hoàn thiện các khu vực còn lại. Mỗi hồ sơ thuộc 1 hạng mục, QSTT chọn khi trình và hồ sơ đi thẳng tới Trưởng phòng đó.
- Có 2 mẫu: "Đơn giá đội trình duyệt (trong HĐ)" và "Đề xuất đơn giá ngoài HĐ, phụ lục". Phần mềm tự nhận mẫu theo file.
- Tải file: trang Trình giá đội → khung tải file → chọn file Excel. Phần mềm đọc theo chữ tiêu đề, bỏ qua dòng/cột/sheet ẩn, giữ công thức Excel của file. Thiếu thông tin thì ô đỏ — QSTT bổ sung mới trình được.
- QSTT sửa được mọi dòng/cột khi hồ sơ còn ở trạng thái nháp: thêm / xoá dòng, xoá đầu mục lớn (nút ✕ ở ô STT), sửa thành tiền / tổng bằng công thức. Khi Trưởng phòng duyệt xong thì khoá.
- Chọn HỢP ĐỒNG (DT-CP) cho hồ sơ: phần mềm tự khớp từng dòng với sheet "TH Nhân Công" của hợp đồng để lấy "Giá cơ sở" (đơn giá kiểm soát). Nút "Tự khớp các dòng chưa khớp". Cột Ghi chú giá cơ sở tự ghi "Đã khớp / Chưa khớp / Ngoài DT-CP" và cảnh báo vượt. Dòng vượt đơn giá hoặc khối lượng DT-CP bắt buộc QSTT ghi lý do ở cột "Ghi chú QSTT / Lý do vượt DT-CP" mới trình được.
- Hợp đồng chưa có DT-CP: chọn "⏳ Chưa có DT-CP — bổ sung sau" vẫn trình / duyệt được; sau khi duyệt, hồ sơ nằm trong việc "Bổ sung DT-CP" của QSTT cho tới khi chọn hợp đồng.
- Trưởng phòng: mở hồ sơ từ chuông / "Việc của tôi" → tick ✓/✕ từng dòng, sửa "Đơn giá đề xuất lại", ghi chú → "✓ Duyệt hồ sơ" hoặc "✕ Không duyệt" (bắt buộc ghi lý do ở ô Ý kiến Trưởng phòng).
- ĐIỀU CHỈNH GIÁ SAU DUYỆT: Trưởng phòng đúng hạng mục mở hồ sơ ĐÃ DUYỆT → nút "✎ Điều chỉnh giá sau duyệt" → sửa → "✓ Lưu điều chỉnh". Không cần lý do, có ghi lịch sử, sổ giá cập nhật theo giá mới, hồ sơ quay lại việc "Soạn mail" của QSTT để gửi lại. Không điều chỉnh được nếu hồ sơ đã được trình lại.
- Sau duyệt, QSTT: "↻ Trình lại (lần N+1)" khi công trường đổi đội / cần chỉnh giá (hồ sơ cũ giữ làm lịch sử, tạo hồ sơ mới); "Soạn mail Outlook": nhập người nhận (dán kiểu Outlook "Tên <địa chỉ>; ..." được), CC, ghi chú → tải thư nháp .eml có đính kèm PDF hồ sơ duyệt → mở bằng Outlook (bản Outlook classic) rồi bấm Send. Chữ ký: trong Outlook chọn Message → Signature → chọn chữ ký của mình (chèn đúng cuối thư).
- Tải Excel / PDF của từng hồ sơ: nút "⬇ Tải Excel", "📄 PDF" ở đầu hồ sơ. Dòng Trưởng phòng "Điều chỉnh" tô cam, "Không đồng ý" tô đỏ.
- Tìm hồ sơ: ô 🔎 "Tìm hồ sơ" ở đầu trang (mã hồ sơ, số hợp đồng, tên Trưởng phòng duyệt, người trình...; nhiều từ cách nhau dấu cách = khớp tất cả).
- Xuất Excel TỔNG HỢP theo tuần / tháng: khung "Tổng hợp" ở trang Trình giá đội (chọn kỳ, theo ngày trình hoặc ngày duyệt, khu vực) — 2 sheet "Theo DT-CP" và "Ngoài DT-CP".
- Lũy kế các đợt duyệt: tab trong trang hợp đồng (Hợp đồng & DT-CP → chọn hợp đồng) + tải Excel.
- Nhập hồ sơ giá đội cũ đã duyệt (để có lũy kế): nút "Nhập hồ sơ cũ" ở trang Trình giá đội (QSTT).

# 3. TRÌNH GIÁ THẦU PHỤ (menu QS Đấu thầu → Trình giá thầu phụ)
Quy trình: ① QSĐT lập hồ sơ (tải file "BẢNG ĐỀ XUẤT KÝ HỢP ĐỒNG THẦU PHỤ", đàm phán giá, so sánh với DT-CP) → chuyển ② QSTT kiểm tra & trình → ③ Trưởng phòng duyệt → ④ Phó Tổng (nhánh A xem để nắm, nhánh B phê duyệt) → ⑤ QSTT lên HĐ/PLHĐ + soạn mail. Không đạt thì trả về QSĐT bổ sung / sửa rồi trình lại.
- Nhánh A: đơn giá ≤ giá cơ sở thời điểm 1 HOẶC giá trị ≤ 1 tỷ: Trưởng phòng duyệt là xong, Phó Tổng xem để nắm; giá hiệu lực khi Phó Tổng bấm "Đã xem" hoặc sau 24 giờ. Nhánh B (đơn giá mới / vượt giá cơ sở): Phó Tổng phải phê duyệt mới có hiệu lực. QSĐT chọn nhánh A/B ở đầu hồ sơ.
- Trưởng phòng: Đạt = Kết cấu, Mai = Hoàn thiện Phú Quốc, Tường = Hoàn thiện khu vực còn lại.
- Tải file: Trình giá thầu phụ → "Chọn file Excel" → bảng chọn đầu (HĐ thầu phụ mới / phụ lục, loại phụ lục cộng gộp / điều chỉnh, hình thức giao thầu, đơn giá giá tổng / chi tiết VT-NC-TB) → chọn sheet (nhiều sheet, mỗi sheet 1 hồ sơ) → chọn cột (phần mềm gợi ý, nhớ lựa chọn lần sau).
- Đầu hồ sơ bắt buộc: Khu vực, Dự án, Hợp đồng (chọn hợp đồng DT-CP / nhập số hợp đồng / đang trình HĐ / đang báo giá), Lần trình, Nhánh A/B, Loại đề xuất (HĐTP / Ký PL), Hình thức giao thầu (VT/TB/NC), số thầu phụ báo giá (nút chọn cột từng thầu phụ).
- Hình thức giao thầu: giao bao thiết bị → nhập tổng vật tư; nhân công thuần → nhập vật tư + thiết bị. Phụ lục phải gắn HĐ thầu phụ gốc.
- Mọi ô trong bảng hồ sơ sửa được như Excel; có thể thêm dòng chi phí dưới TỔNG CỘNG, thêm dòng thuế bổ sung (8% / 10%) bằng nút "＋ Bổ sung thuế".
- Trưởng phòng / Phó Tổng sửa trực tiếp đơn giá ở khối ĐỀ XUẤT (chữ xanh, giá trình gạch ngang), ghi "Ý kiến", rồi Duyệt / Không duyệt (bắt buộc lý do).
- ĐIỀU CHỈNH GIÁ SAU DUYỆT: nhánh A do Trưởng phòng, nhánh B do Phó Tổng: nút "✎ Điều chỉnh giá sau duyệt" trên hồ sơ đã duyệt. Không điều chỉnh được khi đã lên HĐ/PLHĐ hoặc đã trình lại.
- QSTT nhập SỐ HĐ/PLHĐ ở khung "Lên HĐ/PLHĐ"; chưa có số thì chưa soạn được mail.
- Xuất Excel tổng hợp thầu phụ tuần / tháng / năm: chỉ người được cấp quyền xuất.
- Tìm hồ sơ: ô 🔎 ở đầu trang (mã, số hợp đồng, tên Trưởng phòng / Phó Tổng, người tạo hồ sơ...).

# 4. HỢP ĐỒNG & DT-CP (menu QS Thanh toán → Hợp đồng & sổ giá; cây DT-CP bên trái)
- Mỗi hợp đồng gốc / mỗi phụ lục là 1 DT-CP riêng (kiểm soát riêng). Phụ lục: khi nhập DT-CP chọn "Phụ lục của một hợp đồng" rồi chọn hợp đồng gốc trong cùng khu vực.
- Nhập DT-CP cũ từ Excel (người có quyền): cần 6 sheet bắt buộc: DT-CP, BOQ (nhiều sheet được), CHI TIẾT, TH Vật Tư, TH Nhân Công, TH Thầu Phụ; TH Thiết Bị là tuỳ chọn. Phần mềm tự đoán sheet / cột / thời điểm; ô chọn nhớ lựa chọn. Nhập lại file = thêm thời điểm mới, giữ thời điểm cũ.
- Đơn giá kiểm soát = thời điểm được đánh dấu "Đã duyệt". Sổ giá duyệt theo từng đội, giá mới áp dụng từ ngày duyệt.
- Các tab DT-CP / BOQ / CHI TIẾT của DT-CP cũ chỉ xem; có nút Gộp ô / Tách ô / Xoá dòng và kéo giãn cột; "Đọc lại từ file gốc" ghi đè các chỉnh sửa tay.
- Đối chiếu sổ giá với DT-CP: tab "DC" ở trang hợp đồng; QSTT được "➕ Thêm vào DT-CP" các dòng phát sinh.
- DT-CP lập trên phần mềm: trình duyệt theo quy trình QSTT → chọn 1 Trưởng phòng duyệt → có hiệu lực → QSTT gửi công trình.

# 5. KẾ TOÁN VẬT TƯ (Mua vật tư) — tóm tắt
- Quy trình: Đề nghị vật tư (BCH) → duyệt → Đơn hàng & so sánh giá → Nhận hàng → Công nợ nhà cung cấp. Mỗi bước có vai trò riêng (giám sát, chỉ huy trưởng, cán bộ vật tư, kế toán vật tư, phó tổng giám đốc, kế toán). Việc chờ xử lý hiện ở chuông "Việc của tôi". Không có hướng dẫn chi tiết hơn trong sổ tay này.

# 6. CÔNG CỤ
- "🗜 Làm nhẹ file Excel" (menu Công cụ): nén file Excel quá nặng (ảnh nhúng...) trước khi tải lên.

# 7. SỰ CỐ THƯỜNG GẶP
- Không thấy menu / nút → thiếu vai trò hoặc khu vực → báo quản trị.
- File Excel tải lên báo lỗi / đọc sai cột → với thầu phụ và DT-CP cũ dùng bảng chọn cột; với giá đội kiểm tra đúng mẫu "ĐXĐGĐ 01/2020"; thử "Làm nhẹ file Excel" nếu file quá nặng.
- Khối lượng / đơn giá bị nhân 1000 do file lưu dạng văn bản "42,851" → sửa tay hoặc tải lại file đã sửa.
- Mở file .eml không ra cửa sổ soạn thư → dùng Outlook classic (Outlook bản mới có thể không hỗ trợ).
`;
