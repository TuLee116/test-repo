// Tự đánh số STT cho bảng tự do (GRID): cột đầu = STT, cột thứ 2 = tên công việc. Dòng nào có tên công việc thì được
// đánh số 1, 2, 3... và về 1 lại sau mỗi dòng đầu mục. Hàm thuần, dùng được cả server lẫn client.

export const isSttTitle = (t: string | undefined) => /^\s*(stt|tt)\s*$/i.test(t ?? "");

// Bảng đang bật tự đánh số không: gán tay (autoStt true/false) thì theo đó, chưa gán thì nhận theo tên cột đầu
export const effectiveAutoStt = (autoStt: boolean | null | undefined, firstColTitle: string | undefined, nCols: number) =>
  nCols >= 2 && (autoStt ?? isSttTitle(firstColTitle));

// Số STT mong muốn của từng dòng dữ liệu (không gồm dòng đầu mục): "" = chưa có tên công việc nên chưa đánh số
export function computeAutoStt(rowCount: number, headingRows: Set<number>, nameOf: (row: number) => string): Map<number, string> {
  const out = new Map<number, string>();
  let n = 0;
  for (let r = 0; r < rowCount; r++) {
    if (headingRows.has(r)) {
      n = 0;
      continue;
    }
    if (nameOf(r).trim() !== "") out.set(r, String(++n));
    else out.set(r, "");
  }
  return out;
}
