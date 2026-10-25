import type { Finding } from "@/types/shared";
import type { RadarRow } from "@/lib/radar";

/** The findings, said the way a token holder would say them. */
export const PLAIN_FINDING: Record<Finding["category"], string> = {
  ownership_change: "Quietly hands control of the vault to someone else.",
  unlimited_approval: "Lets one wallet spend the treasury without limit.",
  new_privileged_function: "Adds hidden admin powers nobody mentioned.",
  amount_mismatch: "Asks for a different amount than it says.",
  recipient_mismatch: "Sends the money somewhere other than promised.",
  undeclared_action: "Does things the proposal never mentioned.",
  coi: "The proposer is secretly linked to whoever gets paid.",
  unsupported_claim: "Makes claims it can't back up.",
  contradiction: "Contradicts itself.",
};

export interface Verdict {
  word: string;
  why: string;
  status: string;
  tone: "danger" | "caution" | "verified" | "muted";
}

export function verdictOf(row: RadarRow): Verdict {
  const why = row.topFinding ? PLAIN_FINDING[row.topFinding.category] : "Does exactly what it says.";
  const status =
    row.state === "HALTED"
      ? "Frozen before it could run"
      : row.state === "QUEUED"
      ? "Waiting to run"
      : row.state === "EXECUTED"
      ? "Already ran"
      : row.state === "DEFEATED"
      ? "Voted down"
      : "Vote in progress";
  if (row.state === "HALTED") return { word: "Stopped", why, status, tone: "danger" };
  if (row.action === "halt") return { word: "Should be stopped", why, status, tone: "danger" };
  if (row.action === "review" || row.level === "HIGH" || row.level === "MEDIUM") return { word: "Needs a closer look", why, status, tone: "caution" };
  if (row.level === "LOW") return { word: "Looks safe", why, status, tone: "verified" };
  return { word: "Not checked yet", why: "The watchdog hasn't finished reading this one.", status, tone: "muted" };
}

/** The four checks, in everyday words. */
export const CHECKS = [
  { stage: "claims", label: "Promises" },
  { stage: "coi", label: "Connections" },
  { stage: "voting", label: "Votes" },
  { stage: "execution", label: "Code" },
] as const;

export function checkTone(row: RadarRow, stage: string): "danger" | "caution" | "verified" | "muted" {
  const s = row.stages.find((x) => x.stage === stage);
  if (!s) return "muted";
  if (s.likelihoodRatio >= 5) return "danger";
  if (s.likelihoodRatio >= 1.5) return "caution";
  return "verified";
}
