import { prisma } from "@/lib/prisma";
import { getPriceUser, parsePriceRoles, PRICE_ROLES } from "@/lib/gia-doi";
import PriceRolesEditor from "./PriceRolesEditor";

export default async function GiaDoiPermissionsPage() {
  const u = (await getPriceUser())!;
  if (!u.isAdmin) return <p className="text-sm text-red-600">Chỉ quản trị được phân quyền.</p>;
  const users = await prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, username: true, priceRoles: true } });
  return (
    <PriceRolesEditor
      roles={PRICE_ROLES.map((r) => ({ value: r.value, label: r.label, short: r.short }))}
      users={users.map((x) => ({ id: x.id, name: x.name, username: x.username, roles: [...parsePriceRoles(x.priceRoles)] }))}
    />
  );
}
