// Bytecode-level facts that need no ABI or source: function selectors (evmole), signature names, risky opcodes.
import { readFileSync } from "node:fs";
import { contractInfo } from "evmole";
import type { ContractBook } from "./deployments.js";

const FOUR_BYTE = new URL("../data/4byte.json", import.meta.url);

/** 0x-prefixed, lowercase, sorted function selectors found in runtime bytecode. */
export function extractSelectors(code: string): string[] {
  if (!code || code === "0x") return [];
  const info = contractInfo(code, { selectors: true });
  return [...new Set((info.functions ?? []).map((f) => `0x${f.selector.toLowerCase().replace(/^0x/, "")}`))].sort();
}

/**
 * Selector -> signature: deployment ABIs first (exact for our contracts), then the bundled 4-byte table.
 * A 4-byte hit with several candidates reports them joined with " | " (collisions are possible by design).
 */
export class SignatureResolver {
  private readonly known = new Map<string, string>();
  private readonly table: Record<string, string[]>;

  constructor(book: ContractBook, table?: Record<string, string[]>) {
    for (const c of book.all()) {
      c.iface.forEachFunction((f) => {
        if (!this.known.has(f.selector)) this.known.set(f.selector, f.format("sighash"));
      });
    }
    this.table = table ?? (JSON.parse(readFileSync(FOUR_BYTE, "utf8")) as { signatures: Record<string, string[]> }).signatures;
  }

  resolve(selector: string): string | undefined {
    const s = selector.toLowerCase();
    return this.known.get(s) ?? this.table[s]?.join(" | ");
  }
}

const DELEGATECALL = 0xf4;
const SELFDESTRUCT = 0xff;

/**
 * Length of the trailing Solidity/Vyper CBOR metadata, which is data, not code: the last two bytes are its
 * big-endian length. Only trusted when the section starts with a CBOR map header (0xa1..0xa7).
 */
function metadataLength(bytes: Uint8Array): number {
  if (bytes.length < 4) return 0;
  const len = (bytes[bytes.length - 2]! << 8) | bytes[bytes.length - 1]!;
  const start = bytes.length - 2 - len;
  if (len === 0 || start < 0) return 0;
  const head = bytes[start]!;
  return head >= 0xa1 && head <= 0xa7 ? len + 2 : 0;
}

/** Walks the instructions, skipping PUSH1..PUSH32 immediates and the metadata trailer. */
export function scanOpcodes(code: string): { delegatecall: boolean; selfdestruct: boolean } {
  const hex = code.replace(/^0x/, "");
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
  const end = bytes.length - metadataLength(bytes);
  const found = { delegatecall: false, selfdestruct: false };
  for (let pc = 0; pc < end; pc++) {
    const op = bytes[pc]!;
    if (op === DELEGATECALL) found.delegatecall = true;
    else if (op === SELFDESTRUCT) found.selfdestruct = true;
    else if (op >= 0x60 && op <= 0x7f) pc += op - 0x5f; // PUSHn carries n bytes of data
  }
  return found;
}
