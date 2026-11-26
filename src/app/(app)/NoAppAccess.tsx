// Thông báo khi tài khoản chưa được tick chương trình này ở menu Người dùng
export default function NoAppAccess({ app }: { app: string }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      Tài khoản của bạn chưa được cấp quyền dùng chương trình <b>{app}</b>. Nhờ quản trị vào <b>Người dùng → Sửa quyền</b> để tick chương trình này.
    </div>
  );
}
