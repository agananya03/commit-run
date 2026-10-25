import type { SimulateRequest } from "../../../shared/schemas/types.js";
import { Deployments, SimulationResult } from "../contracts/schemas.js";
import { Upstream, type UpstreamOptions } from "./upstream.js";

/** Typed client for the sim service (C). Mocks: simulate.<proposalId>.json and deployments.json. */
export class SimClient {
  private readonly upstream: Upstream;

  constructor(opts: Omit<UpstreamOptions, "service">) {
    this.upstream = new Upstream({ ...opts, service: "sim" });
  }

  simulate(req: SimulateRequest) {
    return this.upstream.call({ method: "post", path: "/simulate", body: req, schema: SimulationResult, mock: `simulate.${req.proposalId}.json` });
  }

  deployments() {
    return this.upstream.call({ method: "get", path: "/deployments", schema: Deployments, mock: "deployments.json" });
  }

  /** Fresh chain; no mock (a reset cannot be faked). */
  reset() {
    return this.upstream.call({ method: "post", path: "/reset", schema: Deployments });
  }

  ping() {
    return this.upstream.ping();
  }
}
