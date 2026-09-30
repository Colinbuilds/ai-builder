import type { NextConfig } from "next";

// Customer, crew and signing pages are opened by secret links, so no page leaks its URL to other sites,
// and no page can be framed by another site.
const securityHeaders = [
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  poweredByHeader: false,
  experimental: {
    // price-sheet PDFs and (later) EagleView reports and plan sets are uploaded through server actions
    serverActions: { bodySizeLimit: "50mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
