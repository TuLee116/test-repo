import "server-only";
import fs from "node:fs";
import path from "node:path";
import { cache } from "react";

// Data layer: reads the JSON exported from the old site (see /data).
// Replace these functions with database queries when moving to a real DB.
const DATA = path.join(process.cwd(), "data");

const read = cache(<T,>(rel: string): T | null => {
  const f = path.join(DATA, rel);
  if (!f.startsWith(DATA) || !fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf8")) as T;
});

export type Area = string;

export type SidebarPackage = { key: string; href: string; label: string; sub?: string; excel?: boolean };
export type SidebarData = {
  groups: (
    | { key: "dtcp"; label: string; tree: { area: Area; projects: { name: string; packages: SidebarPackage[] }[] }[]; footer: { href: string; label: string }[] }
    | { key: string; label: string; links: { href: string; label: string; count?: number; hint?: string }[] }
  )[];
};

export type Stat = {
  id: string; name: string; packageName: string; packageType: string; area: Area; creator: string; year: number;
  revenue: number; cost: number; parts: { vl: number; nc: number; m: number; tp: number; other: number };
};

export type ContractSummary = {
  id: string; area: Area; name: string; packageName: string; contractNo: string; appendixNo: string; appendixOfId: string;
  source: string; approvedVersion: number | null; lineCount: number; versionCount: number;
};
export type Contract = ContractSummary & {
  versions: { n: number; label: string; approved: boolean }[];
  lines: { key: string; name?: string; unit?: string; qty?: number; prices: Record<string, number | null> }[];
};

export type GiaDoiSummary = {
  id: string; no: string; kind: "IN" | "OUT"; status: string; revision: number; contractId: string | null;
  projectName: string; contractNo: string; itemName: string; batch: string; batchDate: string; category: string;
  lineCount: number; siteAmount: number; apprAmount: number;
};
export type GiaDoiLine = {
  id: string; level: "GROUP" | "SUB" | "ITEM"; stt: string; content: string; unit: string; qty: number | null;
  cdtPrice: number | null; basePrice: number | null; sitePrice: number | null; siteAmount: number | null; siteNote: string;
  tpPrice: number | null; apprAmount: number | null; tpNote: string; qsNote: string;
};
export type GiaDoi = {
  id: string; no: string; kind: "IN" | "OUT"; status: string; revision: number; contractId: string | null;
  head: { projectName: string; contractNo: string; itemName: string; batch: string; batchDate: string; category: string; crewName: string; qsNote: string; tpNote: string };
  lines: GiaDoiLine[];
};

export type ThauPhuSummary = {
  id: string; no: string; area: Area; branch: string; category: string; projectName: string; itemName: string; subName: string;
  cdtContract: string; proposalType: string; revision: number; lineCount: number; hdNo: string | null;
};
export type ThauPhuLine = {
  id: string; level: string; stt: string; content: string; unit: string;
  cdtQty: number | null; cdtPrice: number | null; baseQty: number | null; basePrice: number | null;
  propQty: number | null; propPrice: number | null; tpPrice: number | null; bids: Record<string, { qty: number | null; price: number | null }>; note: string;
};
export type ThauPhu = {
  id: string; no: string; category: string; branch: string; branchReason: string; revision: number; reviewNote: string;
  head: { area: Area; projectName: string; itemName: string; subName: string; cdtContract: string; selectedBidder: string; vat: Record<string, number>;
    terms: { label: string; cdt: string; base: string; prop: string; appr: string }[] };
  lines: ThauPhuLine[]; bidders: { key: string; name: string }[]; hd: { no: string; at: string } | null;
};

export type CatalogRow = {
  id: string; code: string; name: string; unit: string; section: string; subsection: string;
  lines: { id: string; category: string; code: string; name: string; unit: string; quantity: number; formula: string | null }[];
};

export type Project = {
  id: string; totalA: number | null; totalB: number | null; vatRate: number | null;
  rows: { id: string; parentId: string | null; section: string; depth: number; code: string; name: string; unit: string; amount: number; note: string; isLeaf: boolean }[] | null;
  status: { status: string; submitted: string; approved: string; contractNo: string; qsttName: string; logs: { at: string; action: string; user: string; note: string }[] } | null;
  boq: { id: string; stt: string; rawDescription: string; rawUnit: string; quantity: number; isHeading: boolean; workItemCode: string | null; workItemName: string | null }[];
};

export type Users = {
  roles: { value: string; label: string; short: string }[];
  users: { id: string; name: string; username: string; roles: string[] }[];
};

const isId = (id: string) => /^c[a-z0-9]{24}$/.test(id);

export const getSidebar = () => read<SidebarData>("sidebar.json")!;
export const getStats = () => read<Stat[]>("stats.json") ?? [];
export const getContracts = () => read<ContractSummary[]>("contracts.json") ?? [];
export const getContract = (id: string) => (isId(id) ? read<Contract>(`contracts/${id}.json`) : null);
export const getGiaDoiList = () => read<GiaDoiSummary[]>("gia-doi.json") ?? [];
export const getGiaDoi = (id: string) => (isId(id) ? read<GiaDoi>(`gia-doi/${id}.json`) : null);
export const getThauPhuList = () => read<ThauPhuSummary[]>("thau-phu.json") ?? [];
export const getThauPhu = (id: string) => (isId(id) ? read<ThauPhu>(`thau-phu/${id}.json`) : null);
export const getCatalog = () => read<CatalogRow[]>("catalog.json") ?? [];
export const getProject = (id: string) => (isId(id) ? read<Project>(`projects/${id}.json`) : null);
export const getUsers = () => read<Users>("users.json")!;
