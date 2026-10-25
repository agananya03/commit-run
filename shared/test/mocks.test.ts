import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { Chunk, Citation } from "../schemas/types.js";

const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mocksDir = join(root, "mocks");
const schemasDir = join(root, "schemas", "json");

/** Mock file prefix (<endpoint>.<proposalId>.json) -> response type. */
const schemaForMock: Record<string, { type: string; array?: boolean }> = {
  ingest: { type: "Chunk", array: true },
  summarize: { type: "DecisionSummary" },
  "extract-intent": { type: "IntentSpec" },
  simulate: { type: "SimulationResult" },
};

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (text: string): string => `0x${createHash("sha256").update(text, "utf8").digest("hex")}`;

const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const mockFiles = readdirSync(mocksDir).filter((f) => f.endsWith(".json"));

/** Every Citation object nested anywhere in a payload. */
function collectCitations(value: unknown, out: Citation[] = []): Citation[] {
  if (Array.isArray(value)) {
    for (const v of value) collectCitations(v, out);
  } else if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.citations)) out.push(...(obj.citations as Citation[]));
    for (const v of Object.values(obj)) collectCitations(v, out);
  }
  return out;
}

describe("shared mocks", () => {
  it("has at least one mock", () => {
    expect(mockFiles.length).toBeGreaterThan(0);
  });

  it.each(mockFiles)("%s matches its JSON Schema", (file) => {
    const prefix = file.split(".")[0] ?? "";
    const mapping = schemaForMock[prefix];
    expect(mapping, `no schema mapped for mock prefix "${prefix}"`).toBeDefined();
    if (!mapping) return;

    const { definitions } = readJson(join(schemasDir, `${mapping.type}.schema.json`)) as { definitions: object };
    const ref = { $ref: `#/definitions/${mapping.type}` };
    const validate = ajv.compile({ definitions, ...(mapping.array ? { type: "array", items: ref } : ref) });
    const ok = validate(readJson(join(mocksDir, file)));
    expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
    expect(ok).toBe(true);
  });
});

describe.each(["MIP-21"])("%s mock integrity", (proposalId) => {
  const chunks = readJson(join(mocksDir, `ingest.${proposalId}.json`)) as Chunk[];
  const byId = new Map(chunks.map((c) => [c.id, c]));

  it("chunk sha256 is the hash of its text", () => {
    for (const c of chunks) expect(c.sha256, c.id).toBe(sha256(c.text));
  });

  it.each(["summarize", "extract-intent"])("%s citations point at real chunks", (endpoint) => {
    const citations = collectCitations(readJson(join(mocksDir, `${endpoint}.${proposalId}.json`)));
    expect(citations.length).toBeGreaterThan(0);
    for (const cit of citations) {
      const chunk = byId.get(cit.chunkId);
      expect(chunk, `unknown chunk ${cit.chunkId}`).toBeDefined();
      expect(cit.sha256).toBe(chunk?.sha256);
      expect(cit.sourceUri).toBe(chunk?.sourceUri);
      expect(chunk?.text, `quote not found in ${cit.chunkId}`).toContain(cit.quote);
    }
  });
});
