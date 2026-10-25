import { AmbientBackground } from "@/components/fx/AmbientBackground";
import { ChatAssistant } from "@/components/chat/ChatAssistant";
import { MonitorStrip } from "@/components/shell/MonitorStrip";
import { NavRail } from "@/components/shell/NavRail";

/**
 * App chrome for /dashboard and /proposals/*: a fixed narrow rail, a sticky monitoring strip, and the page
 * scrolling on the window (so scroll-driven animations can follow it). The route group "(app)" is not in URLs.
 * `isolate` makes this the stacking context, so the ambient layer (z -10) paints above this background.
 */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="relative isolate min-h-screen w-full bg-canvas font-forensic text-ink">
      <AmbientBackground />
      <NavRail />
      <div className="pl-16">
        <MonitorStrip />
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-4 sm:px-8">{children}</main>
      </div>
      {/* in the layout, so the conversation survives navigation between pages */}
      <ChatAssistant />
    </div>
  );
}
