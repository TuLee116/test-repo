import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mở bản dev từ máy khác trong mạng nội bộ (VD http://192.168.2.155:3210): Next mặc định chặn tải JS/HMR qua IP LAN → trang không bấm được
  allowedDevOrigins: ["192.168.2.155", "192.168.*.*"],
  // pdfkit đọc file font / AFM từ node_modules lúc chạy → không gom vào bundle
  serverExternalPackages: ["pdfkit"],
  experimental: {
    // Nhập định mức từ Excel gửi cả danh sách công tác + hao phí (hàng nghìn dòng) qua Server Action: mặc định chỉ 1MB nên bị từ chối
    serverActions: { bodySizeLimit: "50mb" },
    // proxy.ts (kiểm tra đăng nhập) giữ tạm nội dung gửi lên trong bộ nhớ, mặc định chỉ 10MB → file Excel >10MB bị cắt cụt
    // ("Unexpected end of form"). Nâng bằng giới hạn Server Action.
    proxyClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
