"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, FileDiff, Link2, Loader2, PenLine, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ADDRESS_TO_INDEX } from "@/lib/coiGraph";
import { displayName } from "@/lib/moneyTrail";
import { Rise } from "@/components/fx/Motion";
import type { ChainEvent, ProposalBundle } from "@/types/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== "false";

const short = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h);
const lower = (s: unknown) => String(s ?? "").toLowerCase();
const wallet = (addr: string) => {
  const i = ADDRESS_TO_INDEX[lower(addr)];
  if (i === undefined) return short(addr);
  const name = displayName(i);
  return name.startsWith("Wallet #") ? name : `${name} (wallet #${i})`;
};

type Tone = "good" | "bad" | "wait";
const TONE: Record<Tone, { ring: string; dot: string; Icon: typeof Check }> = {
  good: { ring: "border-ice/20 bg-ice/[0.03]", dot: "bg-ice/20 text-ice", Icon: Check },
  bad: { ring: "border-[#F0566A]/35 bg-[#F0566A]/[0.05]", dot: "bg-[#F0566A]/20 text-[#FF9DAA]", Icon: X },
  wait: { ring: "border-white/[0.07] bg-panel", dot: "bg-white/[0.06] text-faint", Icon: Loader2 },
};

function Card({ tone, Icon, title, line, children, delay }: { tone: Tone; Icon: typeof Check; title: string; line: string; children?: React.ReactNode; delay: number }) {
  const t = TONE[tone];
  return (
    <Rise delay={delay}>
      <div className={cn("h-full rounded-[22px] border p-5", t.ring)}>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-ice">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-medium text-ink">{title}</span>
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full", t.dot)}>
                <t.Icon className={cn("h-3 w-3", tone === "wait" && "animate-none")} strokeWidth={3} />
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{line}</p>
          </div>
        </div>
        {children && <div className="mt-4 border-t border-white/[0.06] pt-3 text-xs text-faint">{children}</div>}
      </div>
    </Rise>
  );
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `0x${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Downloads the assessment report and re-hashes it in the browser against the hash on the chain. */
function RehashButton({ slug, attested }: { slug: string; attested: ChainEvent }) {
  const [state, setState] = useState<{ status: "idle" | "busy" | "match" | "mismatch" | "error"; got?: string; url?: string }>({ status: "idle" });
  const a = attested.args as Record<string, unknown>;
  const url = USE_MOCKS ? `/mocks-local/assessment.${slug}.md` : `${API_URL}/proposals/${slug}/assessment?simHash=${String(a.simHash ?? "")}`;
  const run = async () => {
    setState({ status: "busy" });
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const got = await sha256Hex(await res.text());
      setState({ status: got === lower(a.reportHash) ? "match" : "mismatch", got, url });
    } catch {
      setState({ status: "error" });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={() => void run()} disabled={state.status === "busy"} className="pill-cta pill-ice !rounded-full !px-4 !py-2 !text-xs">
        {state.status === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDiff className="h-3.5 w-3.5" />}
        Re-hash the report here
      </button>
      <a href={url} target="_blank" rel="noreferrer" className="text-evidence hover:underline">
        read the report
      </a>
      {state.status === "match" && (
        <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="text-ice">
          ✓ your browser got {short(state.got!)}, the same hash as on the chain
        </motion.span>
      )}
      {state.status === "mismatch" && <span className="text-[#FF9DAA]">✗ this report hashes to {short(state.got!)}, not what the chain recorded</span>}
      {state.status === "error" && <span>Couldn&apos;t fetch the report (is the backend running?)</span>}
    </div>
  );
}

/**
 * Pillars 1 and 3, as a reader can check them: the Governor proposal is locked to the evidence the registry
 * recorded, the proposer's own on-chain disclosure is held against the money trail, and the watchdog's technical
 * assessment sits on the chain where anyone can re-hash it.
 */
export function OnTheRecord({ bundle }: { bundle: ProposalBundle }) {
  const ev = (name: string) => bundle.chainEvents.filter((e) => e.name === name);
  const bound = ev("EvidenceBound")[0];
  const assessments = ev("AssessmentAttested");
  const slug = bundle.proposal.slug;

  // 1. binding: is the root locked into the vote one of the roots the registry recorded?
  const root = lower((bound?.args as Record<string, unknown> | undefined)?.evidenceRoot);
  const matched = bundle.versions.find((v) => lower(v.evidenceRoot) === root && v.commitTxHash);
  const recorded = bundle.versions.find((v) => lower(v.evidenceRoot) === root);

  // 2. disclosure vs the money trail
  const disclosed = new Set(((bound?.args as Record<string, unknown> | undefined)?.disclosedWallets as string[] | undefined)?.map(lower) ?? []);
  const proposer = lower(bundle.proposal.proposer);
  const linked = Array.from(new Set((bundle.coi?.undisclosedLinks ?? []).flatMap((l) => [l.to, ...l.path.filter((p) => p.startsWith("0x"))]).map(lower))).filter((w) => w !== proposer);
  const omitted = linked.filter((w) => !disclosed.has(w));

  // 3. assessments: the latest one, and whether it describes the simulation this page shows
  const latest = assessments.at(-1);
  const simMatch = latest && bundle.simulation ? lower((latest.args as Record<string, unknown>).simHash) === lower(bundle.simulation.simHash) : false;

  return (
    <div>
      <div className="mb-4 mt-2 text-xs font-medium text-faint">On the record · what the chain enforces before anyone can vote, and what anyone can re-check</div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          delay={0}
          Icon={Link2}
          tone={!bound ? "wait" : recorded ? "good" : "bad"}
          title="Evidence locked to the vote"
          line={
            !bound
              ? "Not proposed yet. The Governor refuses any proposal that doesn't name the fingerprint of its evidence."
              : recorded
              ? `The proposal id voters sign is a hash that includes the evidence root ${short(root)}: the same root as version ${recorded.version}${matched ? ", recorded in the registry" : ""}. Swap a document and it's a different proposal.`
              : `The root locked into this vote (${short(root)}) matches no recorded version of the documents.`
          }
        >
          {bound && <>Governor block {bound.blockNumber} · tx {short(bound.txHash)}</>}
        </Card>

        <Card
          delay={0.06}
          Icon={omitted.length ? ShieldAlert : PenLine}
          tone={!bound ? "wait" : omitted.length ? "bad" : "good"}
          title="Disclosure, signed by sending it"
          line={
            !bound
              ? "No disclosure, no proposal: the proposer has to file it from their own wallet in the same transaction."
              : omitted.length
              ? `The proposer disclosed ${disclosed.size} wallet${disclosed.size === 1 ? "" : "s"}, but the money trail ties them to ${omitted.map(wallet).join(", ")}. The omission is on-chain, under their own key.`
              : `The proposer disclosed ${disclosed.size} wallet${disclosed.size === 1 ? "" : "s"}, and the money trail found no tie they left out.`
          }
        >
          {bound && (disclosed.size ? Array.from(disclosed).map(wallet).join(" · ") : "disclosed: none")}
        </Card>

        <Card
          delay={0.12}
          Icon={FileDiff}
          tone={!latest ? "wait" : simMatch ? "good" : "bad"}
          title="Technical assessment on-chain"
          line={
            !latest
              ? "Recorded once the watchdog has run the code: a report of every call, state change and finding, hashed into the proposal registry."
              : `${assessments.length} assessment${assessments.length === 1 ? "" : "s"} recorded. The latest describes ${simMatch ? "exactly the simulation shown on this page" : "a different simulation than this page shows"}.`
          }
        >
          {latest && <RehashButton slug={slug} attested={latest} />}
        </Card>
      </div>
    </div>
  );
}
