import { prisma } from "@/lib/prisma";
import { getPriceUser, ownAreaWhere } from "@/lib/gia-doi";
import BillCheck from "./BillCheck";

// Kiểm tra Bill đội: QSTT chọn khu vực / dự án / hợp đồng, tải file Bill, phần mềm báo giá nào đã duyệt - lệch - chờ duyệt - chưa duyệt.
// Tính năng chỉ để kiểm nhanh: KHÔNG lưu file, KHÔNG lưu kết quả.
export default async function KiemTraBillPage() {
  const u = (await getPriceUser())!;
  const contracts = await prisma.costContract.findMany({
    where: ownAreaWhere(u),
    orderBy: [{ area: "asc" }, { name: "asc" }, { contractNo: "asc" }],
    select: { id: true, area: true, name: true, packageName: true, contractNo: true, appendixNo: true },
  });
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Kiểm tra Bill đội</h2>
        <p className="text-xs text-slate-500">
          Chọn hợp đồng, tải file Excel Bill, chọn cột <b>Nội dung / ĐVT / Đơn giá</b>. Phần mềm so từng dòng với giá đã duyệt và hồ sơ đã trình Trưởng phòng của hợp đồng. Chỉ để kiểm tra nhanh —{" "}
          <b>không lưu file, không lưu kết quả</b>.
        </p>
      </div>
      <BillCheck contracts={contracts} />
    </div>
  );
}
