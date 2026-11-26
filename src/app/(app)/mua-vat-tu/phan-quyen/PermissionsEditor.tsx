"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProjectMembersAction, setUserProcRolesAction } from "@/lib/proc-actions";

type Role = { value: string; label: string; short: string };
type U = { id: string; name: string; username: string; roles: string[] };
type P = { id: string; label: string; members: string[] };

// Quản trị gán vai trò mua vật tư cho từng tài khoản + thành viên Ban Chỉ Huy cho từng dự án
export default function PermissionsEditor({ roles, users, projects }: { roles: Role[]; users: U[]; projects: P[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editProject, setEditProject] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const siteUsers = users.filter((x) => x.roles.includes("GS") || x.roles.includes("CHT"));
  const nameOf = new Map(users.map((x) => [x.id, x.name]));

  const toggleRole = (x: U, role: string, on: boolean) =>
    start(async () => {
      const r = await setUserProcRolesAction(x.id, on ? [...x.roles, role] : x.roles.filter((y) => y !== role));
      if (!r.ok) return window.alert(r.error);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium text-slate-900">Vai trò của từng người</h2>
        <p className="mb-3 text-xs text-slate-500">
          Một người có thể giữ nhiều vai trò. Người chỉ có vai trò Giám sát / CHT sẽ chỉ thấy các dự án mình thuộc Ban Chỉ Huy (gán ở bảng dưới). Tài khoản mới tạo ở menu <b>Người dùng</b>.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">Người dùng</th>
                {roles.map((r) => (
                  <th key={r.value} className="px-2 py-2 text-center" title={r.label}>
                    {r.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((x) => (
                <tr key={x.id} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">
                    {x.name} <span className="text-xs text-slate-400">({x.username})</span>
                  </td>
                  {roles.map((r) => (
                    <td key={r.value} className="px-2 py-1.5 text-center">
                      <input type="checkbox" disabled={pending} checked={x.roles.includes(r.value)} onChange={(e) => toggleRole(x, r.value, e.target.checked)} className="h-4 w-4" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 grid gap-x-6 text-xs text-slate-500 sm:grid-cols-2">
          {roles.map((r) => (
            <li key={r.value}>
              <b>{r.short}</b>: {r.label}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium text-slate-900">Ban Chỉ Huy từng dự án</h2>
        <p className="mb-3 text-xs text-slate-500">Chọn giám sát / chỉ huy trưởng phụ trách mỗi dự án (chỉ hiện người đã có vai trò Giám sát hoặc CHT).</p>
        <table className="w-full text-sm">
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 align-top">
                <td className="w-1/3 px-2 py-2 font-medium text-slate-800">{p.label}</td>
                <td className="px-2 py-2">
                  {editProject === p.id ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-3">
                        {siteUsers.map((x) => (
                          <label key={x.id} className="flex items-center gap-1">
                            <input type="checkbox" checked={draft.includes(x.id)} onChange={(e) => setDraft(e.target.checked ? [...draft, x.id] : draft.filter((y) => y !== x.id))} />
                            {x.name}
                          </label>
                        ))}
                        {siteUsers.length === 0 && <span className="text-slate-400">Chưa có ai mang vai trò Giám sát / CHT.</span>}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={pending}
                          className="rounded bg-slate-900 px-3 py-1 text-xs text-white"
                          onClick={() =>
                            start(async () => {
                              const r = await setProjectMembersAction(p.id, draft);
                              if (!r.ok) return window.alert(r.error);
                              setEditProject(null);
                              router.refresh();
                            })
                          }
                        >
                          Lưu
                        </button>
                        <button type="button" className="rounded border border-slate-300 px-3 py-1 text-xs" onClick={() => setEditProject(null)}>
                          Huỷ
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="text-slate-600">{p.members.map((m) => nameOf.get(m)).filter(Boolean).join(", ") || <span className="text-slate-400">chưa gán</span>}</span>
                  )}
                </td>
                <td className="w-16 px-2 py-2 text-right">
                  {editProject !== p.id && (
                    <button
                      type="button"
                      className="text-xs text-sky-700 hover:underline"
                      onClick={() => {
                        setEditProject(p.id);
                        setDraft(p.members);
                      }}
                    >
                      Sửa
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
