"use client";

import { useState } from "react";
import { Check, Copy, FileCode2, FileSignature, FileText, MessagesSquare, ScrollText, ShieldQuestion } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEvidencePanel } from "@/components/EvidencePanel";
import { Rise } from "@/components/fx/Motion";
import { shortAddr } from "@/lib/radar";
import type { EvidenceFile, ProposalVersion } from "@/types/shared";

const KIND: Record<string, { label: string; Icon: typeof FileText }> = {
  forum: { label: "Forum thread", Icon: MessagesSquare },
  pdf: { label: "Proposal PDF", Icon: FileText },
  social: { label: "Social posts", Icon: ScrollText },
  onchain: { label: "On-chain actions", Icon: FileCode2 },
  disclosure: { label: "Signed disclosure", Icon: FileSignature },
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-code text-[11px] text-muted transition-colors hover:bg-canvas hover:text-ink"
      title={`Copy ${label}`}
    >
      {done ? <Check className="h-3.5 w-3.5 text-verified" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "copied" : shortAddr(text)}
    </button>
  );
}

/** Every document the watchdog read, fingerprinted. Clicking one opens it with its hash re-checked in the panel. */
export function SourcesTab({ version }: { version: ProposalVersion | null }) {
  const { openEvidenceFile, openChunk } = useEvidencePanel();
  const files: EvidenceFile[] = version?.files ?? [];

  return (
    <div className="space-y-6">
      <Rise>
        <div className="rounded-[24px] border border-line bg-panel p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="text-xs font-medium text-faint">Fingerprint of everything we read</div>
              <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-muted">
                One hash that changes if any word in any source changes. {version?.commitTxHash ? "It's recorded on-chain, so quiet edits show up." : "It hasn't been recorded on-chain yet."}
              </p>
            </div>
            <span className={cn("rounded-full border px-3 py-1 text-xs font-medium", version?.commitTxHash ? "border-verified/30 bg-verified/10 text-verified" : "border-line text-muted")}>
              Version {version?.version ?? "—"} · {version?.commitTxHash ? "on-chain" : "not committed"}
            </span>
          </div>
          {version && (
            <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl bg-canvas px-4 py-3">
              <span className="break-all font-code text-xs text-ink">{version.evidenceRoot}</span>
              <CopyButton text={version.evidenceRoot} label="fingerprint" />
            </div>
          )}
        </div>
      </Rise>

      {files.length === 0 ? (
        <p className="text-muted">No sources have been read for this proposal yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {files.map((f, i) => {
            const k = KIND[f.type] ?? { label: f.type, Icon: FileText };
            return (
              // A div acting as a button: it contains a real button (copy hash), and buttons can't nest.
              <motion.div
                key={f.uri}
                role="button"
                tabIndex={0}
                onClick={() => openEvidenceFile(f)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openEvidenceFile(f))}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.07 }}
                whileHover={{ y: -4 }}
                className="group cursor-pointer rounded-[22px] border border-line bg-panel p-5 text-left shadow-sm outline-none transition-shadow hover:shadow-[0_20px_50px_-25px_rgba(139,92,246,0.45)] focus-visible:ring-2 focus-visible:ring-evidence/40"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-canvas text-evidence transition-colors group-hover:bg-evidence group-hover:text-white">
                    <k.Icon className="h-4 w-4" />
                  </span>
                  <span className="text-xs text-faint">{(f.bytes / 1024).toFixed(1)} KB</span>
                </div>
                <div className="mt-4 text-lg font-medium text-ink">{k.label}</div>
                <div className="mt-1 truncate font-code text-[11px] text-faint">{f.uri}</div>
                <div className="mt-4 flex items-center justify-between">
                  <CopyButton text={f.sha256} label="file hash" />
                  <span className="text-xs font-medium text-evidence opacity-0 transition-opacity group-hover:opacity-100">Open →</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <Rise>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-caution/30 bg-caution/10 px-6 py-5">
          <div className="flex items-center gap-3 text-ink">
            <ShieldQuestion className="h-5 w-5 text-caution" />
            <span className="text-[15px]">What if someone edits a source after the fact? See how a tampered passage is caught.</span>
          </div>
          <button onClick={() => openChunk("MIP-21:tampered:0")} className="rounded-full border border-caution/50 bg-panel px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-caution/15">
            Try a tampered passage
          </button>
        </div>
      </Rise>
    </div>
  );
}
