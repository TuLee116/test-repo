import { getUsers } from "@/lib/data";
import { PageHeader, Table } from "@/components/ui";

export default function UsersPage() {
  const { roles, users } = getUsers();
  const label = new Map(roles.map((r) => [r.value, r]));
  return (
    <>
      <PageHeader title="Người dùng & phân quyền trình giá" sub={`${users.length} người dùng`} />
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {roles.map((r) => (
          <span key={r.value} className="rounded bg-white px-2 py-0.5 ring-1 ring-slate-200" title={r.label}>
            <b>{r.short}</b> · {r.label}
          </span>
        ))}
      </div>
      <Table head={["Tên", "Đăng nhập", "Vai trò"]}>
        {users.map((u) => (
          <tr key={u.id}>
            <td className="font-medium">{u.name}</td>
            <td className="text-xs">{u.username}</td>
            <td className="flex flex-wrap gap-1">
              {u.roles.map((r) => (
                <span key={r} className="rounded bg-blue-50 px-1.5 text-xs text-blue-800 ring-1 ring-blue-200" title={label.get(r)?.label}>
                  {label.get(r)?.short ?? r}
                </span>
              ))}
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
