import walletsData from "@/data/wallets.json";
import transfersData from "@/data/transfers.json";
import { ADDRESS_TO_INDEX, HARDHAT_ADDRESSES } from "@/lib/coiGraph";
import type { CoiReport, DecisionSummary, Finding } from "@/types/shared";

/**
 * The money-trail investigation for one proposal, split into what anyone sees first and what the COI analysis
 * uncovers. "Hidden" nodes and links are only added when the viewer presses Reveal (Bubblemaps-style).
 * Everything comes from the COI report, wallets.json and transfers.json; nothing is invented.
 */

export type TrailRole = "treasury" | "proposer" | "beneficiary" | "middleman" | "voter" | "hub" | "linked";

export interface TrailNode {
  id: string;
  index: number | null;
  name: string;
  role: TrailRole;
  address: string | null;
  mrd: number;
  disclosed: boolean;
  hidden: boolean;
  /** On an undisclosed proposer → beneficiary path. */
  onPath: boolean;
  // set by the force layout
  x?: number;
  y?: number;
  z?: number;
}

export interface TrailLink {
  id: string;
  source: string | TrailNode;
  target: string | TrailNode;
  kind: "transfer" | "hidden" | "grant";
  label: string;
  transfers: { id: string; token: string; amount: string; blockOffset: number }[];
  hidden: boolean;
  reasons: string[];
  pLink: number | null;
}

export interface Trail {
  nodes: TrailNode[];
  links: TrailLink[];
  hiddenNodeCount: number;
  hiddenLinkCount: number;
  pCoi: number | null;
  signatureValid: boolean | null;
}

interface Wallet {
  index: number;
  role: string;
  label: string;
  mrd: number;
}
interface Transfer {
  id: string;
  token: string;
  amount: string;
  fromIndex: number;
  toIndex: number;
  blockOffset: number;
}

const WALLETS: Wallet[] = (walletsData as { wallets: Wallet[] }).wallets;
const TRANSFERS: Transfer[] = (transfersData as { transfers: Transfer[] }).transfers;
const walletAt = (i: number) => WALLETS.find((w) => w.index === i);

/** Neutral display names: never the dataset's role labels, which give the answer away. */
export function displayName(i: number): string {
  const w = walletAt(i);
  if (!w) return `Wallet #${i}`;
  const inParens = /\(([^)]+)\)/.exec(w.label)?.[1];
  if (w.role === "delegate") return w.label.split(" ")[0]!;
  if (w.role.startsWith("whale")) return `Whale #${i}`;
  if (w.role === "cex_hub") return "Exchange hub";
  if (/proposer$|recipient$|_alt$/.test(w.role) && inParens) return inParens;
  return `Wallet #${i}`;
}

