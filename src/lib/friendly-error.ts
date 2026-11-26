// Đổi lỗi kỹ thuật thành câu tiếng Việt dễ hiểu cho người dùng (dùng được ở client và server)
export type Friendly = { title: string; hint: string; detail: string };

const MASKED = /omitted in production|Server Components render|An error occurred in the Server|unexpected response was received from the server/i;
export const isMasked = (msg: string) => !msg || MASKED.test(msg);

export function friendlyError(raw: unknown): Friendly {
  const msg = (raw instanceof Error ? raw.message : typeof raw === "string" ? raw : (raw as { message?: string })?.message) || "";
  const detail = msg.slice(0, 500);
  const size = msg.match(/Body exceeded (\S+) limit/i);
  if (size) return { title: "File / dữ liệu gửi lên quá lớn", hint: `Máy chủ chỉ nhận tối đa ${size[1].toUpperCase()} mỗi lần. Mở file bằng Excel, xoá ảnh / sheet không cần rồi "Lưu thành" file mới (thường chỉ vài MB) và tải lại.`, detail };
  if (/Unexpected end of form/i.test(msg))
    return { title: "File gửi lên bị cắt giữa chừng", hint: "File quá nặng hoặc mạng bị ngắt khi đang gửi. Thử lại; nếu file nặng, dùng mục \"🗜 Làm nhẹ file Excel\" trước rồi tải lên.", detail };
  if (/Failed to fetch|NetworkError|Load failed|network|ECONNREFUSED|fetch failed/i.test(msg))
    return { title: "Mất kết nối tới máy chủ", hint: "Kiểm tra mạng LAN / máy chủ (cửa sổ đen \"DT-CP Online - server cong 3210\" còn mở không) rồi tải lại trang.", detail };
  if (/Chưa đăng nhập|Unauthorized|session/i.test(msg)) return { title: "Phiên đăng nhập đã hết", hint: "Đăng nhập lại rồi làm tiếp.", detail };
  if (/quyền|permission|forbidden/i.test(msg)) return { title: "Bạn không có quyền làm việc này", hint: msg, detail: "" };
  if (/Failed to find Server Action|older or newer deployment/i.test(msg))
    return { title: "Phần mềm vừa được cập nhật", hint: "Bấm \"Tải lại trang\" để dùng bản mới rồi làm lại thao tác.", detail };
  if (/ChunkLoadError|Loading chunk/i.test(msg)) return { title: "Phần mềm vừa được cập nhật", hint: "Bấm \"Tải lại trang\" để dùng bản mới.", detail };
  if (isMasked(msg)) return { title: "Có lỗi ở máy chủ", hint: "Thử lại thao tác. Nếu vẫn lỗi, chụp màn hình này gửi quản trị (kèm mã lỗi).", detail };
  // lỗi do phần mềm tự báo (tiếng Việt) → hiện nguyên văn
  if (/[àáảãạăâđèéêìíòóôơùúưỳý]/i.test(msg)) return { title: "Không thực hiện được", hint: msg, detail: "" };
  return { title: "Có lỗi xảy ra", hint: "Thử lại thao tác. Nếu vẫn lỗi, chụp màn hình này gửi quản trị.", detail };
}

// Dung lượng file tối đa người dùng được tải lên (máy chủ nhận tối đa 50MB mỗi lần gửi, chừa phần dữ liệu kèm theo)
export const MAX_UPLOAD_MB = 45;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
