import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    // price-sheet PDFs and (later) EagleView reports and plan sets are uploaded through server actions
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