export function formatAmount(amount: string, token: string): string {
  const n = Number(amount);
  if (token === "USDC") return `$${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const units = n / 1e18;
  if (token === "MRD") return `${units >= 1e6 ? `${(units / 1e6).toFixed(1)}M` : units.toLocaleString("en-US", { maximumFractionDigits: 0 })} MRD`;
  return `${units.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${token}`;
}

function toIndex(ref: string): number | null {
  const s = ref.trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /index\s+(\d+)/.exec(s);
  if (m) return Number(m[1]);
  return ADDRESS_TO_INDEX[s] ?? null;
}

export function buildTrail(slug: string, coi: CoiReport | null | undefined, summary: DecisionSummary | null | undefined, findings: Finding[] = []): Trail {
  const key = slug.toLowerCase().replace("-", "");
  const byRole = (suffix: string) => WALLETS.find((w) => w.role === `${key}_${suffix}`)?.index ?? null;

  const paths = (coi?.undisclosedLinks ?? []).map((l) => ({ link: l, idx: l.path.map(toIndex).filter((x): x is number => x !== null) }));
  const proposer = paths[0]?.idx[0] ?? byRole("proposer") ?? (coi ? toIndex(coi.proposer) : null);
  const disclosed = new Set((coi?.disclosed ?? []).map(toIndex).filter((x): x is number => x !== null));
  const beneficiaries = new Set<number>();
  for (const p of paths) if (p.idx.length > 1) beneficiaries.add(p.idx[p.idx.length - 1]!);
  for (const r of ["recipient", "alt"]) {
    const i = byRole(r);
    if (i !== null) beneficiaries.add(i);
  }
  const middlemen = new Set<number>();
  for (const p of paths) p.idx.slice(1, -1).forEach((i) => middlemen.add(i));
  const secondary = byRole("secondary");
  const pathNodes = new Set<number>(paths.flatMap((p) => p.idx));

  const voters = WALLETS.filter((w) => w.role === "delegate" || w.role.startsWith("whale"))
    .sort((a, b) => b.mrd - a.mrd)
    .slice(0, 8)
    .map((w) => w.index);
  const hub = WALLETS.find((w) => w.role === "cex_hub")?.index ?? null;

  // ---- nodes
  const nodes = new Map<string, TrailNode>();
  const add = (i: number, role: TrailRole, hidden: boolean) => {
    const id = `w${i}`;
    if (nodes.has(id)) return;
    nodes.set(id, {
      id,
      index: i,
      name: displayName(i),
      role,
      address: HARDHAT_ADDRESSES[i] ?? null,
      mrd: walletAt(i)?.mrd ?? 0,
      disclosed: disclosed.has(i),
      hidden,
      onPath: pathNodes.has(i),
    });
  };
  nodes.set("treasury", { id: "treasury", index: null, name: "DAO treasury", role: "treasury", address: null, mrd: 0, disclosed: true, hidden: false, onPath: false });
  if (proposer !== null) add(proposer, "proposer", false);
  beneficiaries.forEach((i) => add(i, "beneficiary", false));
  voters.forEach((i) => add(i, "voter", false));
  if (hub !== null) add(hub, "hub", false);
  middlemen.forEach((i) => add(i, "middleman", true));
  if (paths.length > 0 && secondary !== null && secondary !== proposer) add(secondary, "linked", true);

  // ---- links: aggregate transfers per pair
  // "Hidden" only means what the COI analysis flagged: with no undisclosed links, every transfer is ordinary.
  // (Array.from throughout: the frontend's tsconfig targets ES5, which can't spread Sets/Maps.)
  const suspects =
    paths.length > 0 ? new Set<number>([...(proposer !== null ? [proposer] : []), ...Array.from(middlemen), ...(secondary !== null ? [secondary] : [])]) : new Set<number>();
  const links = new Map<string, TrailLink>();
  for (const t of TRANSFERS) {
    const a = `w${t.fromIndex}`;
    const b = `w${t.toIndex}`;
    if (!nodes.has(a) || !nodes.has(b) || a === b) continue;
    const hidden = suspects.has(t.fromIndex) || suspects.has(t.toIndex);
    const id = `${a}>${b}`;
    const l = links.get(id) ?? { id, source: a, target: b, kind: hidden ? "hidden" : "transfer", label: "", transfers: [], hidden, reasons: [], pLink: null };
    l.transfers.push({ id: t.id, token: t.token, amount: t.amount, blockOffset: t.blockOffset });
    links.set(id, l);
  }
  // undisclosed path edges, with the analysis' reasons (even when no transfer row matches)
  for (const p of paths) {
    for (let k = 0; k < p.idx.length - 1; k++) {
      const id = `w${p.idx[k]}>w${p.idx[k + 1]}`;
      const l = links.get(id) ?? { id, source: `w${p.idx[k]}`, target: `w${p.idx[k + 1]}`, kind: "hidden" as const, label: "", transfers: [], hidden: true, reasons: [], pLink: null };
      l.kind = "hidden";
      l.hidden = true;
      l.reasons = p.link.reasons;
      l.pLink = p.link.pLink;
      links.set(id, l);
    }
  }
  for (const l of Array.from(links.values())) {
    const byToken = new Map<string, bigint>();
    for (const t of l.transfers) byToken.set(t.token, (byToken.get(t.token) ?? BigInt(0)) + BigInt(t.amount));
    l.label = Array.from(byToken).map(([token, sum]) => formatAmount(sum.toString(), token)).join(" + ") || "linked";
  }
  // what the proposal would hand each beneficiary, from the treasury
  const control = findings.filter((f) => f.category === "ownership_change" || f.category === "unlimited_approval");
  beneficiaries.forEach((i) => {
    const amt = summary?.treasuryImpact.amountUsd;
    const label = control.length > 0 ? "would get vault control and unlimited spending" : amt ? `would receive $${amt.toLocaleString("en-US")}` : "is the beneficiary";
    links.set(`treasury>w${i}`, { id: `treasury>w${i}`, source: "treasury", target: `w${i}`, kind: "grant", label, transfers: [], hidden: false, reasons: [], pLink: null });
  });

  const all = Array.from(links.values());
  const allNodes = Array.from(nodes.values());
  return {
    nodes: allNodes,
    links: all,
    hiddenNodeCount: allNodes.filter((n) => n.hidden).length,
    hiddenLinkCount: all.filter((l) => l.hidden).length,
    pCoi: coi?.pCoi ?? null,
    signatureValid: coi?.signatureValid ?? null,
  };
}

/** What a node is, in a sentence. */
export function roleSentence(n: TrailNode, trail: Trail): string {
  switch (n.role) {
    case "treasury":
      return "The DAO's shared money. Proposals ask to spend it.";
    case "proposer":
      return "Wrote and submitted this proposal.";
    case "beneficiary": {
      const grant = trail.links.find((l) => l.kind === "grant" && (typeof l.target === "string" ? l.target : l.target.id) === n.id);
      return `If the proposal runs, this wallet ${grant?.label ?? "benefits"}.`;
    }
    case "middleman":
      return "Passed money from the proposer toward the people who benefit.";
    case "linked":
      return "Received money from the proposer's side right before the vote.";
    case "voter":
      return `Votes on this proposal with ${n.mrd >= 1e6 ? `${(n.mrd / 1e6).toFixed(0)}M` : n.mrd.toLocaleString("en-US")} MRD.`;
    case "hub":
      return "An exchange wallet hundreds of people use, so links through it mean little.";
  }
}
