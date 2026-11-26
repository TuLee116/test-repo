"use client";

import { Fragment, useMemo, useState } from "react";
import EditNormModal from "./EditNormModal";
import NormImportModal from "./NormImportModal";

export type CatalogLine = {
  id: string;
  category: "VT" | "NC" | "TB";
  code: string;
  name: string;
  unit: string;
  quantity: number;
  formula: string | null;
};

export type CatalogRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  section: string;
  subsection: string;
  lines: CatalogLine[];
};

const CAT_TITLE: Record<string, string> = { VT: "1. Vật tư", NC: "2. Nhân công", TB: "3. Máy thi công" };
const fmtQty = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 6 });

export default function CatalogTable({ rows, isAdmin = false }: { rows: CatalogRow[]; isAdmin?: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.section.toLowerCase().includes(q) ||
        r.subsection.toLowerCase().includes(q) ||
        r.lines.some((l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q))
    );
  }, [rows, query]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Tìm theo tên công tác, mã ĐM, phần/hạng mục, tên vật tư / nhân công / máy..."
        className="w-full max-w-xl rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
      {isAdmin && <NormImportModal />}
      {isAdmin && <EditNormModal isNew row={{ id: "", code: "", name: "", unit: "", section: "", subsection: "", lines: [] }} />}
      </div>
      {!isAdmin && <p className="mt-1 text-xs text-slate-400">Chỉ quản trị viên mới điều chỉnh / bổ sung định mức.</p>}
      <p className="mt-1 text-xs text-slate-400">
        {filtered.length} / {rows.length} công tác
      </p>

      <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="sticky top-0 bg-green-100 text-left text-slate-900">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 font-medium">Mã ĐM</th>
              <th className="px-3 py-2 font-medium">Công tác</th>
              <th className="px-3 py-2 font-medium">ĐVT</th>
              <th className="px-3 py-2 text-right font-medium">Số dòng hao phí</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const isOpen = open.has(r.id);
              return (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => toggle(r.id)}>
                    <td className="px-2 py-2 text-center text-slate-400">{isOpen ? "▼" : "▶"}</td>
                    <td className="px-3 py-2 text-slate-500">{r.code}</td>
                    <td className="px-3 py-2">
                      <div className="text-slate-800">{r.name}</div>
                      <div className="text-xs text-slate-400">
                        {r.section} {r.subsection && `/ ${r.subsection}`}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.unit}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{r.lines.length}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50/60">
                      <td />
                      <td colSpan={4} className="px-3 pb-3 pt-1">
                        {isAdmin && (
                          <div className="mb-1 flex justify-end">
                            <EditNormModal row={r} />
                          </div>
                        )}
                        {r.lines.length === 0 ? (
                          <p className="text-xs text-slate-400">Công tác này chưa có dòng hao phí.</p>
                        ) : (
                          (["VT", "NC", "TB"] as const).map((cat) => {
                            const list = r.lines.filter((l) => l.category === cat);
                            if (list.length === 0) return null;
                            return (
                              <div key={cat} className="mt-2">
                                <div className="text-xs font-semibold text-slate-700">{CAT_TITLE[cat]}</div>
                                <table className="mt-1 w-full text-xs">
                                  <thead className="text-left text-slate-400">
                                    <tr>
                                      <th className="w-40 py-0.5 font-medium">Mã</th>
                                      <th className="py-0.5 font-medium">Tên</th>
                                      <th className="w-16 py-0.5 font-medium">ĐVT</th>
                                      <th className="w-32 py-0.5 text-right font-medium">Định mức</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {list.map((l, i) => (
                                      <tr key={i} className="border-t border-slate-100 text-slate-700">
                                        <td className="py-0.5 text-slate-400">{l.code}</td>
                                        <td className="py-0.5">{l.name}</td>
                                        <td className="py-0.5">{l.unit}</td>
                                        <td className="py-0.5 text-right" title={l.formula ? "Công thức: =" + l.formula : undefined}>
                                          {l.formula && <span className="mr-1 text-[10px] font-bold text-violet-600">ƒ</span>}
                                          {fmtQty(l.quantity)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
