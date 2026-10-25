/** Copy for the intro. Kept free of three.js imports so the static fallback can use it too. */

export type Section = {
  eyebrow: string;
  title: string;
  body?: string;
  align: "left" | "right" | "center";
};

/** One section per scroll page; each lines up with a beat of the scene timeline in Scene.tsx. */
export const SECTIONS: Section[] = [
  { eyebrow: "Meridian DAO · governance watchdog", title: "PROOF OF INTENT", body: "Scroll to see what the vote didn't.", align: "left" },
  {
    eyebrow: "01 · the pitch",
    title: "DAOs vote on what they're told.",
    body: "MIP-21 promised storage packing and cheaper deposits. 70.6M MRD voted for it.",
    align: "right",
  },
  {
    eyebrow: "02 · the payload",
    title: "…not on what the code does.",
    body: "Inside the calldata: a new owner, an unlimited USDC approval, and a function nobody mentioned.",
    align: "left",
  },
  {
    eyebrow: "03 · evidence",
    title: "Every word, hash-chained.",
    body: "Forum posts, PDFs, socials and calldata, canonicalised, keccak-linked and committed on-chain. Quiet edits can't hide.",
    align: "right",
  },
  {
    eyebrow: "04 · conflicts",
    title: "Hidden ties, mapped.",
    body: "Funding trails link the proposer to the wallet that receives the approval.",
    align: "left",
  },
  {
    eyebrow: "05 · enforcement",
    title: "Then it stops.",
    body: "Execution deviates from intent → GovernanceGuard.flag() → the Timelock operation reverts.",
    align: "right",
  },
  { eyebrow: "06 · verdict", title: "HALTED.", align: "center" },
];
