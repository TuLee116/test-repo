"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NumInput from "../../../NumInput";
import { addQuotationAction, deleteQuotationAction, saveComparisonAction, submitOrderAction } from "@/lib/proc-actions";
import { confirmNear } from "@/app/(app)/confirm-near";
import { fmtQty } from "@/lib/fmt-qty";
import ExcelGrid, { xcell, type GridPaste } from "../../../ExcelGrid";

type Item = { id: string; name: string; spec: string; unit: string; quantity: number; selectedQuoteId: string | null };
type Quote = { id: string; supplierName: string; vatRate: number; deliveryTerms: string; paymentTerms: string; note: string; quoteDate: string; prices: Record<string, number> };

const fm = (n: number) => (n ? Math.round(n).toLocaleString("vi-VN") : "");
const fq = fmtQty;

// Bảng so sánh giá: mỗi NCC 1 cặp cột (đơn giá trước VAT | thành tiền), giá sau VAT thấp nhất mỗi dòng tô xanh,
// cột cuối chọn NCC cho từng dòng (có thể chia dòng cho nhiều NCC khác nhau trong cùng đơn).
export default function QuoteBoard({
  orderId,
  editable,
  canSubmit,
  items,
  quotes: initQuotes,
  suppliers,
}: {
  orderId: string;
  editable: boolean;
  canSubmit: boolean;
  items: Item[];
  quotes: Quote[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [quotes, setQuotes] = useState(initQuotes);
  const [sel, setSel] = useState<Record<string, string | null>>(Object.fromEntries(items.map((i) => [i.id, i.selectedQuoteId])));
  const [dirty, setDirty] = useState(false);
  const [addId, setAddId] = useState("");

  const setQ = (id: string, patch: Partial<Quote>) => {
    setQuotes((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
    setDirty(true);
  };
  const setPrice = (qid: string, itemId: string, v: number) => setQuotes((qs) => qs.map((q) => (q.id === qid ? { ...q, prices: { ...q.prices, [itemId]: v } } : q)));

  const cheapest = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) {
      let best: { id: string; v: number } | null = null;
      for (const q of quotes) {
        const p = q.prices[it.id] ?? 0;
        if (p > 0 && (!best || p * (1 + q.vatRate) < best.v)) best = { id: q.id, v: p * (1 + q.vatRate) };
      }
      if (best) m.set(it.id, best.id);
    }
    return m;
  }, [items, quotes]);

  const totals = quotes.map((q) => {
    const before = items.reduce((s, it) => s + it.quantity * (q.prices[it.id] ?? 0), 0);
    const missing = items.filter((it) => !(q.prices[it.id] > 0)).length;
    return { before, after: before * (1 + q.vatRate), missing };
  });
  const chosen = items.map((it) => {
    const q = quotes.find((x) => x.id === sel[it.id]);
    const p = q ? (q.prices[it.id] ?? 0) : 0;
    return { before: it.quantity * p, after: it.quantity * p * (1 + (q?.vatRate ?? 0)), q, ok: !!q && p > 0 };
  });
  const chosenTotal = chosen.reduce((s, c) => s + c.after, 0);
  const chosenBefore = chosen.reduce((s, c) => s + c.before, 0);

  const save = () =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const r = await saveComparisonAction(orderId, {
          quotes: quotes.map((q) => ({ id: q.id, vatRate: q.vatRate, deliveryTerms: q.deliveryTerms, paymentTerms: q.paymentTerms, note: q.note, quoteDate: q.quoteDate, prices: q.prices })),
          selections: sel,
        });
        if (!r.ok) window.alert(r.error);
        else {
          setDirty(false);
          router.refresh();
        }
        resolve(r.ok);
      }),
    );

  // Dán vùng copy từ Excel: cột = NCC (đơn giá), dòng = vật tư; dòng VAT / ngày / điều kiện ở chân bảng cũng dán được
  const pasteGrid = (cells: GridPaste[]) => {
    setQuotes((qs) =>
      qs.map((q) => {
        const cs = cells.filter((c) => c.col === q.id);
        if (!cs.length) return q;
        const x = { ...q, prices: { ...q.prices } };
        for (const c of cs) {
          if (c.row === "vat") x.vatRate = (c.num ?? 0) / 100;
          else if (c.row === "quoteDate" || c.row === "deliveryTerms" || c.row === "paymentTerms" || c.row === "note") x[c.row] = c.text;
          else if (c.num !== null) x.prices[c.row] = c.num;
        }
        return x;
      }),
    );
    setDirty(true);
  };

  const cell = "border border-slate-200 px-1.5 py-1";
  const inp = "w-full rounded border border-slate-300 px-1.5 py-0.5 text-xs";
  const used = new Set(quotes.map((q) => q.supplierName));

  return (
    <div className="space-y-3">
      {editable && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <select value={addId} onChange={(e) => setAddId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">— Thêm nhà cung cấp vào bảng so sánh —</option>
            {suppliers
              .filter((s) => !used.has(s.name))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={!addId || pending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            onClick={() =>
              start(async () => {
                if (dirty && !(await save())) return;
                const r = await addQuotationAction(orderId, addId);
                if (!r.ok) return window.alert(r.error);
                setAddId("");
                window.location.reload();
              })
            }
          >
            + Thêm
          </button>
          <a href="/mua-vat-tu/nha-cung-cap" className="text-xs text-sky-700 hover:underline">
            Quản lý danh sách NCC
          </a>
          <span className="flex-1" />
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
            onClick={() => {
              setSel(Object.fromEntries(items.map((i) => [i.id, cheapest.get(i.id) ?? null])));
              setDirty(true);
            }}
          >
            Chọn giá thấp nhất mọi dòng
          </button>
          <button type="button" disabled={pending} onClick={save} className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${dirty ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-700 hover:bg-slate-800"}`}>
            {pending ? "Đang lưu..." : dirty ? "Lưu bảng so sánh *" : "Lưu bảng so sánh"}
          </button>
          {canSubmit && (
            <button
              type="button"
              disabled={pending}
              className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              onClick={async () => {
                if (!(await confirmNear("Lưu và trình PTGĐ thường trực duyệt bảng so sánh này?"))) return;
                if (!(await save())) return;
                start(async () => {
                  const r = await submitOrderAction(orderId);
                  if (!r.ok) return window.alert(r.error);
                  router.refresh();
                });
              }}
            >
              Trình PTGĐ duyệt →
            </button>
          )}
        </div>
      )}
      {quotes.length === 0 ? (
        <p className="text-sm text-slate-400">Chưa có báo giá nhà cung cấp nào{editable ? " — chọn NCC ở trên để thêm cột báo giá." : "."}</p>
      ) : (
        <ExcelGrid className="overflow-x-auto" cols={quotes.map((q) => q.id)} onPaste={pasteGrid}>
          <table className="w-full border-collapse text-xs" onInput={() => setDirty(true)}>
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th rowSpan={2} className={cell}>
                  STT
                </th>
                <th rowSpan={2} className={`${cell} min-w-48 text-left`}>
                  Tên vật tư / quy cách
                </th>
                <th rowSpan={2} className={cell}>
                  ĐVT
                </th>
                <th rowSpan={2} className={cell}>
                  Số lượng
                </th>
                {quotes.map((q) => (
                  <th key={q.id} colSpan={2} className={`${cell} min-w-56`}>
                    <div className="flex items-center justify-center gap-1">
                      <span className="font-semibold text-slate-800">{q.supplierName}</span>
                      {editable && (
                        <button
                          type="button"
                          title="Bỏ NCC này khỏi bảng so sánh"
                          className="text-red-500 print:hidden"
                          onClick={async () =>
                            (await confirmNear(`Bỏ báo giá của ${q.supplierName}?`)) &&
                            start(async () => {
                              const r = await deleteQuotationAction(q.id);
                              if (!r.ok) return window.alert(r.error);
                              window.location.reload();
                            })
                          }
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                <th rowSpan={2} className={`${cell} min-w-44 bg-emerald-50`}>
                  NCC được chọn
                </th>
                <th rowSpan={2} className={`${cell} bg-emerald-50`}>
                  Thành tiền chọn (gồm VAT)
                </th>
              </tr>
              <tr>
                {quotes.map((q) => [
                  <th key={`${q.id}p`} className={cell}>
                    Đơn giá (chưa VAT)
                  </th>,
                  <th key={`${q.id}t`} className={cell}>
                    Thành tiền
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={it.id}>
                  <td className={`${cell} text-center`}>{idx + 1}</td>
                  <td className={cell}>
                    {it.name}
                    {it.spec && <span className="block text-slate-500">{it.spec}</span>}
                  </td>
                  <td className={`${cell} text-center`}>{it.unit}</td>
                  <td className={`${cell} text-right`}>{fq(it.quantity)}</td>
                  {quotes.map((q) => {
                    const p = q.prices[it.id] ?? 0;
                    const best = cheapest.get(it.id) === q.id;
                    const isSel = sel[it.id] === q.id;
                    return [
                      <td key={`${q.id}p`} {...xcell(it.id, q.id)} className={`${cell} text-right ${best ? "bg-emerald-50 font-semibold text-emerald-800" : ""} ${isSel ? "ring-2 ring-inset ring-emerald-600" : ""}`}>
                        {editable ? (
                          <NumInput
                            allowFormula
                            value={p || null}
                            className={`${inp} text-right`}
                            onCommit={(v) => {
                              setPrice(q.id, it.id, v ?? 0);
                              setDirty(true);
                            }}
                            onLive={(v) => setPrice(q.id, it.id, v)}
                          />
                        ) : (
                          fm(p)
                        )}
                      </td>,
                      <td key={`${q.id}t`} className={`${cell} text-right ${best ? "bg-emerald-50" : ""}`}>
                        {fm(p * it.quantity)}
                      </td>,
                    ];
                  })}
                  <td className={`${cell} bg-emerald-50/40`}>
                    {editable ? (
                      <select
                        className={inp}
                        value={sel[it.id] ?? ""}
                        onChange={(e) => {
                          setSel({ ...sel, [it.id]: e.target.value || null });
                          setDirty(true);
                        }}
                      >
                        <option value="">— chưa chọn —</option>
                        {quotes.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.supplierName}
                            {cheapest.get(it.id) === q.id ? " (thấp nhất)" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="font-medium">{chosen[idx].q?.supplierName ?? <span className="text-red-600">chưa chọn</span>}</span>
                    )}
                    {chosen[idx].q && cheapest.get(it.id) && cheapest.get(it.id) !== sel[it.id] && <span className="block text-amber-700">⚠ không phải giá thấp nhất</span>}
                  </td>
                  <td className={`${cell} bg-emerald-50/40 text-right font-medium`}>{chosen[idx].ok ? fm(chosen[idx].after) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr>
                <td colSpan={4} className={`${cell} text-right font-medium`}>
                  Cộng trước VAT
                </td>
                {quotes.map((q, k) => (
                  <td key={q.id} colSpan={2} className={`${cell} text-right font-medium`}>
                    {fm(totals[k].before)}
                    {totals[k].missing > 0 && <span className="block font-normal text-amber-700">thiếu giá {totals[k].missing} dòng</span>}
                  </td>
                ))}
                <td className={`${cell} bg-emerald-50 text-right`} colSpan={2}>
                  {fm(chosenBefore)}
                </td>
              </tr>
              <tr>
                <td colSpan={4} className={`${cell} text-right`}>
                  Thuế VAT (%)
                </td>
                {quotes.map((q) => (
                  <td key={q.id} colSpan={2} className={`${cell} text-right`} {...xcell("vat", q.id)}>
                    {editable ? (
                      <NumInput decimals allowFormula value={q.vatRate * 100 || null} placeholder="0" suffix="%" className={`${inp} text-right`} onCommit={(v) => setQ(q.id, { vatRate: (v ?? 0) / 100 })} />
                    ) : (
                      `${q.vatRate * 100}%`
                    )}
                  </td>
                ))}
                <td className={`${cell} bg-emerald-50 text-right`} colSpan={2}>
                  {fm(chosenTotal - chosenBefore)}
                </td>
              </tr>
              <tr>
                <td colSpan={4} className={`${cell} text-right font-semibold`}>
                  Tổng cộng sau VAT
                </td>
                {quotes.map((q, k) => (
                  <td key={q.id} colSpan={2} className={`${cell} text-right font-semibold`}>
                    {fm(totals[k].after)}
                  </td>
                ))}
                <td className={`${cell} bg-emerald-100 text-right text-sm font-bold`} colSpan={2}>
                  {fm(chosenTotal)}
                </td>
              </tr>
              {(
                [
                  ["quoteDate", "Ngày báo giá"],
                  ["deliveryTerms", "Thời gian / điều kiện giao hàng"],
                  ["paymentTerms", "Điều kiện thanh toán"],
                  ["note", "Ghi chú"],
                ] as const
              ).map(([k, label]) => (
                <tr key={k}>
                  <td colSpan={4} className={`${cell} text-right`}>
                    {label}
                  </td>
                  {quotes.map((q) => (
                    <td key={q.id} colSpan={2} className={cell} {...xcell(k, q.id)}>
                      {editable ? (
                        <input type={k === "quoteDate" ? "date" : "text"} className={inp} value={q[k]} onChange={(e) => setQ(q.id, { [k]: e.target.value })} />
                      ) : k === "quoteDate" && q[k] ? (
                        new Date(q[k]).toLocaleDateString("vi-VN")
                      ) : (
                        q[k]
                      )}
                    </td>
                  ))}
                  <td colSpan={2} className={`${cell} bg-emerald-50/40`} />
                </tr>
              ))}
            </tfoot>
          </table>
        </ExcelGrid>
      )}
      {editable && dirty && <p className="text-xs text-amber-700 print:hidden">* Có thay đổi chưa lưu.</p>}
    </div>
  );
}
