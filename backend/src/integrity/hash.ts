import { keccak256 } from "ethers";
import { canonicalBytes } from "./canonicalize.js";

export type Hex32 = `0x${string}`;

/** prevHash of the first version. */
export const ZERO_HASH: Hex32 = `0x${"0".repeat(64)}`;

const HEX32 = /^0x[0-9a-f]{64}$/;

export function isHex32(value: unknown): value is Hex32 {
  return typeof value === "string" && HEX32.test(value);
}

/** keccak256 over the RFC 8785 canonical UTF-8 bytes of a JSON value. */
export function hashCanonical(value: unknown): Hex32 {
  return keccak256(canonicalBytes(value)) as Hex32;
}
