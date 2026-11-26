// Loại gói thầu của dự án (dùng cả server lẫn client)
export const PACKAGE_TYPES = [
  { value: "THO", label: "Phần Thô" },
  { value: "HOAN_THIEN", label: "Hoàn Thiện" },
  { value: "NOI_THAT", label: "Nội Thất" },
  { value: "MEP", label: "MEP" },
  { value: "TONG_THAU", label: "Tổng Thầu" },
] as const;

export const normalizePackageType = (v: unknown): string => (PACKAGE_TYPES.some((t) => t.value === v) ? String(v) : "THO");
