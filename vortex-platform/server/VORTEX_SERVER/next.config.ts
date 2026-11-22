import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the workspace root to THIS app (nested inside another Next.js repo,
  // turbopack would otherwise infer the parent folder as root and break @/ imports).
  turbopack: {
    root: __dirname,
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
