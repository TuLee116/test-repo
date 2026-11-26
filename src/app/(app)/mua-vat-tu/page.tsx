import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtMoney, getProcUser, payableTotals, projectScope } from "@/lib/proc";
import { getTaskCounts } from "@/lib/proc-tasks";
import { Section } from "./ui";

export default async function ProcDashboard() {
  const u = (await getProcUser())!;
  const t = await getTaskCounts(u);
  const scope = projectScope(u);

  // Quy trình 8 bước - số chứng từ đang nằm ở từng bước (toàn bộ dự án bạn được xem)
  const [reqSub, poDraft, poQuote, poPend, poAppr, poOrd, payOpen] = await Promise.all([
    prisma.materialRequest.count({ where: { status: "SUBMITTED", ...scope } }),
    prisma.purchaseOrder.count({ where: { status: "DRAFT", ...scope } }),
    prisma.purchaseOrder.count({ where: { status: "QUOTING", ...scope } }),
    prisma.purchaseOrder.count({ where: { status: "PENDING", ...scope } }),
    prisma.purchaseOrder.count({ where: { status: "APPROVED", ...scope } }),
    prisma.purchaseOrder.count({ where: { status: "ORDERED", ...scope } }),
    prisma.payable.findMany({ where: { status: { in: ["SENT", "PARTIAL"] }, ...scope }, include: { lines: true, payments: true } }),
  ]);
  const owed = payOpen.reduce((s, p) => s + payableTotals(p).remaining, 0);

  const steps = [
    { who: "Giám sát (BCH)", what: "Lập đề nghị mua theo đợt", n: null, href: "/mua-vat-tu/de-nghi" },
    { who: "Chỉ huy trưởng", what: "Duyệt đề nghị", n: reqSub, href: "/mua-vat-tu/de-nghi?status=SUBMITTED" },
    { who: "Cán bộ vật tư", what: "Lên đơn hàng", n: t.toOrder || poDraft, href: "/mua-vat-tu/don-hang" },
    { who: "Kế toán vật tư", what: "Báo giá NCC, bảng so sánh", n: poQuote, href: "/mua-vat-tu/don-hang?status=QUOTING" },
    { who: "PTGĐ thường trực", what: "Duyệt bảng so sánh", n: poPend, href: "/mua-vat-tu/don-hang?status=PENDING" },
    { who: "Cán bộ vật tư", what: "Đặt hàng", n: poAppr, href: "/mua-vat-tu/don-hang?status=APPROVED" },
    { who: "BCH", what: "Báo số lượng đã nhận", n: poOrd, href: "/mua-vat-tu/nhan-hang" },
    { who: "Cán bộ VT → Kế toán", what: "Lên công nợ, thanh toán NCC", n: payOpen.length, href: "/mua-vat-tu/cong-no" },
  ];

  const todo = [
    { n: t.reqToApprove, text: "phiếu đề nghị chờ bạn duyệt", href: "/mua-vat-tu/de-nghi?status=SUBMITTED" },
    { n: t.reqMine, text: "phiếu đề nghị của bạn đang nháp / bị trả lại", href: "/mua-vat-tu/de-nghi?mine=1" },
    { n: t.toOrder, text: "dòng vật tư đã duyệt chưa lên đơn hàng", href: "/mua-vat-tu/don-hang" },
    { n: t.poDraft, text: "đơn hàng đang lên, chưa chuyển kế toán vật tư", href: "/mua-vat-tu/don-hang?status=DRAFT" },
    { n: t.poQuoting, text: "đơn hàng cần lấy báo giá / lập bảng so sánh", href: "/mua-vat-tu/don-hang?status=QUOTING" },
    { n: t.poPending, text: "bảng so sánh chờ bạn duyệt", href: "/mua-vat-tu/don-hang?status=PENDING" },
    { n: t.poApproved, text: "đơn hàng đã duyệt, chờ đặt hàng", href: "/mua-vat-tu/don-hang?status=APPROVED" },
    { n: t.poOrdered, text: "đơn hàng đang chờ giao / báo nhận hàng", href: "/mua-vat-tu/nhan-hang" },
    { n: t.unbilled, text: "dòng hàng đã nhận chưa lên công nợ", href: "/mua-vat-tu/cong-no" },
    { n: t.paySent, text: "đề nghị thanh toán chờ kế toán chi", href: "/mua-vat-tu/cong-no?status=SENT" },
  ].filter((x) => x.n > 0);

  return (
    <div className="space-y-4">
      <Section title="Việc cần bạn xử lý">
        {todo.length === 0 ? (
          <p className="text-sm text-slate-500">✓ Không có việc nào đang chờ bạn.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {todo.map((x) => (
              <li key={x.text}>
                <Link href={x.href} className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100">
                  <span className="text-xl font-semibold">{x.n}</span>
                  <span>{x.text} →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Quy trình mua vật tư" right={<span className="text-xs text-slate-500">Số trên mỗi bước = chứng từ đang nằm ở bước đó</span>}>
        <ol className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {steps.map((s, i) => (
            <li key={i}>
              <Link href={s.href} className="block h-full rounded-md border border-slate-200 p-2.5 hover:border-sky-300 hover:bg-sky-50">
                <div className="flex items-center justify-between">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{i + 1}</span>
                  {s.n !== null && <span className={`text-lg font-semibold ${s.n ? "text-amber-700" : "text-slate-300"}`}>{s.n}</span>}
                </div>
                <p className="mt-2 text-xs font-medium text-slate-500">{s.who}</p>
                <p className="text-sm text-slate-800">{s.what}</p>
              </Link>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-slate-600">
          Công nợ nhà cung cấp còn phải trả (đã gửi kế toán): <b className="text-slate-900">{fmtMoney(owed)} đ</b>
        </p>
      </Section>
    </div>
  );
}
