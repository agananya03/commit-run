"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert, AlertTriangle, CheckCircle2, Shield, Layers, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ProposalNav {
  slug: string;
  title: string;
  category: string;
  status: string;
  risk: "CRITICAL" | "HIGH" | "LOW";
}

const PROPOSALS: ProposalNav[] = [
  {
    slug: "MIP-21",
    title: "VaultV2: storage packing",
    category: "Core Upgrade",
    status: "Voting Active",
    risk: "CRITICAL",
  },
  {
    slug: "MIP-17",
    title: "Nexus Labs Acceleration",
    category: "Growth Grant",
    status: "Voting Active",
    risk: "HIGH",
  },
  {
    slug: "MIP-12",
    title: "Developer SDK & Indexer",
    category: "Tooling Grant",
    status: "Executed",
    risk: "LOW",
  },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();

  const getRiskBadge = (risk: string) => {
    switch (risk) {
      case "CRITICAL":
        return (
          <Badge className="bg-red-950/80 text-red-400 border border-red-500/60 text-[10px] font-mono px-1.5 py-0">
            CRITICAL
          </Badge>
        );
      case "HIGH":
        return (
          <Badge className="bg-amber-950/80 text-amber-400 border border-amber-500/60 text-[10px] font-mono px-1.5 py-0">
            HIGH
          </Badge>
        );
      default:
        return (
          <Badge className="bg-slate-800 text-slate-400 border border-slate-700 text-[10px] font-mono px-1.5 py-0">
            LOW
          </Badge>
        );
    }
  };

  return (
    <aside
      className={cn(
        "w-64 flex-shrink-0 border-r border-slate-800 bg-slate-950 flex flex-col justify-between select-none",
        className
      )}
    >
      <div className="flex flex-col">
        {/* Brand Header */}
        <div className="h-16 px-4 border-b border-slate-800 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 group-hover:border-indigo-400 transition-colors">
              <Shield className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <span className="font-bold text-sm text-slate-100 tracking-tight block">ProofOfIntent</span>
              <span className="text-[10px] text-slate-500 font-mono tracking-wider uppercase block">Meridian DAO</span>
            </div>
          </Link>
        </div>

        {/* Navigation Section */}
        <div className="px-3 py-4 space-y-1">
          <div className="px-2 pb-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500">
            Navigation
          </div>
          <Link
            href="/dashboard"
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors",
              pathname === "/dashboard"
                ? "bg-indigo-950/60 text-indigo-300 border border-indigo-800/60"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            )}
          >
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>All Proposals</span>
          </Link>
        </div>

        {/* Proposals List Section */}
        <div className="px-3 py-2 space-y-1">
          <div className="px-2 pb-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>Governance Proposals</span>
            <span className="text-[9px] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">3 total</span>
          </div>

          <div className="space-y-1">
            {PROPOSALS.map((p) => {
              const isActive = pathname === `/proposals/${p.slug}`;
              return (
                <Link
                  key={p.slug}
                  href={`/proposals/${p.slug}`}
                  className={cn(
                    "block px-3 py-2.5 rounded-lg border transition-all text-left",
                    isActive
                      ? "bg-slate-900 border-indigo-500/60 shadow-sm"
                      : "border-slate-800/80 bg-slate-950/40 hover:bg-slate-900/60 hover:border-slate-700"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={cn(
                        "font-mono text-xs font-bold",
                        isActive ? "text-indigo-400" : "text-slate-300"
                      )}
                    >
                      {p.slug}
                    </span>
                    {getRiskBadge(p.risk)}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate leading-snug">
                    {p.title}
                  </div>
                  <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-slate-800/60 text-[10px] text-slate-500">
                    <span>{p.category}</span>
                    <span className="font-mono text-[9px]">{p.status}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Protocol Health Sidebar Footer */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/80">
        <div className="rounded-lg bg-slate-900/60 border border-slate-800 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
            <Landmark className="w-3.5 h-3.5 text-indigo-400" />
            <span>Meridian Reserves</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <div>
              <span className="text-slate-500 block">Treasury</span>
              <span className="text-slate-200 font-semibold">$20,000,000</span>
            </div>
            <div>
              <span className="text-slate-500 block">Vault</span>
              <span className="text-slate-200 font-semibold">$8,000,000</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
