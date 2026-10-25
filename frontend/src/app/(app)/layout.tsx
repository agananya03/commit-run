import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

/** Dashboard chrome for /dashboard and /proposals/*. The route group "(app)" does not appear in URLs. */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Left sidebar listing proposals (hidden on print) */}
      <Sidebar />

      {/* Main view container */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto bg-slate-950 p-4 sm:p-6 flex flex-col justify-between">
          <div className="w-full max-w-7xl mx-auto">{children}</div>

          {/* Projector-Optimized Footer with SYNTHETIC DATA label */}
          <footer className="mt-10 pt-4 pb-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-slate-500 w-full max-w-7xl mx-auto">
            <div className="flex items-center gap-2.5">
              <span className="px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/50 font-bold uppercase tracking-wider text-[10px] shadow-sm">
                SYNTHETIC DATA
              </span>
              <span className="text-slate-400">
                Meridian DAO Governance Watchdog • Testnet Simulation Environment
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              Scenarios MIP-12, MIP-17 &amp; MIP-21 simulated for automated safety audit
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
