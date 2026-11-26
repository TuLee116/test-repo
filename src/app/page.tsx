import { redirect } from "next/navigation";
import { homeHref } from "@/lib/access";

// Vào trang đầu tiên của chương trình người dùng được phép (DT-CP / Mua vật tư / Đệ trình giá đội)
export default async function Home() {
  redirect(await homeHref());
}
