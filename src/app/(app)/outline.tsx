"use client";

import { useCallback, useEffect, useState } from "react";

// Thu gọn / mở rộng nhóm dòng giống "Group" của Excel cho các sheet TH Vật Tư / Nhân Công / Thiết Bị / Thầu Phụ và
// bảng tự do. Mỗi nhóm có id (đầu mục); nhóm thu gọn thì ẩn mọi dòng bên trong (kể cả nhóm con). Trạng thái nhớ
// theo từng sheet ở trình duyệt của người dùng (chỉ là cách xem, không đổi dữ liệu).
export function useOutline(storageKey: string) {
  const key = `outline:${storageKey}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc trạng thái đã lưu sau khi gắn (tránh lệch HTML server)
      if (v) setCollapsed(new Set(JSON.parse(v) as string[]));
    } catch {}
  }, [key]);
  const save = useCallback(
    (next: Set<string>) => {
      setCollapsed(next);
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {}
    },
    [key]
  );
  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    save(next);
  };
  return { collapsed, toggle, setAll: (ids: string[]) => save(new Set(ids)) };
}

// Ẩn / hiện từng dòng theo cây đầu mục: duyệt theo thứ tự trên bảng, mỗi đầu mục có cấp (0 = lớn nhất). Dòng bị ẩn khi
// có đầu mục cha (cấp nhỏ hơn, nằm trên nó) đang thu gọn. Trả về mảng true = ẩn, theo đúng thứ tự đầu vào.
export function outlineHidden(rows: { headingId?: string | null; level?: number }[], collapsed: Set<string>): boolean[] {
  const stack: { id: string; level: number }[] = [];
  return rows.map((r) => {
    if (r.headingId != null) {
      const lv = r.level ?? 0;
      while (stack.length && stack[stack.length - 1].level >= lv) stack.pop();
      const hidden = stack.some((s) => collapsed.has(s.id));
      stack.push({ id: r.headingId, level: lv });
      return hidden;
    }
    return stack.some((s) => collapsed.has(s.id));
  });
}

// Nút ▾ / ▸ ở dòng đầu mục
export function OutlineToggle({ open, onClick, count }: { open: boolean; onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={open ? "Thu gọn nhóm này" : `Mở nhóm này${count ? ` (${count} dòng đang ẩn)` : ""}`}
      className="mr-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-400 bg-white align-middle text-[10px] leading-none text-slate-700 hover:bg-slate-100 print:hidden"
    >
      {open ? "−" : "+"}
    </button>
  );
}

// Thanh cấp nhóm giống nút 1 2 3 bên trái Excel: "1" = chỉ thấy đầu mục cấp lớn nhất, "2" = thêm cấp 2..., "Mở hết"
export function OutlineBar({ levels, onLevel, onExpandAll }: { levels: number; onLevel: (lv: number) => void; onExpandAll: () => void }) {
  if (levels < 1) return null;
  const btn = "h-5 min-w-5 rounded border border-slate-300 bg-white px-1 text-[11px] text-slate-700 hover:bg-slate-100";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 print:hidden" title="Thu gọn / mở rộng nhóm như Group của Excel">
      Nhóm:
      {Array.from({ length: Math.min(levels, 5) }, (_, i) => (
        <button key={i} type="button" onClick={() => onLevel(i + 1)} className={btn} title={`Chỉ hiện đầu mục tới cấp ${i + 1}`}>
          {i + 1}
        </button>
      ))}
      <button type="button" onClick={onExpandAll} className={btn}>
        Mở hết
      </button>
    </span>
  );
}

// Thu gọn nhóm cho bảng do SERVER vẽ (VD sheet BOQ): dòng đầu mục gắn data-ol-head="<id>" + data-ol-level="<cấp>"
// (data-ol-fixed = dòng luôn hiện, VD Tổng cộng / VAT), nút thu gọn gắn data-ol-toggle="<id>". Thành phần này ẩn / hiện
// dòng trực tiếp trên bảng, tự áp lại khi bảng vẽ lại (sau khi lưu), và hiện thanh Nhóm 1 · 2 · 3.
export function DomOutline({ tableId, storageKey }: { tableId: string; storageKey: string }) {
  const outline = useOutline(storageKey);
  const [heads, setHeads] = useState<{ id: string; level: number }[]>([]);
  const { collapsed, toggle } = outline;
  useEffect(() => {
    const table = document.getElementById(tableId);
    const body = table?.querySelector("tbody");
    if (!table || !body) return;
    const apply = () => {
      const trs = Array.from(body.children) as HTMLElement[];
      const list = trs.map((tr) =>
        tr.dataset.olFixed !== undefined ? { headingId: `fixed:${tr.dataset.olHead}`, level: -1 } : tr.dataset.olHead ? { headingId: tr.dataset.olHead, level: Number(tr.dataset.olLevel ?? 0) } : {}
      );
      const hidden = outlineHidden(list, collapsed);
      trs.forEach((tr, i) => {
        const want = hidden[i] ? "none" : "";
        if (tr.style.display !== want) tr.style.display = want;
      });
      body.querySelectorAll<HTMLElement>("[data-ol-toggle]").forEach((b) => {
        const open = !collapsed.has(b.dataset.olToggle ?? "");
        const txt = open ? "−" : "+";
        if (b.textContent !== txt) b.textContent = txt;
        b.title = open ? "Thu gọn nhóm này" : "Mở nhóm này";
      });
      const hs = trs.filter((tr) => tr.dataset.olHead && tr.dataset.olFixed === undefined).map((tr) => ({ id: tr.dataset.olHead as string, level: Number(tr.dataset.olLevel ?? 0) }));
      setHeads((prev) => (prev.length === hs.length && prev.every((p, i) => p.id === hs[i].id && p.level === hs[i].level) ? prev : hs));
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(body, { childList: true });
    const onClick = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ol-toggle]");
      if (!b || !body.contains(b)) return;
      e.preventDefault();
      e.stopPropagation();
      toggle(b.dataset.olToggle as string);
    };
    body.addEventListener("click", onClick, true);
    return () => {
      mo.disconnect();
      body.removeEventListener("click", onClick, true);
    };
  }, [tableId, collapsed, toggle]);
  const levels = heads.reduce((m, h) => Math.max(m, h.level + 1), 0);
  return <OutlineBar levels={levels} onLevel={(lv) => outline.setAll(collapseToLevel(heads, lv))} onExpandAll={() => outline.setAll([])} />;
}

// Danh sách đầu mục cần thu gọn để chỉ còn thấy tới cấp lv (1 = cấp lớn nhất)
export const collapseToLevel = (heads: { id: string; level: number }[], lv: number) => heads.filter((h) => h.level >= lv - 1).map((h) => h.id);
