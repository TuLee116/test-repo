import { prisma } from "@/lib/prisma";
import { getProcUser, parseRoles, PROC_ROLES } from "@/lib/proc";
import PermissionsEditor from "./PermissionsEditor";

export default async function ProcPermissionsPage() {
  const u = (await getProcUser())!;
  if (!u.isAdmin) return <p className="text-sm text-red-600">Chỉ quản trị được phân quyền.</p>;
  const [users, projects, members] = await Promise.all([
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, username: true, procRoles: true } }),
    prisma.project.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, packageName: true } }),
    prisma.procMember.findMany(),
  ]);
  return (
    <PermissionsEditor
      roles={PROC_ROLES.map((r) => ({ value: r.value, label: r.label, short: r.short }))}
      users={users.map((x) => ({ id: x.id, name: x.name, username: x.username, roles: [...parseRoles(x.procRoles)] }))}
      projects={projects.map((p) => ({ id: p.id, label: p.packageName ? `${p.name} — ${p.packageName}` : p.name, members: members.filter((m) => m.projectId === p.id).map((m) => m.userId) }))}
    />
  );
}
