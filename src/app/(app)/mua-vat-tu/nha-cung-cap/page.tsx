import { prisma } from "@/lib/prisma";
import { can, getProcUser } from "@/lib/proc";
import SupplierManager from "./SupplierManager";

export default async function SuppliersPage() {
  const u = (await getProcUser())!;
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { quotations: true } } } });
  return (
    <SupplierManager
      editable={can(u, "CBVT", "KTVT", "KT")}
      suppliers={suppliers.map(({ _count, ...s }) => ({ id: s.id, name: s.name, taxCode: s.taxCode, address: s.address, contact: s.contact, phone: s.phone, email: s.email, bankAccount: s.bankAccount, bankName: s.bankName, note: s.note, quotes: _count.quotations }))}
    />
  );
}
