"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmSiteAction, deleteSiteAction, importSitesAction, linkLooseAction, mergeSitesAction, saveSiteAction } from "@/lib/project-site-actions";
import { clusterLabel, searchSites, siteLabel, similarSites, type SiteOpt } from "@/lib/project-site-calc";
import type { LooseGroup } from "@/lib/project-site";
import SitePicker from "./SitePicker";

type Used = { dtcp: number; contract: number; price: number; sub: number };
// HỢP ĐỒNG THEO BẢNG TT DỰ ÁN của dự án; use = số hồ sơ trên phần mềm có cùng SỐ HĐ
type SiteContractRow = { id: string; code: string; contractNo: string; title: string; category: string; company: string; use: { contract: number; price: number; sub: number } };
type Site = SiteOpt & { createdByName: string; used: Used; contracts: SiteContractRow[] };

const usedText = (u: Used) =>
  [u.dtcp && `${u.dtcp} DT-CP`, u.contract && `${u.contract} HĐ`, u.price && `${u.price} hồ sơ đội`, u.sub && `${u.sub} hồ sơ thầu phụ`].filter(Boolean).join(" · ") || "—";
const AREA_NAME: Record<string, string> = { "1": "Đà Nẵng", "2": "Sài Gòn", "3": "Còn lại", "4": "Phú Quốc", "5": "Nhà tư" };
const areaText = (a: string) => (a ? `KV ${a}${AREA_NAME[a] ? ` · ${AREA_NAME[a]}` : ""}` : "—");

