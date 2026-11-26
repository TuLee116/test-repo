"use client";

import { useState } from "react";
import ResourcePriceRow from "../../catalog/ResourcePriceRow";

export type LineDetail = {
  category: "VT" | "TB" | "NC";
  quantity: number;
  wastageRate: number;
  resource: { id: string; code: string; name: string; unit: string; unitPrice: number };
};

const CAT_LABEL: Record<string, string> = { VT: "Vật liệu", TB: "Máy TC", NC: "Nhân công" };

function amountOf(l: LineDetail) {
  return l.quantity * l.resource.unitPrice * (1 + (l.wastageRate || 0));
}

export default function BoqLineDetail({ lines, isAdmin }: { lines: LineDetail[]; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-slate-400 hover:text-slate-700 hover:underline"
      >
        {open ? "Ẩn chiết tính ▲" : "Xem chiết tính ▾"}
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-slate-50/60 p-2">
          <table className="w-full min-w-[520px] text-[11px]">
            <thead className="text-left text-slate-400">
              <tr>
                <th className="px-1 py-1 font-medium">Loại</th>
                <th className="px-1 py-1 font-medium">Tài nguyên</th>
                <th className="px-1 py-1 text-right font-medium">Định mức HP</th>
                <th className="px-1 py-1 text-right font-medium">Hao hụt</th>
                <th className="px-1 py-1 text-right font-medium">Đơn giá gốc</th>
                <th className="px-1 py-1 text-right font-medium">Thành tiền / 1 ĐVT</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-slate-200">
                  <td className="px-1 py-1 text-slate-500">{CAT_LABEL[l.category]}</td>
                  <td className="px-1 py-1">
                    <div className="text-slate-700">{l.resource.name}</div>
                    <div className="text-slate-400">
                      {l.resource.code} · {l.resource.unit}
                    </div>
                  </td>
                  <td className="px-1 py-1 text-right text-slate-600">{l.quantity}</td>
                  <td className="px-1 py-1 text-right text-slate-600">
                    {l.wastageRate ? `${(l.wastageRate * 100).toFixed(0)}%` : "-"}
                  </td>
                  <td className="px-1 py-1 text-right">
                    <ResourcePriceRow id={l.resource.id} unitPrice={l.resource.unitPrice} editable={isAdmin} />
                  </td>
                  <td className="px-1 py-1 text-right text-slate-700">
                    {Math.round(amountOf(l)).toLocaleString("vi-VN")}
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-1 py-2 text-center text-slate-400">
                    Công tác này không có bảng hao phí chi tiết (đơn giá cố định).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {!isAdmin && (
            <p className="mt-1 text-[10px] text-slate-400">Chỉ quản trị viên mới sửa được đơn giá gốc ở đây.</p>
          )}
        </div>
      )}
    </div>
  );
}
