"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, CheckCircle2, Copy, Search, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAmount, roleSentence, type Trail, type TrailLink, type TrailNode } from "@/lib/moneyTrail";
import { shortAddr } from "@/lib/radar";
import type { Selection } from "@/components/proposal/MoneyTrail";

const ROLE_CHIP: Record<TrailNode["role"], string> = {
  treasury: "Treasury",
  proposer: "Proposer",
  beneficiary: "Gets paid / control",
  middleman: "Middleman",
  linked: "Linked wallet",
  voter: "Voter",
  hub: "Exchange",
};

const nodeOf = (trail: Trail, e: string | TrailNode) => (typeof e === "string" ? trail.nodes.find((n) => n.id === e) : e);

function Shell({ children, k }: { children: React.ReactNode; k: string }) {
  return (
    <motion.div key={k} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.25 }} className="space-y-5">
      {children}
    </motion.div>
  );
}

function CopyAddr({ address }: { address: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(address);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 font-code text-[11px] text-ice-light/70 hover:text-white"
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {shortAddr(address)}
    </button>
  );
}

function Reasons({ link }: { link: TrailLink }) {
  if (!link.reasons.length) return null;
  return (
    <div>
      <div className="text-xs font-medium text-ice-light/50">Why this matters</div>
      <ul className="mt-2 space-y-2">
        {link.reasons.map((r) => (
          <li key={r} className="flex gap-2 text-sm leading-relaxed text-ice-light/85">
            <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#A78BFA]" />
            {r}
          </li>
        ))}
      </ul>
      {link.pLink !== null && <p className="mt-3 text-sm text-[#DDD6FE]">{Math.round(link.pLink * 100)}% likely these wallets belong together.</p>}
    </div>
  );
}

