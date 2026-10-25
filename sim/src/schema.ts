// Request/response contract of the sim service, mirroring /shared/schemas/types.ts. Objects are strict like the
// shared JSON Schemas (additionalProperties: false); test/simulate.chain.test.ts also validates real results
// against /shared/schemas/json/SimulationResult.schema.json.
import { z } from "zod";

const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte 0x address");
const Hex = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, "expected 0x hex bytes");

export const SimulateRequest = z
  .strictObject({
    proposalId: z.string().min(1),
    targets: z.array(Address).min(1),
    values: z.array(z.string().regex(/^\d+$/, "values are wei as decimal strings")),
    calldatas: z.array(Hex),
    forkBlock: z.number().int().nonnegative().optional(),
  })
  .refine((r) => r.targets.length === r.values.length && r.values.length === r.calldatas.length, "targets, values and calldatas must have the same length");

export type SimulateRequestT = z.infer<typeof SimulateRequest>;

const SelectorRef = z.strictObject({ selector: z.string(), signature: z.string().optional() });

export const SimulationResult = z.strictObject({
  proposalId: z.string(),
  success: z.boolean(),
  revertReason: z.string().optional(),
  decodedCalls: z.array(z.strictObject({
    target: z.string(),
    contractName: z.string().optional(),
    selector: z.string(),
    signature: z.string().optional(),
    args: z.array(z.unknown()),
  })),
  tokenTransfers: z.array(z.strictObject({ token: z.string(), from: z.string(), to: z.string(), amount: z.string() })),
  approvals: z.array(z.strictObject({ token: z.string(), owner: z.string(), spender: z.string(), amount: z.string() })),
  ownershipChanges: z.array(z.strictObject({ contract: z.string(), role: z.string(), before: z.string(), after: z.string() })),
  implementationChanges: z.array(z.strictObject({
    proxy: z.string(),
    before: z.string(),
    after: z.string(),
    addedSelectors: z.array(SelectorRef),
    removedSelectors: z.array(SelectorRef),
  })),
  storageDiffs: z.array(z.strictObject({ contract: z.string(), slot: z.string(), before: z.string(), after: z.string() })),
  events: z.array(z.strictObject({ contract: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()) })),
  bytecodeHash: z.string(),
  simHash: z.string(),
});

export type SimulationResultT = z.infer<typeof SimulationResult>;
export type DecodedCallT = SimulationResultT["decodedCalls"][number];

export const Deployments = z.object({
  chainId: z.number(),
  deployBlock: z.number(),
  contracts: z.record(z.string(), z.object({ address: z.string(), abi: z.array(z.unknown()), decimals: z.number().optional() })),
});

export type DeploymentsT = z.infer<typeof Deployments>;
