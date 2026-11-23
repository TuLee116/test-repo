import Link from "next/link";
import { Empty } from "@/components/ui";

export default function NotFound() {
  return (
    <Empty>
      Trang này chưa được dựng lại trong bản mới, hoặc không có dữ liệu.
      <br />
      <Link href="/projects" className="text-blue-700 hover:underline">Về Tổng quan dự án</Link>
    </Empty>
  );
}
