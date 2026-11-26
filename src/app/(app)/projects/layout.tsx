import { hasApp } from "@/lib/access";
import NoAppAccess from "../NoAppAccess";

// Chương trình DT-CP: chỉ tài khoản được tick "DT-CP" (hoặc quản trị)
export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  if (!(await hasApp("DTCP"))) return <NoAppAccess app="DT-CP" />;
  return children;
}
