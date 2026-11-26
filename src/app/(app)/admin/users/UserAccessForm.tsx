"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createUserAction, updateUserAccessAction } from "@/lib/actions";
import { POSITIONS } from "@/lib/user-positions";
import { AREAS, PERM_MODULES, type PermModule } from "@/lib/perms";

export type AccessValue = { name: string; position: string; email: string; isAdmin: boolean; dtcp: string[]; proc: string[]; price: string[]; sub: string[]; areas: string[] };
type ModKey = PermModule["key"];

// Form tạo / sửa tài khoản: CHECKLIST từng việc được làm ở mỗi phân hệ (DT-CP, Mua vật tư, Trình giá tổ đội, Trình giá thầu phụ)
// + khu vực được làm việc. Chọn chức danh có sẵn → tự tick các việc gợi ý (vẫn sửa tay được).
const THEME: Record<ModKey, string> = {
  dtcp: "border-sky-300 bg-sky-50/50",
  proc: "border-emerald-300 bg-emerald-50/50",
  price: "border-amber-300 bg-amber-50/50",
  sub: "border-violet-300 bg-violet-50/50",
};
const HEAD: Record<ModKey, string> = { dtcp: "text-sky-900", proc: "text-emerald-900", price: "text-amber-900", sub: "text-violet-900" };
const ICON: Record<ModKey, string> = { dtcp: "📊", proc: "🛒", price: "💰", sub: "📐" };

export default function UserAccessForm({ userId, initial, onDone }: { userId: string | null; initial: AccessValue; onDone?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const inp = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
  const toggle = (k: ModKey | "areas", code: string, on: boolean) => setV((x) => ({ ...x, [k]: on ? [...new Set([...x[k], code])] : x[k].filter((c) => c !== code) }));
  const setAll = (k: ModKey, on: boolean) => setV((x) => ({ ...x, [k]: on ? PERM_MODULES.find((m) => m.key === k)!.items.map((i) => i.value) : [] }));

  // đổi chức danh: bỏ phần GỢI Ý của chức danh cũ, thêm gợi ý của chức danh mới (phần tick tay khác giữ nguyên)
  const pickPosition = (p: string) =>
    setV((x) => {
      const prev = POSITIONS.find((y) => y.value === x.position);
      const next = POSITIONS.find((y) => y.value === p);
      const merge = (cur: string[], old: string[] = [], add: string[] = []) => [...new Set([...cur.filter((c) => !old.includes(c)), ...add])];
      return { ...x, position: p, dtcp: merge(x.dtcp, prev?.dtcp, next?.dtcp), proc: merge(x.proc, prev?.proc, next?.proc), price: merge(x.price, prev?.price, next?.price), sub: merge(x.sub, prev?.sub, next?.sub) };
    });

  const save = () =>
    start(async () => {
      const r = userId ? await updateUserAccessAction(userId, v) : await createUserAction({ ...v, username, password });
      if (!r.ok) return window.alert(r.error);
      if (!userId) {
        setV(initial);
        setUsername("");
        setPassword("");
      }
      router.refresh();
      onDone?.();
    });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <label className="text-sm">
          <span className="font-medium text-slate-700">Họ tên</span>
          <input className={inp} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </label>
        {!userId && (
          <>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Tên đăng nhập</span>
              <input className={inp} autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Mật khẩu (≥ 8 ký tự)</span>
              <input className={inp} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </>
        )}
        <label className="text-sm">
          <span className="font-medium text-slate-700">Chức danh</span>
          <input className={inp} list="user-positions" value={v.position} onChange={(e) => pickPosition(e.target.value)} placeholder="Chọn hoặc gõ: QSĐT, QSTT, Trưởng phòng..." />
          <datalist id="user-positions">
            {POSITIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </datalist>
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Email công ty (nhận mã đăng nhập)</span>
          <input className={inp} type="email" autoComplete="off" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="Để trống nếu tên đăng nhập đã là email" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <label className="flex items-center gap-2 font-semibold text-amber-800">
          <input type="checkbox" className="h-4 w-4" checked={v.isAdmin} onChange={(e) => setV({ ...v, isAdmin: e.target.checked })} />
          ⚙️ Quản trị hệ thống <span className="text-xs font-normal text-slate-500">(mọi quyền, mọi khu vực, quản lý người dùng, sao lưu)</span>
        </label>
        <span className="flex-1" />
        <span className="font-medium text-slate-700">Khu vực làm việc:</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={!v.areas.length} onChange={(e) => e.target.checked && setV({ ...v, areas: [] })} /> Tất cả
        </label>
        {AREAS.map((a) => (
          <label key={a} className="flex items-center gap-1">
            <input type="checkbox" checked={v.areas.includes(a)} onChange={(e) => toggle("areas", a, e.target.checked)} /> KV {a}
          </label>
        ))}
      </div>

      <div className={`grid gap-3 lg:grid-cols-2 ${v.isAdmin ? "pointer-events-none opacity-50" : ""}`}>
        {PERM_MODULES.map((m) => {
          const cur = v[m.key];
          return (
            <fieldset key={m.key} className={`rounded-md border-l-4 border p-3 ${THEME[m.key]}`}>
              <legend className={`px-1 text-sm font-bold ${HEAD[m.key]}`}>
                {ICON[m.key]} {m.title}
              </legend>
              <div className="mb-1 flex gap-3 text-xs">
                <button type="button" className="text-sky-700 hover:underline" onClick={() => setAll(m.key, true)}>
                  Chọn hết
                </button>
                <button type="button" className="text-slate-500 hover:underline" onClick={() => setAll(m.key, false)}>
                  Bỏ hết
                </button>
                <span className="text-slate-400">{cur.length ? `${cur.length} việc` : "không dùng phân hệ này"}</span>
              </div>
              <div className="space-y-1">
                {m.items.map((it) => (
                  <label key={it.value} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 h-4 w-4" checked={cur.includes(it.value)} onChange={(e) => toggle(m.key, it.value, e.target.checked)} />
                    <span>{it.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">
        Tick việc ở phân hệ nào thì người đó dùng phân hệ đó (menu tự hiện). Khu vực áp cho mọi phân hệ. Giám sát / CHT còn phải gán dự án ở <b>Phân quyền Mua vật tư</b>.
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={save} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? "Đang lưu..." : userId ? "Lưu thay đổi" : "Tạo tài khoản"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
            Huỷ
          </button>
        )}
      </div>
    </div>
  );
}
