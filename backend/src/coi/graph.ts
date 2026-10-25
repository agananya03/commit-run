// Conflict-of-interest engine: who is secretly connected to whom, scored per wallet pair.
// Pure: takes transfers and the proposal's parties, returns a CoiReport. Loading from the DB is coi/service.ts.
import { MultiDirectedGraph } from "graphology";
import { formatUnits } from "ethers";
import type { z } from "zod";
import type { CoiReport, WalletLink } from "../contracts/schemas.js";

type CoiReportT = z.infer<typeof CoiReport>;
type WalletLinkT = z.infer<typeof WalletLink>;

/** Every tunable of the engine in one place. */
export const COI_CONFIG = {
  /** Longest path searched, in transfers. */
  maxHops: 3,
  /** Nodes with more distinct counterparties than this are hubs (deployer, CEX, treasury): paths through them prove little. */
  hubDegree: 30,
  /** Synthetic chain timing anchor (data/ANSWER_KEY.md): 1 day = 100 blocks. */
  blocksPerDay: 100,
  /** Funding this many days before the proposal (or later) counts as recent. */
  recentDays: 30,
  /** Two wallets share a funder if it paid both within this many blocks. */
  sharedFunderWindowBlocks: 1000,
  /** pCoi combines this many strongest links. */
  topLinks: 5,
  /** Largest voters added as targets. */
  topVoters: 10,
  /** pLink = sigmoid(bias + Σ weight·feature). */
  weights: {
    pathExists: 2.0,
    firstFunderOnPath: 1.5,
    recentFunding: 1.0,
    undisclosed: 1.0,
    sharedFunder: 1.2,
    throughHub: -1.5,
    bias: -3.0,
  },
} as const;

export type CoiConfig = typeof COI_CONFIG;

export interface TransferEdge {
  /** lowercase */
  from: string;
  /** lowercase */
  to: string;
  /** token address (lowercase), or null for ETH */
  token: string | null;
  /** base units */
  amount: string;
  blockNumber: number;
  /** order within the block, for "first funder" ties */
  logIndex?: number;
}

export type TargetRole = "recipient" | "spender" | "new owner" | "voter";

export interface CoiInput {
  /** slug, e.g. MIP-21 */
  proposalId: string;
  proposer: string;
  /** Wallets the proposer claims as their own (signed or not). */
  claimed: string[];
  /** True if `claimed` comes from a disclosure whose EIP-191 signature recovers to the proposer. */
  signatureValid: boolean;
  targets: { address: string; role: TargetRole }[];
  transfers: TransferEdge[];
  /** Block the proposal was made at (ProposalCreated), for the "recent funding" feature. */
  referenceBlock: number;
  /** Never used as intermediaries or funders: zero address, protocol contracts. */
  ignore?: string[];
  /** address -> human label, for reasons. */
  labels?: Record<string, string>;
  /** token address -> symbol/decimals, for reasons. */
  tokens?: Record<string, { symbol: string; decimals: number }>;
}

