import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.ERP_NEXT_DIST_DIR ?? ".next",
  ...(process.env.ERP_NEXT_BUILD_CPUS ? { experimental: { cpus: Number(process.env.ERP_NEXT_BUILD_CPUS) } } : {}),
};
export default nextConfig;
