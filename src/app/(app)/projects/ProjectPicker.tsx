"use client";

import { useState } from "react";

export type ExistingProject = { name: string; investor: string; location: string; packages: string[] };

const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";
const label = "block text-sm font-medium text-slate-700";

// Tên dự án + gói thầu ở form tạo mới: 1 dự án có thể có nhiều gói thầu (mỗi gói = 1 DT-CP). Chọn
// "Dự án đang có" thì lấy đúng tên dự án đã dùng (không gõ lại dễ lệch chữ) và điền sẵn Tổng Thầu /
// Địa điểm của dự án đó (vẫn sửa được).
export default function ProjectPicker({ projects }: { projects: ExistingProject[] }) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [picked, setPicked] = useState<ExistingProject | null>(null);
  const [investor, setInvestor] = useState("");
  const [location, setLocation] = useState("");

  return (
    <>
      <div className="sm:col-span-1 lg:col-span-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className={label}>Dự án *</span>
          {(["new", "existing"] as const).map((m) => (
            <label key={m} className={`flex items-center gap-2 text-sm ${m === "existing" && !projects.length ? "cursor-not-allowed text-slate-400" : "cursor-pointer"}`}>
              <input
                type="radio"
                checked={mode === m}
                disabled={m === "existing" && !projects.length}
                onChange={() => {
                  setMode(m);
                  setPicked(null);
                }}
              />
              {m === "new" ? "Dự án mới" : "Dự án đang có (thêm gói thầu mới)"}
            </label>
          ))}
        </div>
        {mode === "new" ? (
          <input name="name" required placeholder="Tên dự án" className={input} />
        ) : (
          <>
            <select
              name="name"
              required
              value={picked?.name ?? ""}
              onChange={(e) => {
                const p = projects.find((x) => x.name === e.target.value) ?? null;
                setPicked(p);
                setInvestor(p?.investor ?? "");
                setLocation(p?.location ?? "");
              }}
              className={input}
            >
              <option value="">— Chọn dự án —</option>
              {projects.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.packages.length} gói thầu)
                </option>
              ))}
            </select>
            {picked && (
              <p className="mt-1 text-xs text-slate-500">
                Các gói thầu đã có: {picked.packages.map((x) => x || "(chưa đặt tên gói)").join(" · ")}
              </p>
            )}
          </>
        )}
      </div>
      <div className="sm:col-span-1 lg:col-span-2">
        <label className={label}>Tên gói thầu{mode === "existing" ? " *" : ""}</label>
        <input name="packageName" required={mode === "existing"} placeholder={mode === "existing" ? "Tên gói thầu mới của dự án này" : ""} className={input} />
      </div>
      <div>
        <label className={label}>Tổng Thầu</label>
        <input name="investor" value={investor} onChange={(e) => setInvestor(e.target.value)} className={input} />
      </div>
      <div>
        <label className={label}>Địa điểm xây dựng</label>
        <input name="location" value={location} onChange={(e) => setLocation(e.target.value)} className={input} />
      </div>
    </>
  );
}
