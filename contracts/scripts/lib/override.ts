import { ethers } from "ethers";

/**
 * The token holders' answer to a watchdog flag: a normal governance proposal whose only call is
 * GovernanceGuard.clear(operationId). GovernanceGuard.clear() accepts only the timelock, so a passed vote is the
 * only way to lift a flag, and a cleared operation can never be flagged again.
 */

/** GovernorTimelockControl salt: bytes20(governor) XOR descriptionHash. */
export function governorSalt(governor: string, descriptionHash: string): string {
  return ethers.toBeHex((BigInt(governor) << 96n) ^ BigInt(descriptionHash), 32);
}

export interface OverrideProposal {
  targets: string[];
  values: bigint[];
  calldatas: string[];
  description: string;
}

/**
 * label is written without a dash ("MIP 21") on purpose: the backend links Governor proposals to its records by a
 * "MIP-21"-style slug in the description, and the override must not be mistaken for MIP-21 itself.
 */
export function overrideProposal(guardAddress: string, operationId: string, label: string): OverrideProposal {
  const guard = new ethers.Interface(["function clear(bytes32 operationId)"]);
  return {
    targets: [guardAddress],
    values: [0n],
    calldatas: [guard.encodeFunctionData("clear", [operationId])],
    description: `# Override: token holders clear the watchdog flag on ${label.replace(/-/g, " ")} (operation ${operationId})`,
  };
}
