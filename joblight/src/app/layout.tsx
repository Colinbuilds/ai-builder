import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Joblight — the AI-run CRM for the trades", template: "%s · Joblight" },
  description: "Jobs, estimates, scheduling, invoicing and an AI assistant that knows your shop's rules. Built for HVAC, electrical, roofing, irrigation, detailing, mechanics and every trade in between.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