export default function SiteAdmin({ sites, loose }: { sites: Site[]; loose: LooseGroup[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok = "") =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return window.alert(r.error);
      if (ok) setMsg(ok);
      router.refresh();
    });

  const pendingSites = sites.filter((s) => s.status === "PENDING");
  const active = sites.filter((s) => s.status !== "PENDING");

  // ---- danh mục ----
  const [q, setQ] = useState("");
  const [kv, setKv] = useState("");
  const [cl, setCl] = useState(""); // lọc CỤM DỰ ÁN ("-" = dự án không thuộc cụm)
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<string | null>(null);
  const [openC, setOpenC] = useState<Set<string>>(new Set()); // dự án đang mở danh sách hợp đồng
  const toggleC = (id: string) =>
    setOpenC((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const shown = useMemo(() => {
    // gõ số HĐ / mã hợp đồng (VD "324/2026", "KV4-SB-02.04") cũng ra dự án chứa hợp đồng đó
    const t = q.trim().toLowerCase();
    const byName = new Set(searchSites(q, sites).map((s) => s.id));
    const hitC = (s: Site) => t.length >= 3 && s.contracts.some((c) => `${c.code} ${c.contractNo}`.toLowerCase().includes(t));
    return sites.filter((s) => (byName.has(s.id) || hitC(s)) && (!kv || s.area === kv) && (!cl || (cl === "-" ? !s.cluster : s.cluster === cl)));
  }, [q, kv, cl, sites]);
  // danh sách cụm (theo khu vực đang lọc): mã → tên, số dự án
  const clusters = useMemo(() => {
    const m = new Map<string, { code: string; name: string; area: string; n: number }>();
    for (const s of sites) {
      if (!s.cluster) continue;
      const c = m.get(s.cluster) ?? { code: s.cluster, name: s.clusterName ?? "", area: s.area, n: 0 };
      c.n++;
      m.set(s.cluster, c);
    }
    return [...m.values()].sort((a, b) => a.area.localeCompare(b.area) || a.code.localeCompare(b.code));
  }, [sites]);
  const groupKey = (s: Site) => `${s.area}|${s.cluster ?? ""}`;
  const groupCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of shown) m.set(groupKey(s), (m.get(groupKey(s)) ?? 0) + 1);
    return m;
  }, [shown]);
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selected = sites.filter((s) => sel.has(s.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Danh mục dự án</h1>
          <p className="text-sm text-slate-500">
            Khu vực → Cụm dự án (VD KV4-SB Sân bay Phú Quốc) → Dự án (KV4-SB-01) → Hợp đồng. Mỗi dự án 1 MÃ + tên chuẩn. DT-CP, hợp đồng, hồ sơ giá đội, hồ sơ thầu phụ đều chọn dự án từ danh mục này — tên trên các hồ sơ luôn theo tên chuẩn, không còn tách 2 dự án vì gõ khác chữ.
          </p>
        </div>
        <form
          className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const r = await importSitesAction(fd);
              if (!r.ok) return window.alert(r.error);
              setMsg(`Đã đọc ${r.total} dự án trong file: thêm mới ${r.created}, cập nhật ${r.updated}${r.contracts ? `; nạp ${r.contracts} hợp đồng theo bảng` : ""}.`);
              router.refresh();
            });
          }}
        >
          <span className="font-medium">📥 Nhập / cập nhật từ file “BẢNG TT DỰ ÁN”</span>
          <input type="file" name="file" accept=".xlsx" required className="max-w-56 text-xs" />
          <button disabled={pending} className="rounded bg-sky-700 px-3 py-1 text-white hover:bg-sky-800 disabled:opacity-50">
            {pending ? "Đang xử lý…" : "Nhập"}
          </button>
        </form>
      </div>
      {msg && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}

      {/* ---- dự án người dùng đề nghị ---- */}
      {pendingSites.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50/60 p-3">
          <h2 className="mb-2 font-semibold text-amber-900">Dự án mới người dùng đề nghị — chờ xác nhận ({pendingSites.length})</h2>
          <table className="w-full text-sm">
            <tbody>
              {pendingSites.map((s) => (
                <PendingRow key={s.id} s={s} active={active} pending={pending} act={act} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ---- tên dự án cũ chưa gắn mã ---- */}
      {loose.length > 0 && (
        <section className="rounded-lg border border-sky-200 bg-sky-50/50 p-3">
          <h2 className="font-semibold text-sky-900">Tên dự án đang dùng trên phần mềm, CHƯA gắn mã ({loose.length})</h2>
          <p className="mb-2 text-xs text-slate-600">
            Chọn đúng dự án trong danh mục rồi bấm “Gắn” — mọi DT-CP / hợp đồng / hồ sơ mang tên này chuyển sang tên chuẩn, tên cũ giữ làm tên gọi khác (file Excel ghi tên cũ vẫn tự nhận). Phần mềm gợi ý sẵn dự án gần giống nhất.
          </p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1">Tên đang dùng</th>
                <th>Đang có</th>
                <th className="w-[28rem]">Gắn vào dự án</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loose.map((g) => (
                <LooseRow key={g.key} g={g} sites={active} pending={pending} act={act} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ---- danh mục ---- */}
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 font-semibold">
            Danh mục ({clusters.length} cụm · {sites.length} dự án)
          </h2>
          <input className="w-72 rounded border px-2 py-1 text-sm" placeholder="Tìm mã / tên / cụm / số HĐ (không dấu)" value={q} onChange={(e) => setQ(e.target.value)} />
          <select
            className="rounded border px-2 py-1 text-sm"
            value={kv}
            onChange={(e) => {
              setKv(e.target.value);
              setCl("");
            }}
          >
            <option value="">Mọi khu vực</option>
            {Object.keys(AREA_NAME).map((a) => (
              <option key={a} value={a}>
                {areaText(a)}
              </option>
            ))}
          </select>
          <select className="max-w-72 rounded border px-2 py-1 text-sm" value={cl} onChange={(e) => setCl(e.target.value)} title="Lọc theo cụm dự án">
            <option value="">Mọi cụm dự án</option>
            {clusters
              .filter((c) => !kv || c.area === kv)
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {clusterLabel({ cluster: c.code, clusterName: c.name })} ({c.n})
                </option>
              ))}
            <option value="-">— Không thuộc cụm nào —</option>
          </select>
          {selected.length >= 2 && (
            <span className="ml-auto flex items-center gap-2 rounded bg-violet-50 px-2 py-1 text-sm">
              Gộp {selected.length} dự án đã chọn vào:
              <select
                className="rounded border px-1 py-0.5"
                defaultValue=""
                disabled={pending}
                onChange={(e) => {
                  const t = e.target.value;
                  e.target.value = "";
                  if (!t) return;
                  const target = selected.find((s) => s.id === t)!;
                  if (!window.confirm(`Gộp ${selected.length - 1} dự án vào "${siteLabel(target)}"?\nMọi DT-CP / hợp đồng / hồ sơ chuyển sang dự án này, tên các dự án kia thành tên gọi khác. Không hoàn tác được.`)) return;
                  act(() => mergeSitesAction(t, selected.map((s) => s.id)), "Đã gộp dự án.");
                  setSel(new Set());
                }}
              >
                <option value="">— chọn dự án giữ lại —</option>
                {selected.map((s) => (
                  <option key={s.id} value={s.id}>
                    {siteLabel(s)}
                  </option>
                ))}
              </select>
              <button className="text-slate-500 hover:underline" onClick={() => setSel(new Set())}>
                Bỏ chọn
              </button>
            </span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-slate-500">
            <tr>
              <th className="w-6" />
              <th className="w-28 py-1">Mã</th>
              <th>Tên chuẩn</th>
              <th className="w-36">Khu vực</th>
              <th>Tên gọi khác</th>
              <th className="w-56">Đang dùng</th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody>
            {shown.map((s, i) => (
              <Fragment key={s.id}>
                {(i === 0 || groupKey(shown[i - 1]) !== groupKey(s)) && (
                  <tr className={s.cluster ? "bg-violet-50" : "bg-slate-100"}>
                    <td colSpan={7} className="px-2 py-1 text-xs font-semibold text-slate-700">
                      {areaText(s.area)} ›{" "}
                      {s.cluster ? (
                        <>
                          CỤM <span className="font-mono">{s.cluster}</span> · {s.clusterName}
                        </>
                      ) : (
                        <span className="italic text-slate-500">không thuộc cụm</span>
                      )}{" "}
                      <span className="font-normal text-slate-500">({groupCount.get(groupKey(s))} dự án)</span>
                    </td>
                  </tr>
                )}
                {edit === s.id ? (
                <EditRow s={s} clusters={clusters} pending={pending} onDone={() => setEdit(null)} act={act} />
              ) : (
                <tr key={s.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                  <td className="py-1">
                    <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} title="Chọn để gộp" />
                  </td>
                  <td className="py-1 font-mono text-xs">{s.code || <span className="text-slate-400">(chưa có)</span>}</td>
                  <td className="py-1">
                    {s.name}
                    {s.status === "PENDING" && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">chờ xác nhận</span>}
                  </td>
                  <td className="py-1 text-xs">{areaText(s.area)}</td>
                  <td className="py-1 text-xs text-slate-500">{s.aliases.join(" · ")}</td>
                  <td className="py-1 text-xs">
                    {usedText(s.used)}
                    {s.contracts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleC(s.id)}
                        className="mt-0.5 block rounded border border-violet-300 bg-white px-1.5 text-[11px] text-violet-800 hover:bg-violet-50"
                        title="Hợp đồng của dự án theo BẢNG TT DỰ ÁN"
                      >
                        {openC.has(s.id) ? "▾" : "▸"} {s.contracts.length} hợp đồng theo bảng
                      </button>
                    )}
                  </td>
                  <td className="py-1 text-right text-xs">
                    <button className="text-sky-700 hover:underline" onClick={() => setEdit(s.id)}>
                      Sửa
                    </button>
                    {!Object.values(s.used).some(Boolean) && (
                      <button
                        className="ml-2 text-red-600 hover:underline"
                        disabled={pending}
                        onClick={() => window.confirm(`Xoá dự án "${s.name}" khỏi danh mục?`) && act(() => deleteSiteAction(s.id))}
                      >
                        Xoá
                      </button>
                    )}
                  </td>
                </tr>
                )}
                {openC.has(s.id) && <ContractRows s={s} />}
              </Fragment>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={7} className="py-3 text-center italic text-slate-500">
                  {sites.length ? "Không có dự án khớp" : "Chưa có dự án — bấm “Nhập” để nạp danh mục từ file BẢNG TT DỰ ÁN"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

type Act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok?: string) => void;

// danh sách HỢP ĐỒNG của 1 dự án (cấp dưới cùng: Khu vực → Cụm → Dự án → Hợp đồng)
function ContractRows({ s }: { s: Site }) {
  const usageText = (u: SiteContractRow["use"]) => [u.contract && `${u.contract} HĐ DT-CP`, u.price && `${u.price} hồ sơ đội`, u.sub && `${u.sub} hồ sơ thầu phụ`].filter(Boolean).join(" · ");
  return (
    <tr className="border-b border-slate-100">
      <td />
      <td colSpan={6} className="pb-2">
        <table className="w-full rounded border border-violet-200 bg-violet-50/40 text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="w-32 px-2 py-1">Mã hợp đồng</th>
              <th className="w-52">Số HĐ</th>
              <th>Nội dung</th>
              <th className="w-14">Hạng mục</th>
              <th className="w-16">Công ty</th>
              <th className="w-48">Trên phần mềm</th>
            </tr>
          </thead>
          <tbody>
            {s.contracts.map((c) => (
              <tr key={c.id} className="border-t border-violet-100 align-top">
                <td className="px-2 py-0.5 font-mono">{c.code || <span className="text-slate-400">—</span>}</td>
                <td className="py-0.5">{c.contractNo || <span className="italic text-slate-400">chưa có số</span>}</td>
                <td className="py-0.5">{c.title}</td>
                <td className="py-0.5">{c.category}</td>
                <td className="py-0.5">{c.company}</td>
                <td className="py-0.5 text-slate-600">{usageText(c.use) || <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

function PendingRow({ s, active, pending, act }: { s: Site; active: Site[]; pending: boolean; act: Act }) {
  const sim = useMemo(() => similarSites(s.name, active, s.area, 3, 0.4), [s, active]);
  const [target, setTarget] = useState<string | null>(sim[0]?.site.id ?? null);
  return (
    <tr className="border-b border-amber-200 align-top">
      <td className="py-1.5">
        <b>{s.name}</b>
        <div className="text-xs text-slate-500">
          {areaText(s.area)} · đề nghị bởi {s.createdByName || "?"} · {usedText(s.used)}
        </div>
      </td>
      <td className="w-[30rem] py-1.5">
        <div className="flex items-center gap-2">
          <SitePicker sites={active} value={target} onChange={(x) => setTarget(x?.id ?? null)} area={s.area} allowPropose={false} className="flex-1" placeholder="Gộp vào dự án có sẵn…" />
          <button
            disabled={pending || !target}
            className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-40"
            onClick={() => act(() => mergeSitesAction(target!, [s.id]), `Đã gộp "${s.name}" vào dự án có sẵn.`)}
          >
            Gộp vào
          </button>
        </div>
        {sim.length > 0 && <div className="mt-0.5 text-[11px] text-slate-500">Gần giống: {sim.map((x) => `${siteLabel(x.site)} (${Math.round(x.score * 100)}%)`).join(" · ")}</div>}
      </td>
      <td className="w-40 py-1.5 text-right">
        <button disabled={pending} className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-40" onClick={() => act(() => confirmSiteAction(s.id))}>
          ✓ Đúng là dự án mới
        </button>
      </td>
    </tr>
  );
}

function LooseRow({ g, sites, pending, act }: { g: LooseGroup; sites: Site[]; pending: boolean; act: Act }) {
  const [target, setTarget] = useState<string | null>(g.suggest[0]?.id ?? null);
  // XEM HỒ SƠ trước khi gắn: mở danh sách hồ sơ / hợp đồng mang tên này; bỏ tick hồ sơ thuộc dự án khác (gắn riêng sau)
  const [open, setOpen] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());
  const picked = g.items.filter((x) => !off.has(x.id));
  const partial = picked.length < g.items.length;
  const n = picked.length;
  const ids = partial ? picked.map((x) => x.id) : [];
  const toggle = (id: string) =>
    setOff((s) => {
      const nx = new Set(s);
      if (nx.has(id)) nx.delete(id);
      else nx.add(id);
      return nx;
    });
  const KIND: Record<string, string> = { sub: "Thầu phụ", price: "Giá đội", contract: "Hợp đồng", dtcp: "DT-CP" };
  return (
    <>
    <tr className={`align-top ${open ? "" : "border-b border-sky-100"}`}>
      <td className="py-1.5">
        {g.names.map((x) => (
          <div key={x}>{x}</div>
        ))}
        <div className="text-[11px] text-slate-500">{areaText(g.area)}</div>
      </td>
      <td className="py-1.5 text-xs">
        <button type="button" onClick={() => setOpen((o) => !o)} className="rounded border border-sky-300 bg-white px-2 py-0.5 text-left text-sky-800 hover:bg-sky-100" title="Xem từng hồ sơ để kiểm tra trước khi gắn mã">
          {open ? "▾" : "▸"} {usedText(g.counts)}
        </button>
        {partial && <div className="mt-0.5 text-[11px] font-semibold text-amber-700">Gắn {n}/{g.items.length} hồ sơ đã tick</div>}
      </td>
      <td className="py-1.5">
        <SitePicker sites={sites} value={target} onChange={(x) => setTarget(x?.id ?? null)} area={g.area} allowPropose={false} placeholder="Chọn dự án trong danh mục…" />
        {g.suggest.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
            Gợi ý:
            {g.suggest.map((x) => (
              <button key={x.id} className={`rounded px-1 ${target === x.id ? "bg-sky-200" : "bg-white hover:bg-sky-100"}`} onClick={() => setTarget(x.id)}>
                {x.label} ({x.score}%)
              </button>
            ))}
          </div>
        )}
      </td>
      <td className="w-44 py-1.5 text-right">
        <button
          disabled={pending || !target || !n}
          className="rounded bg-sky-700 px-2 py-1 text-xs text-white hover:bg-sky-800 disabled:opacity-40"
          onClick={() => act(() => linkLooseAction(g.key, target!, "", "", ids), `Đã gắn ${n} bản ghi "${g.names[0]}".`)}
        >
          Gắn{partial ? ` ${n} hồ sơ` : ""}
        </button>
        <button
          disabled={pending || !n}
          className="ml-1 rounded border px-2 py-1 text-xs hover:bg-white disabled:opacity-40"
          title="Không có trong danh mục: tạo dự án mới (chưa có mã) từ tên này"
          onClick={() => window.confirm(`Tạo dự án mới "${g.names[0]}" (chưa có mã) và gắn ${n} bản ghi vào?`) && act(() => linkLooseAction(g.key, "@new", g.names[0], g.area, ids))}
        >
          ＋ Dự án mới
        </button>
      </td>
    </tr>
    {open && (
      <tr className="border-b border-sky-100">
        <td colSpan={4} className="pb-3 pl-4">
          <div className="rounded-md border border-sky-200 bg-white">
            <p className="border-b border-sky-100 px-3 py-1.5 text-[11px] text-slate-500">
              Bấm mã hồ sơ để mở xem nội dung (tab mới). Hồ sơ nào thuộc dự án KHÁC thì bỏ tick — nút “Gắn” chỉ gắn các hồ sơ đang tick, hồ sơ bỏ tick vẫn nằm lại ở đây để gắn riêng.
            </p>
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="w-8 px-2 py-1">
                    <input type="checkbox" checked={!off.size} onChange={() => setOff(off.size ? new Set() : new Set(g.items.map((x) => x.id)))} title="Tick / bỏ tick tất cả" />
                  </th>
                  <th className="w-20">Loại</th>
                  <th className="w-56">Hồ sơ</th>
                  <th>Nội dung</th>
                  <th className="w-40">Trạng thái</th>
                  <th className="w-24">Ngày</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((x) => (
                  <tr key={x.id} className={`border-t border-slate-100 align-top ${off.has(x.id) ? "bg-slate-50 text-slate-400" : ""}`}>
                    <td className="px-2 py-1">
                      <input type="checkbox" checked={!off.has(x.id)} onChange={() => toggle(x.id)} />
                    </td>
                    <td className="py-1">{KIND[x.kind]}</td>
                    <td className="py-1">
                      <a href={x.href} target="_blank" rel="noopener noreferrer" className="font-medium text-sky-700 hover:underline">
                        {x.title} ↗
                      </a>
                    </td>
                    <td className="py-1">{x.detail}</td>
                    <td className="py-1">{x.status}</td>
                    <td className="py-1">{x.at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    )}
    </>
  );
}

type ClusterOpt = { code: string; name: string; area: string; n: number };

function EditRow({ s, clusters, pending, onDone, act }: { s: Site; clusters: ClusterOpt[]; pending: boolean; onDone: () => void; act: Act }) {
  const [code, setCode] = useState(s.code);
  const [name, setName] = useState(s.name);
  const [area, setArea] = useState(s.area);
  const [aliases, setAliases] = useState(s.aliases.join("\n"));
  const [cluster, setCluster] = useState(s.cluster ?? "");
  const [clusterName, setClusterName] = useState(s.clusterName ?? "");
  const listId = `cum-${s.id}`;
  return (
    <tr className="border-b bg-sky-50 align-top">
      <td />
      <td className="py-1">
        <input className="w-full rounded border px-1 font-mono text-xs" value={code} onChange={(e) => setCode(e.target.value)} />
      </td>
      <td className="py-1">
        <input className="w-full rounded border px-1" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="text-[11px] text-slate-500">Đổi tên: tên cũ tự giữ làm tên gọi khác; mọi hồ sơ cập nhật theo tên mới.</p>
      </td>
      <td className="py-1">
        <select className="w-full rounded border px-1 text-xs" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">—</option>
          {Object.keys(AREA_NAME).map((a) => (
            <option key={a} value={a}>
              {areaText(a)}
            </option>
          ))}
        </select>
        {/* CỤM DỰ ÁN: gõ / chọn mã cụm có sẵn (tự lấy tên cụm); mã mới thì gõ thêm tên cụm; để trống = không thuộc cụm */}
        <input
          className="mt-1 w-full rounded border px-1 font-mono text-xs"
          list={listId}
          placeholder="Mã cụm (VD KV4-SB)"
          value={cluster}
          onChange={(e) => {
            const v = e.target.value.toUpperCase();
            setCluster(v);
            const hit = clusters.find((c) => c.code === v.trim());
            if (hit) setClusterName(hit.name);
          }}
        />
        <datalist id={listId}>
          {clusters.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </datalist>
        {cluster.trim() && <input className="mt-1 w-full rounded border px-1 text-xs" placeholder="Tên cụm" value={clusterName} onChange={(e) => setClusterName(e.target.value)} />}
      </td>
      <td className="py-1">
        <textarea className="w-full rounded border px-1 text-xs" rows={3} value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Mỗi dòng 1 tên gọi khác" />
      </td>
      <td className="py-1 text-xs">{usedText(s.used)}</td>
      <td className="py-1 text-right text-xs">
        <button
          disabled={pending}
          className="rounded bg-sky-700 px-2 py-1 text-white disabled:opacity-40"
          onClick={() => {
            act(() => saveSiteAction(s.id, { code, name, area, aliases: aliases.split("\n"), cluster, clusterName }));
            onDone();
          }}
        >
          Lưu
        </button>
        <button className="ml-1 text-slate-500 hover:underline" onClick={onDone}>
          Huỷ
        </button>
      </td>
    </tr>
  );
}
