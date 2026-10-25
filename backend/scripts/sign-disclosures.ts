/**
 * Dev only: signs each data/scenarios/<slug>/disclosure.json with its proposer's Hardhat key, so the demo
 * has valid disclosures. D's files ({ proposerIndex, walletIndices, statement }) stay untouched; the signed
 * DisclosureRequest bodies are written to backend/fixtures/disclosures/<slug>.json.
 *
 *   npm run disclosures:sign              # write the signed bodies
 *   npm run disclosures:sign -- --post    # also POST them to the running backend (seals a new version each)
 *
 * The Hardhat mnemonic is public; these keys only ever sign on the local chain.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HDNodeWallet } from "ethers";
import { disclosureMessage, type DisclosureBodyT } from "../src/coi/disclosure.js";
import { loadRootEnv, repoRoot } from "../src/loadRootEnv.js";
import { hardhatAddress } from "../src/seed/scenarios.js";

const MNEMONIC = "test test test test test test test test test test test junk";

loadRootEnv();
const post = process.argv.includes("--post");
const backend = process.env.BACKEND_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const scenarios = join(process.env.DATA_DIR ?? join(repoRoot, "data"), "scenarios");
const outDir = join(repoRoot, "backend", "fixtures", "disclosures");
mkdirSync(outDir, { recursive: true });

let failed = false;
for (const slug of readdirSync(scenarios).filter((s) => /^MIP-\d+$/.test(s)).sort()) {
  const file = join(scenarios, slug, "disclosure.json");
  if (!existsSync(file)) continue;
  const raw = JSON.parse(readFileSync(file, "utf8")) as { proposerIndex?: number; walletIndices?: number[]; statement?: string };
  if (raw.proposerIndex === undefined || !raw.statement) {
    console.error(`${slug}: disclosure.json needs proposerIndex and statement; skipped`);
    failed = true;
    continue;
  }

  const signer = HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${raw.proposerIndex}`);
  const wallets = (raw.walletIndices ?? []).map((i) => hardhatAddress(i).toLowerCase()).sort();
  const message = disclosureMessage(slug, wallets, raw.statement);
  const body: DisclosureBodyT = { proposer: signer.address, wallets, statement: raw.statement, signature: await signer.signMessage(message) };
  const out = join(outDir, `${slug}.json`);
  writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`${slug}: signed by #${raw.proposerIndex} ${signer.address} -> ${out}`);

  if (post) {
    const res = await fetch(`${backend}/proposals/${slug}/disclosure`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as { pCoi?: number; undisclosedLinks?: unknown[]; error?: { code: string; message: string } };
    if (res.ok) console.log(`  posted: pCoi ${json.pCoi}, ${json.undisclosedLinks?.length ?? 0} undisclosed link(s)`);
    else if (res.status === 409) console.log(`  already in the latest version (${json.error?.message})`);
    else {
      console.error(`  POST failed ${res.status}: ${json.error?.code} ${json.error?.message}`);
      failed = true;
    }
  }
}
process.exitCode = failed ? 1 : 0;
