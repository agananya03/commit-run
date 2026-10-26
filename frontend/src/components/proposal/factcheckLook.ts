import { Check, CircleHelp, X } from "lucide-react";
import type { Ruling, Verdict, WitnessId } from "@/lib/verify/factcheck";

/** the detective's red string: the one non-violet colour on the page, kept for "caught" only */
export const CAUGHT = "#F0566A";

export const VERDICT: Record<Verdict, { label: string; stamp: string; color: string; text: string; ring: string; Icon: typeof Check }> = {
  contradicted: { label: "Caught", stamp: "CAUGHT", color: CAUGHT, text: "text-[#F0566A]", ring: "border-[#F0566A]/40 bg-[#F0566A]/[0.06]", Icon: X },
  supported: { label: "Confirmed", stamp: "CONFIRMED", color: "#C4B5FD", text: "text-ice", ring: "border-ice/25 bg-ice/[0.04]", Icon: Check },
  unclear: { label: "Can't tell", stamp: "CAN'T TELL", color: "#6F6C8C", text: "text-faint", ring: "border-white/[0.07] bg-panel/80", Icon: CircleHelp },
};

export const WITNESS_SUB: Record<WitnessId, string> = {
  code: "what actually runs",
  pdf: "what the author wrote",
  forum: "what people discussed",
  social: "what got posted",
  disclosure: "what the author signed",
};

export const WITNESS_LABEL: Record<WitnessId, string> = { code: "The code", pdf: "Proposal", forum: "Forum", social: "Social", disclosure: "Disclosure" };

export const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** One sentence explaining a ruling, for people who don't know what NLI is. */
export function rulingLine(r: Ruling, quote: string | undefined, by: "code" | "doc" = "code"): string {
  const evidence = quote?.replace(/[.\s]+$/, "");
  const who = by === "code" ? "The code" : "Another source";
  if (r.verdict === "contradicted" && r.exact) return `The code pays a different wallet${evidence ? `: “${evidence}”` : ""}. Checked by exact match.`;
  if (r.verdict === "contradicted") return `${who} says otherwise${evidence ? `: “${evidence}”` : ""}. The model is ${pct(r.score)} sure both can't be true.`;
  if (r.verdict === "supported")
    return r.exact
      ? `Same amount the code actually pays${evidence ? `: “${evidence}”` : ""}. Checked by exact number match.`
      : `${who} agrees${evidence ? `: “${evidence}”` : ""}. The model is ${pct(r.score)} sure they say the same thing.`;
  return "Nothing the code does settles this one, so we don't call it either way.";
}
