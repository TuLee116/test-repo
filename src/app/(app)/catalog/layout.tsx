import { hasApp } from "@/lib/access";
import NoAppAccess from "../NoAppAccess";

// Định mức thuộc chương trình DT-CP
export default async function CatalogLayout({ children }: { children: React.ReactNode }) {
  if (!(await hasApp("DTCP"))) return <NoAppAccess app="DT-CP" />;
  return children;
}
