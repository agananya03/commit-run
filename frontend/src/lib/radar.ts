import type { Finding, ProposalBundle, RiskChain } from "@/types/shared";
import type { ProposalListItem } from "@/lib/api";

/** What the radar shows per proposal, derived only from the list item and its bundle (never invented). */
export interface RadarRow {
  slug: string;
  title: string;
  proposer: string;
  /** Governance state, or HALTED when GovernanceGuard has flagged the queued operation. */
  state: string;
  level: RiskChain["level"] | null;
  posterior: number | null;
  action: RiskChain["action"] | null;
  /** Most severe first. */
  findings: Finding[];
  topFinding: Finding | null;
  findingCount: number;
  criticalCount: number;
  files: number;
  citations: number;
  amountUsd: number | null;
  pctOfTreasury: number | null;
  tldr: string | null;
  stages: RiskChain["stages"];
  flagTx: string | null;
}

const SEVERITY_RANK: Record<Finding["severity"], number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export function buildRow(item: ProposalListItem, bundle: ProposalBundle | undefined): RadarRow {
  const findings = [...(bundle?.findings ?? [])].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const topFinding = findings[0] ?? null;
  const summary = bundle?.summary ?? null;
  const citations = summary
    ? summary.claims.reduce((n, c) => n + c.citations.length, 0) + summary.treasuryImpact.citations.length
    : 0;
  const risk = bundle?.risk ?? null;
  return {
    slug: item.slug,
    title: bundle?.proposal.title ?? item.title,
    proposer: item.proposer,
    state: bundle?.flag ? "HALTED" : String(bundle?.proposal.status ?? item.status ?? "ACTIVE").toUpperCase(),
    level: risk?.level ?? item.riskLevel ?? null,
    posterior: risk?.posterior ?? null,
    action: risk?.action ?? null,
    findings,
    topFinding,
    findingCount: findings.length,
    criticalCount: findings.filter((f) => f.severity === "critical").length,
    files: bundle?.versions.at(-1)?.files.length ?? 0,
    citations,
    amountUsd: summary?.treasuryImpact.amountUsd ?? item.amountUsd ?? null,
    pctOfTreasury: summary?.treasuryImpact.pctOfTreasury ?? item.pctOfTreasury ?? null,
    tldr: summary?.tldr ?? null,
    stages: risk?.stages ?? [],
    flagTx: bundle?.flag?.txHash ?? null,
  };
}

/** Red is reserved for a confirmed execution threat; amber is uncertainty; mint is verified clean. */
export function toneOf(level: RiskChain["level"] | null): "danger" | "caution" | "verified" | "muted" {
  if (level === "CRITICAL") return "danger";
  if (level === "HIGH" || level === "MEDIUM") return "caution";
  if (level === "LOW") return "verified";
  return "muted";
}

export const TONE_TEXT = { danger: "text-danger", caution: "text-caution", verified: "text-verified", muted: "text-muted" } as const;
export const TONE_BG = { danger: "bg-danger", caution: "bg-caution", verified: "bg-verified", muted: "bg-faint" } as const;
export const TONE_BORDER = { danger: "border-danger/50", caution: "border-caution/40", verified: "border-verified/40", muted: "border-line" } as const;

export const STAGE_LABEL: Record<string, string> = { claims: "Claims", coi: "Conflict of interest", voting: "Voting", execution: "Execution" };

export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
