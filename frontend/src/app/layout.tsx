import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ProofOfIntent | Meridian DAO Governance Watchdog",
  description:
    "Autonomous governance watchdog detecting intent drift, conflict-of-interest graphs, and unauthorized calldata deviations for Meridian DAO.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-slate-950 text-slate-100 min-h-screen antialiased flex flex-col`}>
        <Providers>
          <div className="flex h-screen w-screen overflow-hidden">
            {/* Left sidebar listing proposals (hidden on print) */}
            <Sidebar />

            {/* Main view container */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <TopBar />
              <main className="flex-1 overflow-y-auto bg-slate-950 p-6">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
