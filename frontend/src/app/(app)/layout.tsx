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
        <main className="flex-1 overflow-y-auto bg-slate-950 p-6">{children}</main>
      </div>
    </div>
  );
}
