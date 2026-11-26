"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFromProjectAction, deleteContractAction, syncFromProjectAction, updateContractAction } from "@/lib/hop-dong-actions";
import { confirmNear } from "@/app/(app)/confirm-near";
import type { Version } from "@/lib/hop-dong-calc";
import ImportWizard from "./ImportWizard";
import { adminDeleteContractAction } from "@/lib/admin-delete-actions";
import SitePicker from "@/app/(app)/du-an/SitePicker";
import type { SiteOpt } from "@/lib/project-site-calc";

// Nút mở trình nhập DT-CP Excel (mới hoặc nhập lại vào hợp đồng có sẵn)
export function ImportButton({ contractId, label, sites, init, autoOpen, parents }: { contractId?: string; label: string; sites?: SiteOpt[]; init?: { area: string; name: string; siteId?: string }; autoOpen?: boolean; parents?: { id: string; name: string; area: string; contractNo: string; packageName: string }[] }) {
  const [open, setOpen] = useState(!!autoOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800">
        {label}
      </button>
      {open && <ImportWizard contractId={contractId} sites={sites} init={init} parents={parents} onClose={() => setOpen(false)} />}
    </>
  );
}

// Tạo hợp đồng từ DT-CP lập trên phần mềm
export function FromProject({ projects }: { projects: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pid, setPid] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="max-w-md rounded border border-slate-300 px-2 py-2 text-sm" value={pid} onChange={(e) => setPid(e.target.value)}>
        <option value="">— Chọn DT-CP trên phần mềm —</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!pid || pending}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const r = await createFromProjectAction(pid);
            if (!r.ok) return window.alert(r.error);
            router.push(`/gia-doi/hop-dong/${r.id}`);
          })
        }
      >
        {pending ? "Đang lấy..." : "Lấy sổ giá từ DT-CP này"}
      </button>
    </div>
  );
}

