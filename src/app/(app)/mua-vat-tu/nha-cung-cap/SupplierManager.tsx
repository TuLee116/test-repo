"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSupplierAction, saveSupplierAction, type SupplierInput } from "@/lib/proc-actions";
import { confirmNear } from "@/app/(app)/confirm-near";

type S = SupplierInput & { id: string; quotes: number };
const EMPTY: SupplierInput = { name: "", taxCode: "", address: "", contact: "", phone: "", email: "", bankAccount: "", bankName: "", note: "" };
const FIELDS: [keyof SupplierInput, string][] = [
  ["name", "Tên nhà cung cấp *"],
  ["taxCode", "Mã số thuế"],
  ["address", "Địa chỉ"],
  ["contact", "Người liên hệ"],
  ["phone", "Điện thoại"],
  ["email", "Email"],
  ["bankAccount", "Số tài khoản"],
  ["bankName", "Ngân hàng"],
  ["note", "Ghi chú (mặt hàng chính...)"],
];

export default function SupplierManager({ suppliers, editable }: { suppliers: S[]; editable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<{ id: string | null; data: SupplierInput } | null>(null);
  const [q, setQ] = useState("");
  const shown = suppliers.filter((s) => `${s.name} ${s.taxCode} ${s.note}`.toLowerCase().includes(q.toLowerCase()));
  const inp = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inp} max-w-xs`} placeholder="Tìm nhà cung cấp..." value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="flex-1" />
        {editable && (
          <button type="button" onClick={() => setEdit({ id: null, data: EMPTY })} className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800">
            + Thêm nhà cung cấp
          </button>
        )}
      </div>

      {edit && (
        <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-4">
          <h3 className="mb-3 font-medium">{edit.id ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp"}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {FIELDS.map(([k, label]) => (
              <label key={k} className="text-sm">
                <span className="font-medium text-slate-700">{label}</span>
                <input className={`${inp} mt-1`} value={edit.data[k]} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, [k]: e.target.value } })} />
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending}
              className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
              onClick={() =>
                start(async () => {
                  const r = await saveSupplierAction(edit.id, edit.data);
                  if (!r.ok) return window.alert(r.error);
                  setEdit(null);
                  router.refresh();
                })
              }
            >
              Lưu
            </button>
            <button type="button" onClick={() => setEdit(null)} className="rounded-md border border-slate-300 px-4 py-1.5 text-sm">
              Huỷ
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">Tên</th>
              <th className="px-3 py-2">MST</th>
              <th className="px-3 py-2">Liên hệ</th>
              <th className="px-3 py-2">Tài khoản</th>
              <th className="px-3 py-2">Ghi chú</th>
              <th className="px-3 py-2">Số lần báo giá</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 font-medium text-slate-800">
                  {s.name}
                  {s.address && <span className="block text-xs font-normal text-slate-500">{s.address}</span>}
                </td>
                <td className="px-3 py-2">{s.taxCode}</td>
                <td className="px-3 py-2">
                  {s.contact}
                  {s.phone && <span className="block text-xs text-slate-500">{s.phone}</span>}
                  {s.email && <span className="block text-xs text-slate-500">{s.email}</span>}
                </td>
                <td className="px-3 py-2">
                  {s.bankAccount}
                  {s.bankName && <span className="block text-xs text-slate-500">{s.bankName}</span>}
                </td>
                <td className="px-3 py-2 text-slate-600">{s.note}</td>
                <td className="px-3 py-2">{s.quotes}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {editable && (
                    <>
                      <button type="button" className="mr-3 text-xs text-sky-700 hover:underline" onClick={() => setEdit({ id: s.id, data: Object.fromEntries(FIELDS.map(([k]) => [k, s[k]])) as SupplierInput })}>
                        Sửa
                      </button>
                      {s.quotes === 0 && (
                        <button
                          type="button"
                          className="text-xs text-red-600 hover:underline"
                          onClick={async () =>
                            (await confirmNear(`Xoá nhà cung cấp "${s.name}"?`)) &&
                            start(async () => {
                              const r = await deleteSupplierAction(s.id);
                              if (!r.ok) return window.alert(r.error);
                              router.refresh();
                            })
                          }
                        >
                          Xoá
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  Chưa có nhà cung cấp
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
