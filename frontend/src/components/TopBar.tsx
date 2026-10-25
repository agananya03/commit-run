"use client";

import React, { useState, useEffect } from "react";
import { Activity, Radio, Printer, ShieldCheck, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const TICKER_EVENTS = [
  "[SIMULATION] MIP-21 simulated: 2 critical unauthorized actions detected (ownership transfer & unlimited approval)",
  "[TIMELOCK] Meridian Governance Timelock delay active (48-hour execution window)",
  "[MEMPOOL] Treasury.approve(USDC, wallet 14, max) calldata detected in queue",
  "[ORACLE] Primary lending vault reserves synchronized across Layer 1: 8,000,000 USDC",
  "[GRAPH] Whales 18, 19, 20 hold 61.0% delegated voting power on active proposals",
];

export function TopBar() {
  const [currentEventIdx, setCurrentEventIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentEventIdx((prev) => (prev + 1) % TICKER_EVENTS.length);
    }, 4500);
    return () => clearInterval(timer);
  }, []);

  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  return (
    <header className="h-14 border-b border-slate-800 bg-slate-950 px-4 flex items-center justify-between gap-4 select-none">
      {/* Event Ticker Placeholder */}
      <div className="flex-1 flex items-center gap-2.5 overflow-hidden">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/60 text-indigo-300 font-mono text-[10px] uppercase font-bold flex-shrink-0">
          <Zap className="w-3 h-3 text-indigo-400 animate-pulse" />
          <span>Live Ticker</span>
        </div>

        <div className="truncate text-xs font-mono text-slate-300 transition-all duration-300">
          <span className="text-slate-500 mr-2">›</span>
          {TICKER_EVENTS[currentEventIdx]}
        </div>
      </div>

      {/* Chain Status Section */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="hidden md:flex items-center gap-2.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-slate-200">Ethereum Mainnet</span>
          </div>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">Block #19,842,910</span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400 flex items-center gap-1">
            <Activity className="w-3 h-3 text-slate-500" />
            18 Gwei
          </span>
        </div>

        {/* Mock Mode Tag */}
        <Badge className="bg-indigo-950/80 text-indigo-300 border border-indigo-800 font-mono text-[10px]">
          MOCK MODE
        </Badge>

        {/* Print / Export Report Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrint}
          className="no-print h-8 text-xs border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white gap-1.5"
          title="Print or export PDF report (hides sidebar)"
        >
          <Printer className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Export Report</span>
        </Button>
      </div>
    </header>
  );
}
