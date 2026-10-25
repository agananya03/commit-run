"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, AlertOctagon, Landmark, Database } from "lucide-react";

interface HeaderProps {
  selectedProposal: string;
  onSelectProposal: (id: string) => void;
  isFlagged: boolean;
}

export function Header({
  selectedProposal,
  onSelectProposal,
  isFlagged,
}: HeaderProps) {
  return (
    <header className="border-b border-slate-800 bg-slate-950/70 backdrop-blur-xl sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                ProofOfIntent
              </h1>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider py-0">
                Meridian DAO Watchdog
              </Badge>
            </div>
            <p className="text-xs text-slate-400">
              Autonomous Governance Risk Engine & Timelock Guard
            </p>
          </div>
        </div>

        {/* Treasury & Vault Stats */}
        <div className="flex items-center space-x-6 text-xs bg-slate-900/60 border border-slate-800 px-4 py-2 rounded-xl">
          <div className="flex items-center space-x-2">
            <Landmark className="h-4 w-4 text-emerald-400" />
            <div>
              <p className="text-slate-400">DAO Treasury</p>
              <p className="font-semibold text-white">20,000,000 USDC</p>
            </div>
          </div>
          <div className="h-6 w-px bg-slate-800" />
          <div className="flex items-center space-x-2">
            <Database className="h-4 w-4 text-indigo-400" />
            <div>
              <p className="text-slate-400">Protocol Vault</p>
              <p className="font-semibold text-white">8,000,000 USDC</p>
            </div>
          </div>
        </div>

        {/* Proposal Switcher & Status */}
        <div className="flex items-center space-x-3">
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
            {["MIP-12", "MIP-17", "MIP-21"].map((id) => (
              <button
                key={id}
                onClick={() => onSelectProposal(id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  selectedProposal === id
                    ? "bg-indigo-600 text-white shadow-md"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                {id}
              </button>
            ))}
          </div>

          {isFlagged ? (
            <Badge variant="destructive" className="flex items-center space-x-1.5 px-3 py-1 animate-pulse">
              <AlertOctagon className="h-3.5 w-3.5" />
              <span>TIMELOCK FLAGGED</span>
            </Badge>
          ) : (
            <Badge variant="success" className="flex items-center space-x-1.5 px-3 py-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>EXECUTION VERIFIED</span>
            </Badge>
          )}
        </div>
      </div>
    </header>
  );
}
