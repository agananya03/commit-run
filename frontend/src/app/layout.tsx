import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ProofOfIntent | Meridian DAO Governance Watchdog",
  description:
    "Autonomous governance watchdog detecting intent drift, conflict-of-interest graphs, and unauthorized calldata deviations for Meridian DAO.",
};

/** Shell shared by every route. The dashboard chrome (sidebar, top bar) lives in app/(app)/layout.tsx so the intro at "/" can be full-screen. */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-slate-950 text-slate-100 min-h-screen antialiased flex flex-col`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
