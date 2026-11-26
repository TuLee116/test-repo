import ExcelSlimTool from "./ExcelSlimTool";

// Công cụ dùng chung mọi bộ phận: làm nhẹ file Excel trước khi tải lên phần mềm / gửi mail
export default function LamNheExcelPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">🗜 Làm nhẹ file Excel</h1>
        <p className="text-sm text-slate-500">
          File Excel nặng thường do <b>ảnh chụp dán vào</b> (mỗi ảnh vài MB) và rác tích tụ. Công cụ nén / xoá ảnh, dọn rác, gỡ liên kết ngoài — giữ nguyên công thức, định dạng và các sheet.
          File được xử lý <b>ngay trên máy của bạn</b>, không gửi lên máy chủ.
        </p>
      </div>
      <ExcelSlimTool />
    </div>
  );
}