/** Right-hand inspector: the overall finding, a wallet, or a link, always in plain words. */
export function MoneyTrailInspector({ trail, revealed, selection, onReveal, onClear }: { trail: Trail; revealed: boolean; selection: Selection; onReveal: () => void; onClear: () => void }) {
  const exposedBeneficiary = trail.nodes.find((n) => n.role === "beneficiary" && n.onPath);
  const pathLinks = trail.links.filter((l) => l.hidden && l.reasons.length);

  return (
    <aside className="relative min-h-[300px] rounded-[22px] border border-white/10 bg-white/[0.04] p-6 text-ice-light backdrop-blur">
      {selection && (
        <button onClick={onClear} className="absolute right-4 top-4 rounded-full p-1.5 text-ice-light/50 hover:bg-white/10 hover:text-white" aria-label="Back to the summary">
          <X className="h-4 w-4" />
        </button>
      )}
      <AnimatePresence mode="wait">
        {!selection && trail.hiddenLinkCount === 0 && (
          <Shell k="clean">
            <CheckCircle2 className="h-8 w-8 text-verified" />
            <h3 className="text-2xl font-semibold tracking-tight">No hidden connections.</h3>
            <p className="text-sm leading-relaxed text-ice-light/75">We followed every transfer between these wallets. The proposer isn&apos;t secretly linked to anyone who benefits.</p>
            {trail.signatureValid && <p className="text-sm text-verified">The proposer&apos;s signed disclosure checks out.</p>}
          </Shell>
        )}

        {!selection && trail.hiddenLinkCount > 0 && !revealed && (
          <Shell k="tease">
            <Search className="h-8 w-8 text-[#A78BFA]" />
            <h3 className="text-2xl font-semibold tracking-tight">Something&apos;s hiding here.</h3>
            <p className="text-sm leading-relaxed text-ice-light/75">
              On the surface these wallets look unrelated. The watchdog followed the money and found payments the proposer never disclosed.
            </p>
            <button onClick={onReveal} className="pill-cta pill-danger">
              Reveal hidden links <ArrowRight className="h-4 w-4" />
            </button>
          </Shell>
        )}

        {!selection && trail.hiddenLinkCount > 0 && revealed && (
          <Shell k="found">
            <div className="text-xs font-medium text-[#A78BFA]">Found</div>
            <h3 className="text-2xl font-semibold leading-tight tracking-tight">
              The proposer is paying {exposedBeneficiary ? <span className="text-[#A78BFA]">{exposedBeneficiary.name}</span> : "the beneficiary"}
              {trail.nodes.some((n) => n.role === "middleman") ? " through a middleman." : " directly."}
            </h3>
            {trail.pCoi !== null && <p className="text-sm text-ice-light/75">{Math.round(trail.pCoi * 100)}% likely the proposer is connected to whoever benefits.</p>}
            {pathLinks[0] && <Reasons link={pathLinks[0]} />}
            {exposedBeneficiary && !exposedBeneficiary.disclosed && (
              <p className="flex items-start gap-2 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-[#DDD6FE]">
                <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                {trail.signatureValid ? "The proposer signed a disclosure, but it leaves this wallet out." : "There's no valid signed disclosure covering this wallet."}
              </p>
            )}
            <p className="text-xs text-ice-light/50">Click any wallet or line for details.</p>
          </Shell>
        )}

        {selection?.kind === "node" && (
          <Shell k={selection.node.id}>
            <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium">{ROLE_CHIP[selection.node.role]}</span>
            <h3 className="text-2xl font-semibold tracking-tight">{selection.node.name}</h3>
            <p className="text-sm leading-relaxed text-ice-light/80">{roleSentence(selection.node, trail)}</p>
            {selection.node.address && <CopyAddr address={selection.node.address} />}
            {(selection.node.role === "proposer" || selection.node.role === "beneficiary") && (
              <p className={cn("flex items-center gap-2 text-sm", selection.node.disclosed ? "text-verified" : "text-[#DDD6FE]")}>
                {selection.node.disclosed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {selection.node.disclosed ? "Named in the signed disclosure" : "Not named in any disclosure"}
              </p>
            )}
            <MoneyList trail={trail} node={selection.node} revealed={revealed} />
          </Shell>
        )}

        {selection?.kind === "link" && (
          <Shell k={selection.link.id}>
            <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-medium", selection.link.kind === "hidden" ? "bg-danger/20 text-[#DDD6FE]" : "bg-white/10")}>
              {selection.link.kind === "hidden" ? "Undisclosed payment" : selection.link.kind === "grant" ? "What the proposal hands over" : "Ordinary transfer"}
            </span>
            <h3 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
              {nodeOf(trail, selection.link.source)?.name} <ArrowRight className="h-4 w-4 text-ice-light/50" /> {nodeOf(trail, selection.link.target)?.name}
            </h3>
            <p className="text-3xl font-semibold tracking-tight">{selection.link.kind === "grant" ? "" : selection.link.label}</p>
            {selection.link.kind === "grant" && <p className="text-sm text-ice-light/80">If the proposal runs, this wallet {selection.link.label}.</p>}
            {selection.link.transfers.length > 0 && (
              <ul className="space-y-1.5">
                {selection.link.transfers.map((t) => (
                  <li key={t.id} className="flex justify-between rounded-xl bg-white/5 px-3 py-2 font-code text-[11px] text-ice-light/70">
                    <span>{formatAmount(t.amount, t.token)}</span>
                    <span>transfer {t.id}</span>
                  </li>
                ))}
              </ul>
            )}
            <Reasons link={selection.link} />
          </Shell>
        )}
      </AnimatePresence>
    </aside>
  );
}

function MoneyList({ trail, node, revealed }: { trail: Trail; node: TrailNode; revealed: boolean }) {
  const rows = trail.links
    .filter((l) => (revealed || !l.hidden) && l.kind !== "grant")
    .map((l) => {
      const a = typeof l.source === "string" ? l.source : l.source.id;
      const b = typeof l.target === "string" ? l.target : l.target.id;
      if (a === node.id) return { l, dir: "sent", other: nodeOf(trail, l.target) };
      if (b === node.id) return { l, dir: "received", other: nodeOf(trail, l.source) };
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-medium text-ice-light/50">Money with others here</div>
      <ul className="mt-2 space-y-1.5">
        {rows.map(({ l, dir, other }) => (
          <li key={l.id} className={cn("flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm", l.hidden ? "bg-danger/10 text-[#DDD6FE]" : "bg-white/5 text-ice-light/80")}>
            <span className="truncate">
              {dir === "sent" ? "→" : "←"} {other?.name}
            </span>
            <span className="flex-shrink-0 font-code text-[11px]">{l.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
