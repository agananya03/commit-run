import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mocksDir = join(root, "mocks");
const schemasDir = join(root, "schemas", "json");

/** Mock file prefix (<endpoint>.<proposalId>.json) -> response schema. */
const schemaForMock: Record<string, string> = {
  ingest: "IngestResponse",
  summarize: "SummarizeResponse",
  "extract-intent": "ExtractIntentResponse",
  simulate: "SimulateResponse",
};

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const mockFiles = readdirSync(mocksDir).filter((f) => f.endsWith(".json"));

describe("shared mocks", () => {
  it("has at least one mock", () => {
    expect(mockFiles.length).toBeGreaterThan(0);
  });

  it.each(mockFiles)("%s matches its JSON Schema", (file) => {
    const prefix = file.split(".")[0] ?? "";
    const schemaName = schemaForMock[prefix];
    expect(schemaName, `no schema mapped for mock prefix "${prefix}"`).toBeDefined();

    const schema = readJson(join(schemasDir, `${schemaName}.schema.json`)) as object;
    const validate = ajv.compile(schema);
    const ok = validate(readJson(join(mocksDir, file)));
    expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
    expect(ok).toBe(true);
  });
});