export interface LinkFeatures {
  pathExists: 0 | 1;
  firstFunderOnPath: 0 | 1;
  recentFunding: 0 | 1;
  undisclosed: 0 | 1;
  sharedFunder: 0 | 1;
  throughHub: 0 | 1;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function pLinkOf(f: LinkFeatures, w: CoiConfig["weights"] = COI_CONFIG.weights): number {
  return sigmoid(
    w.pathExists * f.pathExists +
      w.firstFunderOnPath * f.firstFunderOnPath +
      w.recentFunding * f.recentFunding +
      w.undisclosed * f.undisclosed +
      w.sharedFunder * f.sharedFunder +
      w.throughHub * f.throughHub +
      w.bias,
  );
}

/** pCoi = 1 - Π(1 - pLink) over the strongest `top` links. */
export function combinePCoi(pLinks: number[], top: number = COI_CONFIG.topLinks): number {
  return 1 - [...pLinks].sort((a, b) => b - a).slice(0, top).reduce((acc, p) => acc * (1 - p), 1);
}

type Graph = MultiDirectedGraph<Record<string, never>, TransferEdge>;

export function buildGraph(transfers: TransferEdge[]): Graph {
  const g: Graph = new MultiDirectedGraph();
  for (const t of transfers) {
    if (t.from === t.to) continue;
    g.mergeNode(t.from);
    g.mergeNode(t.to);
    g.addEdge(t.from, t.to, t);
  }
  return g;
}

/** Shortest directed path from → to of at most maxHops edges; intermediaries skip `blocked` nodes. */
function shortestPath(g: Graph, from: string, to: string, maxHops: number, blocked: (n: string) => boolean): string[] | null {
  if (!g.hasNode(from) || !g.hasNode(to)) return null;
  const prev = new Map<string, string>([[from, from]]);
  let frontier = [from];
  for (let depth = 0; depth < maxHops && frontier.length > 0; depth++) {
    const next: string[] = [];
    // Sorted so ties between equally short paths resolve the same way every run
    for (const node of frontier) {
      for (const n of [...new Set(g.outNeighbors(node))].sort()) {
        if (prev.has(n)) continue;
        if (n !== to && blocked(n)) continue;
        prev.set(n, node);
        if (n === to) {
          const path = [to];
          while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
          return path;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function computeCoi(input: CoiInput, config: CoiConfig = COI_CONFIG): CoiReportT {
  const lc = (a: string) => a.toLowerCase();
  const proposer = lc(input.proposer);
  const claimed = [...new Set(input.claimed.map(lc))].sort();
  const sources = [...new Set([proposer, ...claimed])];
  // Only a valid signature makes a claim count as disclosed; the proposer is always "themselves".
  const trusted = new Set([proposer, ...(input.signatureValid ? claimed : [])]);
  const ignore = new Set((input.ignore ?? []).map(lc));
  const g = buildGraph(input.transfers.map((t) => ({ ...t, from: lc(t.from), to: lc(t.to), token: t.token && lc(t.token) })));

  const degree = (n: string) => (g.hasNode(n) ? new Set(g.neighbors(n)).size : 0);
  const isHub = (n: string) => degree(n) > config.hubDegree;
  const unusable = (n: string) => ignore.has(n) || isHub(n);

  const label = (a: string) => {
    const name = input.labels?.[a];
    return name ? `${name} (${short(a)})` : short(a);
  };
  const amountOf = (t: TransferEdge) => {
    const token = t.token ? input.tokens?.[t.token] : { symbol: "ETH", decimals: 18 };
    return token ? `${Number(formatUnits(t.amount, token.decimals)).toLocaleString("en-US")} ${token.symbol}` : `${t.amount} units`;
  };
  const order = (a: TransferEdge, b: TransferEdge) => a.blockNumber - b.blockNumber || (a.logIndex ?? 0) - (b.logIndex ?? 0);
  const inbound = (n: string): TransferEdge[] =>
    g.hasNode(n) ? g.inEdges(n).map((e) => g.getEdgeAttributes(e)).filter((t) => !unusable(t.from)).sort(order) : [];
  const transfersBetween = (u: string, v: string): TransferEdge[] => g.edges(u, v).map((e) => g.getEdgeAttributes(e)).sort(order);

  const recentFrom = input.referenceBlock - config.recentDays * config.blocksPerDay;
  const daysBefore = (block: number) => Math.round(((input.referenceBlock - block) / config.blocksPerDay) * 10) / 10;

  const findPath = (s: string, t: string) => {
    const strict = (n: string) => unusable(n);
    const loose = (n: string) => ignore.has(n);
    for (const [blocked, throughHub] of [[strict, false], [loose, true]] as const) {
      const forward = shortestPath(g, s, t, config.maxHops, blocked);
      if (forward) return { path: forward, throughHub };
      const backward = shortestPath(g, t, s, config.maxHops, blocked);
      if (backward) return { path: backward, throughHub };
    }
    return null;
  };

  const sharedFunderOf = (a: string, b: string) => {
    const fa = inbound(a).filter((t) => t.from !== b);
    const fb = inbound(b).filter((t) => t.from !== a);
    for (const x of fa) {
      const y = fb.find((t) => t.from === x.from && Math.abs(t.blockNumber - x.blockNumber) <= config.sharedFunderWindowBlocks);
      if (y) return { funder: x.from, a: x, b: y };
    }
    return null;
  };

  const links: (WalletLinkT & { undisclosed: boolean })[] = [];
  const targets = new Map<string, TargetRole[]>();
  for (const t of input.targets) {
    const a = lc(t.address);
    if (ignore.has(a) || trusted.has(a)) continue;
    targets.set(a, [...new Set([...(targets.get(a) ?? []), t.role])]);
  }

  for (const s of sources) {
    for (const [t, roles] of targets) {
      if (s === t) continue;
      const found = findPath(s, t);
      const shared = sharedFunderOf(s, t);
      if (!found && !shared) continue;

      const reasons: string[] = [];
      const f: LinkFeatures = { pathExists: 0, firstFunderOnPath: 0, recentFunding: 0, undisclosed: trusted.has(t) ? 0 : 1, sharedFunder: shared ? 1 : 0, throughHub: 0 };
      const path = found?.path ?? [s, shared!.funder, t];

      if (found) {
        f.pathExists = 1;
        f.throughHub = found.throughHub ? 1 : 0;
        const hops = found.path.length - 1;
        reasons.push(`${hops}-hop transfer path ${found.path.map(label).join(" → ")} links ${s === proposer ? "the proposer" : "disclosed wallet"} ${label(s)} to ${roles.join("/")} ${label(t)}`);

        for (let i = 0; i < found.path.length - 1; i++) {
          const u = found.path[i]!;
          const v = found.path[i + 1]!;
          const edges = transfersBetween(u, v);
          const first = inbound(v)[0];
          // Being the first to fund a hub (exchange, deployer) says nothing about who controls it
          if (!f.firstFunderOnPath && first && first.from === u && !isHub(v)) {
            f.firstFunderOnPath = 1;
            reasons.push(`${label(u)} was the first funder of ${label(v)} (${amountOf(first)} at block ${first.blockNumber})`);
          }
          const recent = edges.find((e) => e.blockNumber >= recentFrom && e.blockNumber <= input.referenceBlock);
          if (!f.recentFunding && recent) {
            f.recentFunding = 1;
            reasons.push(`${label(u)} sent ${label(v)} ${amountOf(recent)} ${daysBefore(recent.blockNumber)} days before the proposal (block ${recent.blockNumber})`);
          }
        }
        if (found.throughHub) {
          const hubs = found.path.slice(1, -1).filter(isHub);
          reasons.push(`path passes through hub ${hubs.map((h) => `${label(h)} (${degree(h)} counterparties)`).join(", ")}, which weakens it`);
        }
      }
      if (shared) {
        reasons.push(`${label(shared.funder)} funded both ${label(s)} (block ${shared.a.blockNumber}) and ${label(t)} (block ${shared.b.blockNumber}), ${Math.abs(shared.a.blockNumber - shared.b.blockNumber)} blocks apart`);
      }
      if (f.undisclosed) {
        reasons.push(input.signatureValid ? `${label(t)} is not in the proposer's signed disclosure` : `${label(t)} is not covered by a validly signed disclosure`);
      }

      links.push({ from: s, to: t, path, hops: path.length - 1, pLink: round4(pLinkOf(f, config.weights)), reasons, undisclosed: f.undisclosed === 1 });
    }
  }

  const undisclosedLinks = links
    .filter((l) => l.undisclosed)
    .map(({ undisclosed: _u, ...l }) => l)
    .sort((a, b) => b.pLink - a.pLink || a.hops - b.hops || a.to.localeCompare(b.to) || a.from.localeCompare(b.from));

  return {
    proposalId: input.proposalId,
    proposer,
    disclosed: claimed,
    signatureValid: input.signatureValid,
    undisclosedLinks,
    pCoi: round4(combinePCoi(undisclosedLinks.map((l) => l.pLink), config.topLinks)),
  };
}
