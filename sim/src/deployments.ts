import { existsSync, readFileSync } from "node:fs";
import { Interface } from "ethers";
import type { Logger } from "pino";
import { Deployments, type DeploymentsT } from "./schema.js";

export interface KnownContract {
  name: string;
  address: string; // lowercase
  iface: Interface;
}

/** Name/address/ABI lookups over deployments/localhost.json. Addresses are compared lowercase. */
export class ContractBook {
  readonly byAddress = new Map<string, KnownContract>();

  constructor(readonly deployments: DeploymentsT) {
    for (const [name, c] of Object.entries(deployments.contracts)) {
      this.byAddress.set(c.address.toLowerCase(), { name, address: c.address.toLowerCase(), iface: new Interface(c.abi as never) });
    }
  }

  get(name: string): KnownContract {
    const c = [...this.byAddress.values()].find((k) => k.name === name);
    if (!c) throw new Error(`${name} missing from deployments`);
    return c;
  }

  at(address: string): KnownContract | undefined {
    return this.byAddress.get(address.toLowerCase());
  }

  all(): KnownContract[] {
    return [...this.byAddress.values()];
  }
}

export function loadDeployments(primary: string, fallback: string, logger: Pick<Logger, "warn">): { deployments: DeploymentsT; source: string } {
  const source = existsSync(primary) ? primary : fallback;
  if (source === fallback) logger.warn({ primary, fallback }, "contracts deployments file not found; using the shared mock");
  return { deployments: Deployments.parse(JSON.parse(readFileSync(source, "utf8"))), source };
}
