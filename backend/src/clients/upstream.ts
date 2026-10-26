import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import axios, { type AxiosInstance, type Method } from "axios";
import type { Logger } from "pino";
import type { z } from "zod";
import { ApiError } from "../contracts/schemas.js";
import { HttpError } from "../errors.js";

export interface UpstreamOptions {
  service: "rag" | "sim" | "factcheck";
  baseURL: string;
  timeoutMs: number;
  useMocks: boolean;
  mocksDir: string;
  logger: Pick<Logger, "warn" | "debug">;
  /** For tests. */
  http?: AxiosInstance;
}

export interface CallSpec<T> {
  method: Method;
  path: string;
  body?: unknown;
  schema: z.ZodType<T>;
  /** Mock file in mocksDir used when USE_MOCKS=true or the service is down. */
  mock?: string;
  /** Derives the response from the mock file's content (e.g. pick one chunk). */
  fromMock?: (data: unknown) => unknown;
}

/** No response at all, or a gateway-style status: treat the service as down. */
function isDown(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (!err.response) return true;
  return [502, 503, 504].includes(err.response.status);
}

/**
 * HTTP client for one upstream service. Every response, real or mock, is validated with zod;
 * an invalid real response is a loud 502 UPSTREAM_INVALID, never silently replaced by a mock.
 */
export class Upstream {
  readonly http: AxiosInstance;

  constructor(private readonly opts: UpstreamOptions) {
    this.http = opts.http ?? axios.create({ baseURL: opts.baseURL, timeout: opts.timeoutMs });
  }

  async call<T>(spec: CallSpec<T>): Promise<T> {
    const where = `${this.opts.service} ${spec.method.toUpperCase()} ${spec.path}`;
    if (this.opts.useMocks) {
      this.opts.logger.debug({ mock: spec.mock }, `${where}: USE_MOCKS=true, serving mock`);
      return this.fromMock(spec, where);
    }

    let data: unknown;
    try {
      const res = await this.http.request({ method: spec.method, url: spec.path, data: spec.body });
      data = res.data;
    } catch (err) {
      if (isDown(err)) {
        if (spec.mock && existsSync(join(this.opts.mocksDir, spec.mock))) {
          this.opts.logger.warn({ mock: spec.mock, reason: (err as Error).message }, `${where}: service down, falling back to mock`);
          return this.fromMock(spec, where);
        }
        throw new HttpError(502, "UPSTREAM_UNAVAILABLE", `${where}: service unavailable and no mock to fall back on`);
      }
      throw this.fromErrorResponse(err, where);
    }

    const parsed = spec.schema.safeParse(data);
    if (!parsed.success) {
      throw new HttpError(502, "UPSTREAM_INVALID", `${where}: response does not match the shared schema`, parsed.error.issues.slice(0, 10));
    }
    return parsed.data;
  }

  private fromMock<T>(spec: CallSpec<T>, where: string): T {
    const file = spec.mock ? join(this.opts.mocksDir, spec.mock) : null;
    if (!file || !existsSync(file)) {
      throw new HttpError(502, "UPSTREAM_UNAVAILABLE", `${where}: no mock ${spec.mock ?? "(none defined)"} in ${this.opts.mocksDir}`);
    }
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    const data = spec.fromMock ? spec.fromMock(raw) : raw;
    const parsed = spec.schema.safeParse(data);
    if (!parsed.success) {
      throw new HttpError(502, "UPSTREAM_INVALID", `${where}: mock ${spec.mock} does not match the shared schema`, parsed.error.issues.slice(0, 10));
    }
    return parsed.data;
  }

  /** 4xx/5xx with a body: pass a well-formed ApiError through, otherwise report the upstream as invalid. */
  private fromErrorResponse(err: unknown, where: string): HttpError {
    if (axios.isAxiosError(err) && err.response) {
      const apiError = ApiError.safeParse(err.response.data);
      if (apiError.success) {
        const { code, message, details } = apiError.data.error;
        const status = err.response.status >= 500 ? 502 : err.response.status;
        return new HttpError(status, code, `${where}: ${message}`, details);
      }
      return new HttpError(502, "UPSTREAM_INVALID", `${where}: HTTP ${err.response.status} without an ApiError body`);
    }
    return new HttpError(502, "UPSTREAM_UNAVAILABLE", `${where}: ${(err as Error).message}`);
  }

  /** True if GET /health answers 2xx. */
  async ping(): Promise<boolean> {
    try {
      await this.http.get("/health", { timeout: 1500 });
      return true;
    } catch {
      return false;
    }
  }
}
