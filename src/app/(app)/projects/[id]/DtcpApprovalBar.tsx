"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTaskWorkspace } from "../../TaskWorkspace";
import { DTCP_STATUS, DTCP_TPS, type TpMarks } from "@/lib/dtcp-approval";
import SitePicker from "../../du-an/SitePicker";
import type { SiteOpt } from "@/lib/project-site-calc";
import { ptgApproveDtcpAction, qsttForwardDtcpAction, qsttSendDtcpAction, recallDtcpAction, reopenDtcpAction, returnDtcpAction, submitDtcpAction, tpAgreeDtcpAction } from "@/lib/dtcp-approval-actions";

export type DtcpLog = { at: string; action: string; user: string; note: string };

// Thanh trình duyệt DT-CP: trạng thái, các nút theo quyền người xem, lịch sử
export default function DtcpApprovalBar(props: {
  projectId: string;
  status: string;
  tp: TpMarks;
  note: string;
  submitted: string;
  approved: string;
  can: { edit: boolean; qstt: boolean; ptg: boolean; tp: string[] };
  logs: DtcpLog[];
  contractNo: string; // số hợp đồng (bắt buộc nhập khi trình)
  sites: SiteOpt[]; // DANH MỤC DỰ ÁN — bắt buộc chọn khi trình (đang lập để đấu thầu thì chưa cần)
  siteId: string;
  projectName: string;
  area: string;
  qsttOptions: { id: string; name: string }[]; // QSTT để QSĐT chọn khi trình
  qsttId: string;
  qsttName: string;
  sticky?: boolean; // trong cửa sổ làm việc toàn màn hình: dính đáy
  tpKey: string; // Trưởng phòng được QSTT chọn duyệt (trống = DT-CP cũ trình 3 TP)
}) {
  const { projectId, status, tp, can } = props;
  const router = useRouter();
  const ws = useTaskWorkspace(); // trong cửa sổ làm việc toàn màn hình: xong tác vụ thì về màn hình chính
  const [pending, start] = useTransition();
  const [showLog, setShowLog] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [pickTp, setPickTp] = useState<string>(props.tpKey);
  const [contractNo, setContractNo] = useState(props.contractNo);
  const [siteId, setSiteId] = useState(props.siteId);
  const [qsttId, setQsttId] = useState(props.qsttOptions.some((q) => q.id === props.qsttId) ? props.qsttId : props.qsttOptions.length === 1 ? props.qsttOptions[0].id : "");
  const st = DTCP_STATUS[status] ?? DTCP_STATUS.DRAFT;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, confirmMsg?: string, doneMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    start(async () => {
      const r = await fn();
      if (!r.ok) return window.alert(r.error);
      if (ws && doneMsg) return ws.done(doneMsg);
      router.refresh();
    });
  };
  const ask = (msg: string, required = false) => {
    const v = window.prompt(msg, "");
    if (v === null) return null;
    if (required && !v.trim()) {
      window.alert("Cần ghi nội dung");
      return null;
    }
    return v;
  };

  const btn = "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50";
  const myTps = DTCP_TPS.filter((t) => can.tp.includes(t.key) && !tp[t.key]);
  const holder = (status === "QSTT" && can.qstt) || (status === "TP" && can.tp.length > 0) || (status === "PTG" && can.ptg);

  return (
    <div className={props.sticky ? "sticky bottom-0 z-20 flex flex-wrap items-center gap-2 border border-slate-300 bg-slate-50 px-4 py-2 text-sm shadow-[0_-4px_12px_rgba(15,23,42,0.12)]" : "flex flex-wrap items-center gap-2 border border-b-0 border-slate-200 bg-slate-50 px-4 py-2 text-sm"}>
      <span className="font-medium text-slate-600">Duyệt DT-CP:</span>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
      {status === "TP" && props.tpKey && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800">Chờ {DTCP_TPS.find((t) => t.key === props.tpKey)?.label} duyệt</span>}
      {status === "TP" && !props.tpKey &&
        DTCP_TPS.map((t) => (
          <span key={t.key} className={`rounded-full px-2 py-0.5 text-xs ${tp[t.key] ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-500 ring-1 ring-slate-200"}`} title={tp[t.key] ? `${tp[t.key]!.by} — ${new Date(tp[t.key]!.at).toLocaleString("vi-VN")}` : "chưa xem"}>
            {tp[t.key] ? "✔ " : "○ "}
            {t.label}
          </span>
        ))}
      {props.contractNo && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">HĐ số: {props.contractNo}</span>}
      {status === "QSTT" && props.qsttName && <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">QSTT kiểm tra: {props.qsttName}</span>}
      {status === "APPROVED" && props.approved && <span className="text-xs text-emerald-700">{props.approved}</span>}
      {status !== "DRAFT" && status !== "APPROVED" && props.submitted && <span className="text-xs text-slate-500">{props.submitted}</span>}
      {status === "DRAFT" && props.note && <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">↩ {props.note}</span>}
      {status !== "DRAFT" && <span className="text-xs text-slate-400">· DT-CP đang khoá, không sửa được</span>}

      <span className="flex-1" />

      {status === "DRAFT" && can.edit && (
        <button disabled={pending} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`} onClick={() => setShowSubmit((x) => !x)}>
          📤 Trình DT-CP
        </button>
      )}
      {status === "DRAFT" && can.edit && showSubmit && (
        <div className="mt-1 flex w-full flex-wrap items-end gap-3 rounded-md border border-blue-200 bg-white p-3">
          <div className="text-xs">
            <span className="block font-medium text-slate-700">Dự án (mã dự án) *</span>
            <SitePicker
              sites={props.sites}
              value={siteId}
              area={props.area}
              invalid
              className="mt-1 w-96 py-1 text-sm"
              placeholder={`Chọn dự án trong danh mục — DT-CP đang ghi “${props.projectName}”`}
              onChange={(s) => setSiteId(s?.id ?? "")}
            />
          </div>
          <label className="text-xs">
            <span className="block font-medium text-slate-700">Số hợp đồng *</span>
            <input value={contractNo} onChange={(e) => setContractNo(e.target.value)} placeholder="VD 200/2026/HĐ/OCC-QN" className={`mt-1 w-64 rounded border px-2 py-1.5 text-sm ${contractNo.trim() ? "border-slate-300" : "border-red-400 bg-red-50"}`} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-slate-700">QSTT kiểm tra *</span>
            <select value={qsttId} onChange={(e) => setQsttId(e.target.value)} className={`mt-1 w-64 rounded border px-2 py-1.5 text-sm ${qsttId ? "border-slate-300" : "border-red-400 bg-red-50"}`}>
              <option value="">— Chọn QSTT —</option>
              {props.qsttOptions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={pending || !contractNo.trim() || !qsttId || !siteId}
            className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}
            onClick={() => act(() => submitDtcpAction(projectId, contractNo, qsttId, siteId), "Trình DT-CP này cho QSTT kiểm tra? Trong lúc trình, DT-CP sẽ bị khoá không sửa được.", "Đã trình DT-CP cho QSTT")}
          >
            Trình cho QSTT
          </button>
          <button type="button" disabled={pending} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`} onClick={() => setShowSubmit(false)}>
            Huỷ
          </button>
          {!props.qsttOptions.length && <span className="text-xs text-red-600">Chưa có tài khoản nào được cấp quyền QSTT cho khu vực này — nhờ quản trị cấp quyền.</span>}
        </div>
      )}
      {status === "QSTT" && can.qstt && (
        <>
          <select value={pickTp} onChange={(e) => setPickTp(e.target.value)} className={`rounded-md border px-2 py-1.5 text-sm ${pickTp ? "border-slate-300" : "border-red-400 bg-red-50"}`}>
            <option value="">— Chọn Trưởng phòng duyệt —</option>
            {DTCP_TPS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            disabled={pending || !pickTp}
            className={`${btn} bg-amber-600 text-white hover:bg-amber-700`}
            onClick={() => {
              const n = ask(`QSTT đã kiểm tra — ghi chú khi trình ${DTCP_TPS.find((t) => t.key === pickTp)?.label ?? "Trưởng phòng"} (có thể để trống):`);
              if (n !== null) act(() => qsttForwardDtcpAction(projectId, pickTp, n), undefined, "Đã trình Trưởng phòng duyệt");
            }}
          >
            ✔ Đã kiểm tra, trình Trưởng phòng
          </button>
        </>
      )}
      {status === "TP" &&
        myTps.filter((t) => !props.tpKey || t.key === props.tpKey).map((t) => (
          <button
            key={t.key}
            disabled={pending}
            className={`${btn} bg-sky-700 text-white hover:bg-sky-800`}
            onClick={() => {
              const n = ask(props.tpKey ? `${t.label} duyệt DT-CP (DT-CP có hiệu lực, chuyển QSTT gửi công trình) — ý kiến (có thể để trống):` : `${t.label}: đã xem, đồng ý trình Phó Tổng — ý kiến (có thể để trống):`);
              if (n !== null) act(() => tpAgreeDtcpAction(projectId, t.key, n), undefined, "Đã duyệt DT-CP");
            }}
          >
            {props.tpKey ? `✔ ${t.label} duyệt DT-CP` : `✔ ${t.label} đồng ý trình Phó Tổng`}
          </button>
        ))}
      {status === "TPOK" && can.qstt && (
        <button
          disabled={pending}
          className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800`}
          onClick={() => {
            const n = ask("QSTT gửi DT-CP (đã được Trưởng phòng duyệt, có hiệu lực) cho công trình — ghi chú (có thể để trống):");
            if (n !== null) act(() => qsttSendDtcpAction(projectId, n), undefined, "Đã gửi DT-CP cho công trình");
          }}
        >
          📨 Gửi công trình
        </button>
      )}
      {status === "PTG" && can.ptg && (
        <button
          disabled={pending}
          className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800`}
          onClick={() => {
            const n = ask("Phó Tổng duyệt DT-CP — ý kiến (có thể để trống):");
            if (n !== null) act(() => ptgApproveDtcpAction(projectId, n), undefined, "Đã duyệt DT-CP");
          }}
        >
          ✔ Duyệt DT-CP
        </button>
      )}
      {holder && (
        <button
          disabled={pending}
          className={`${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`}
          onClick={() => {
            const n = ask("Lý do trả lại cho QSĐT điều chỉnh:", true);
            if (n !== null) act(() => returnDtcpAction(projectId, n), undefined, "Đã trả DT-CP lại cho QSĐT");
          }}
        >
          ↩ Trả lại
        </button>
      )}
      {["QSTT", "TP", "PTG"].includes(status) && can.edit && (
        <button disabled={pending} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`} onClick={() => act(() => recallDtcpAction(projectId), "Rút DT-CP về để điều chỉnh? Phải trình lại từ đầu.")}>
          Rút lại
        </button>
      )}
      {(status === "APPROVED" || status === "TPOK") && can.edit && (
        <button
          disabled={pending}
          className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
          onClick={() => {
            const n = ask("DT-CP đã được Phó Tổng duyệt. Lý do mở lại để điều chỉnh (sau khi sửa phải trình duyệt lại):", true);
            if (n !== null) act(() => reopenDtcpAction(projectId, n));
          }}
        >
          🔓 Mở lại để điều chỉnh
        </button>
      )}
      {props.logs.length > 0 && (
        <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setShowLog((x) => !x)}>
          {showLog ? "Ẩn lịch sử" : `Lịch sử (${props.logs.length})`}
        </button>
      )}
      {showLog && (
        <ol className="mt-1 w-full space-y-0.5 border-t border-slate-200 pt-1 text-xs text-slate-600">
          {props.logs.map((l, i) => (
            <li key={i}>
              <span className="text-slate-400">{l.at}</span> · <b>{l.user}</b>: {l.action}
              {l.note && <span className="italic text-slate-500"> — {l.note}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
