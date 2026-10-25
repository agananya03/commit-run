import serialize from "canonicalize";

/**
 * RFC 8785 (JSON Canonicalization Scheme): object keys sorted by UTF-16 code units, no whitespace,
 * ECMAScript number formatting, minimal string escaping. The same logical JSON always yields the
 * same string, so its hash does not depend on key order or formatting.
 *
 * Only plain JSON is accepted: bigint, functions, symbols and undefined at the top level throw.
 * Represent uint256 values as decimal strings.
 */
export function canonicalize(value: unknown): string {
  if (typeof value === "bigint") throw new TypeError("bigint is not JSON; use a decimal string");
  const out = serialize(value);
  if (out === undefined) throw new TypeError("value cannot be canonicalized as JSON");
  return out;
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
