// Tài khoản chưa được tick chương trình nào
export default function NoProgramPage() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      Tài khoản của bạn chưa được cấp quyền dùng chương trình nào. Nhờ quản trị vào <b>Người dùng → Sửa quyền</b> để tick các chương trình cần dùng.
    </div>
  );
}