// Sửa thông tin + chọn thời điểm "Đã duyệt" + cập nhật từ phần mềm + xoá
export function ContractInfo({
  id,
  init,
  parents = [],
  versions,
  source,
  canEdit,
  isAdmin = false,
  sites = [],
}: {
  sites?: SiteOpt[]; // DANH MỤC DỰ ÁN
  id: string;
  init: { area: string; siteId: string; name: string; packageName: string; contractNo: string; appendixNo: string; appendixOfId: string; approvedVersion: number };
  parents?: { id: string; name: string; area: string; contractNo: string; packageName: string }[]; // các HỢP ĐỒNG GỐC có thể chọn làm hợp đồng của phụ lục
  versions: Version[];
  source: string;
  canEdit: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(init);
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const inp = "mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50";
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-6">
        <label className="text-sm">
          <span className="font-medium text-slate-700">Khu vực</span>
          <select disabled={!canEdit} className={inp} value={v.area} onChange={(e) => setV({ ...v, area: e.target.value })}>
            <option value="">— Chưa chọn —</option>
            {["1", "2", "3", "4", "5"].map((k) => (
              <option key={k} value={k}>
                Khu vực {k}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ["packageName", "Gói thầu"],
            ["contractNo", "Số hợp đồng"],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="text-sm">
            <span className="font-medium text-slate-700">{l}</span>
            <input disabled={!canEdit} className={inp} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </label>
        ))}
        <div className="text-sm sm:col-span-2">
          <span className="font-medium text-slate-700">Công trình / Dự án (Danh mục dự án)</span>
          <SitePicker
            sites={sites}
            value={v.siteId}
            area={v.area}
            invalid
            disabled={!canEdit || !!v.appendixOfId}
            className="mt-1 rounded border border-slate-300 py-1"
            title={v.appendixOfId ? "Phụ lục: theo dự án của hợp đồng gốc" : undefined}
            placeholder={v.name ? `Đang ghi “${v.name}” — chọn dự án trong danh mục` : undefined}
            onChange={(s) => setV({ ...v, siteId: s?.id ?? "", name: s?.name ?? v.name, area: v.area || s?.area || "" })}
          />
        </div>
        <label className="text-sm sm:col-span-2">
          <span className="font-medium text-slate-700">Phụ lục của hợp đồng (chọn nếu đây là phụ lục)</span>
          <select
            disabled={!canEdit}
            className={inp}
            value={v.appendixOfId}
            onChange={(e) => {
              const p = parents.find((x) => x.id === e.target.value);
              setV(p ? { ...v, appendixOfId: p.id, name: p.name, contractNo: v.contractNo || p.contractNo } : { ...v, appendixOfId: "", appendixNo: "" });
            }}
          >
            <option value="">— Không: đây là hợp đồng gốc —</option>
            {parents
              .filter((p) => !v.area || p.area === v.area)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {[p.contractNo ? `HĐ ${p.contractNo}` : "HĐ (chưa có số)", p.packageName, p.name].filter(Boolean).join(" — ")}
                </option>
              ))}
          </select>
        </label>
        {(v.appendixOfId || v.appendixNo) && (
          <label className="text-sm">
            <span className="font-medium text-slate-700">Tên phụ lục (PL01, PL02…)</span>
            <input disabled={!canEdit} className={inp} value={v.appendixNo} onChange={(e) => setV({ ...v, appendixNo: e.target.value })} />
          </label>
        )}
        <label className="text-sm">
          <span className="font-medium text-slate-700">Thời điểm &quot;Đã duyệt&quot; (kiểm soát giá)</span>
          <select disabled={!canEdit} className={inp} value={v.approvedVersion} onChange={(e) => setV({ ...v, approvedVersion: Number(e.target.value) })}>
            {!versions.length && <option value={0}>Đơn giá duy nhất của file</option>}
            {versions.map((x) => (
              <option key={x.n} value={x.n}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!dirty || pending} onClick={() => start(async () => { const r = await updateContractAction(id, v); if (!r.ok) return window.alert(r.error); router.refresh(); })} className="rounded-md bg-slate-800 px-4 py-1.5 text-sm text-white hover:bg-slate-900 disabled:opacity-40">
            Lưu thông tin
          </button>
          {source === "EXCEL" ? (
            <ImportButton contractId={id} label="📥 Nhập lại file DT-CP (thời điểm mới)" sites={sites} init={{ area: v.area, name: v.name, siteId: v.siteId }} />
          ) : (
            <button type="button" disabled={pending} onClick={() => start(async () => { const r = await syncFromProjectAction(id); if (!r.ok) return window.alert(r.error); if ("info" in r) window.alert(r.info); router.refresh(); })} className="rounded-md bg-sky-700 px-4 py-1.5 text-sm text-white hover:bg-sky-800 disabled:opacity-50">
              🔄 Cập nhật từ DT-CP phần mềm (thêm thời điểm mới)
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            disabled={pending}
            onClick={async () => {
              if (!(await confirmNear("Xoá hợp đồng này (chỉ xoá được khi chưa có hồ sơ trình giá)?"))) return;
              start(async () => {
                const r = await deleteContractAction(id);
                if (!r.ok) return window.alert(r.error);
                router.push("/gia-doi/hop-dong");
              });
            }}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
          >
            Xoá hợp đồng
          </button>
          {isAdmin && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const want = init.contractNo || init.name;
                const typed = window.prompt(`[Quản trị] XOÁ HẲN hợp đồng này cùng TOÀN BỘ hồ sơ giá đội, hồ sơ thầu phụ và sổ giá. Không khôi phục được.

Gõ lại ${init.contractNo ? "số HĐ" : "tên công trình"} để xác nhận: ${want}`);
                if (typed == null) return;
                start(async () => {
                  const r = await adminDeleteContractAction(id, typed);
                  if (!r.ok) return window.alert(r.error);
                  if (r.info) window.alert(r.info);
                  router.push("/gia-doi/hop-dong");
                });
              }}
              className="rounded-md bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-800 disabled:opacity-50"
            >
              🗑 Xoá HĐ kèm toàn bộ hồ sơ (quản trị)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
