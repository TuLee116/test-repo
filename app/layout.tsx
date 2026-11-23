import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin", "latin-ext"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Khối Kinh Tế Kế Hoạch - Tân Minh Nhân",
  description: "Quản lý DT-CP, giá đội, thầu phụ, định mức",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-3 px-3 py-2">
            <Link href="/projects" className="flex items-center gap-2">
              <Image src="/tmn-logo.png" alt="TMN" width={36} height={36} priority />
              <div className="leading-tight">
                <div className="text-sm font-bold tracking-wide text-blue-900">KHỐI KINH TẾ KẾ HOẠCH</div>
                <div className="text-[11px] text-slate-500">CÔNG TY CP XD KIẾN TRÚC TÂN MINH NHÂN</div>
              </div>
            </Link>
            <div className="ml-auto text-xs text-slate-500">Bản dựng lại · dữ liệu đến 23/11/2026 (chỉ xem)</div>
          </div>
        </header>
        <div className="flex flex-1 flex-col md:flex-row">
          <aside className="border-b border-slate-200 bg-white p-2 md:sticky md:top-[53px] md:h-[calc(100vh-53px)] md:w-72 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
            <Sidebar />
          </aside>
          <main className="min-w-0 flex-1 p-4">{children}</main>
        </div>
      </body>
    </html>
  );
}
