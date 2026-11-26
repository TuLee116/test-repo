import MailComposer from "nodemailer/lib/mail-composer";

// Soạn sẵn thư nháp (.eml) để mở bằng Outlook: trang web không thể tự mở Outlook kèm file đính kèm (mailto: không đính
// kèm được), nên phần mềm tạo file thư có sẵn người nhận / tiêu đề / nội dung / file đính kèm và header "X-Unsent: 1"
// → mở file bằng Outlook desktop sẽ hiện CỬA SỔ SOẠN THƯ (chưa gửi) để người dùng kiểm tra rồi tự bấm Send.
// Không ghi "From" → Outlook gửi bằng tài khoản mail đang đăng nhập trên máy người dùng.

// CHỮ KÝ: mỗi người đã có chữ ký công ty riêng trong cài đặt Outlook của máy mình → thư KHÔNG ghi sẵn tên / chức danh.
// Outlook không tự chèn chữ ký khi mở thư nháp .eml (đã thử trên Outlook thật), nhưng nếu thân thư có bookmark "_MailAutoSig"
// thì khi người dùng bấm Message → Signature → chọn chữ ký của mình, chữ ký được chèn đúng CUỐI thư (không nhảy lên đầu thư).
export const SIGNATURE_SLOT = '<p>&nbsp;</p><div id="Signature"><a name="_MailAutoSig"></a></div>';

export async function buildDraftEml(opts: {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}): Promise<Buffer> {
  const mail = new MailComposer({
    to: opts.to.join(", "),
    cc: opts.cc?.length ? opts.cc.join(", ") : undefined,
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments,
    headers: { "X-Unsent": "1" },
  });
  return new Promise((resolve, reject) => mail.compile().build((err, msg) => (err ? reject(err) : resolve(msg))));
}

// Tách danh sách người nhận (kiểu Outlook "Tên <địa chỉ>; ...") — xem email-list.ts
export { parseEmails } from "@/lib/email-list";
