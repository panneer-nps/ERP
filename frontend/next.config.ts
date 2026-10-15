import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.ERP_NEXT_DIST_DIR ?? ".next",
  async rewrites() {
    const apiOrigin = (process.env.ERP_API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
  ...(process.env.ERP_NEXT_BUILD_CPUS ? { experimental: { cpus: Number(process.env.ERP_NEXT_BUILD_CPUS) } } : {}),
};
export default nextConfig;
