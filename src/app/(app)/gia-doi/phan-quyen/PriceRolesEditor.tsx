"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setUserPriceRolesAction } from "@/lib/gia-doi-actions";

type Role = { value: string; label: string; short: string };
type U = { id: string; name: string; username: string; roles: string[] };

// Quản trị gán vai trò Đệ trình giá đội: QSTT và 3 Trưởng phòng (mỗi TP duyệt hồ sơ thuộc hạng mục của mình)
export default function PriceRolesEditor({ roles, users }: { roles: Role[]; users: U[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const toggle = (x: U, role: string, on: boolean) =>
    start(async () => {
      const r = await setUserPriceRolesAction(x.id, on ? [...x.roles, role] : x.roles.filter((y) => y !== role));
      if (!r.ok) return window.alert(r.error);
      router.refresh();
    });
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-medium text-slate-900">Vai trò của từng người</h2>
      <p className="mb-3 text-xs text-slate-500">
        Hồ sơ QSTT trình theo hạng mục nào sẽ đến đúng Trưởng phòng của hạng mục đó. Một người có thể giữ nhiều vai trò. Tài khoản mới tạo ở menu <b>Người dùng</b>.
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
                    <input type="checkbox" disabled={pending} checked={x.roles.includes(r.value)} onChange={(e) => toggle(x, r.value, e.target.checked)} className="h-4 w-4" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-0.5 text-xs text-slate-500">
        {roles.map((r) => (
          <li key={r.value}>
            <b>{r.short}</b>: {r.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
