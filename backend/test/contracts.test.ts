// Fails if a zod schema in src/contracts/schemas.ts drifts from the shared JSON Schemas generated from
// /shared/schemas/types.ts (property names, required/optional, nullability, enums, nesting).
// Compared in zod "input" mode: what a rag/sim response must look like to be accepted.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DecisionSummary, Deployments, IntentSpec, SHARED_SCHEMAS, SimulationResult, Chunk } from "../src/contracts/schemas.js";

type Json = Record<string, unknown>;
const sharedDir = fileURLToPath(new URL("../../shared/", import.meta.url));
const readShared = (path: string): Json => JSON.parse(readFileSync(`${sharedDir}${path}`, "utf8")) as Json;

/** Structural shape of a JSON Schema, independent of how $refs, nullables and literals are spelled. */
type Shape =
  | { kind: "any" | "string" | "number" | "boolean" | "null" }
  | { kind: "enum"; values: unknown[] }
  | { kind: "array"; items: Shape }
  | { kind: "object"; props: Record<string, { required: boolean; shape: Shape }>; additional: Shape | false }
  | { kind: "union"; options: Shape[] }
  | { kind: "nullable"; inner: Shape };

function resolve(node: Json, root: Json): Json {
  let n = node;
  while (typeof n.$ref === "string") {
    const path = n.$ref.replace(/^#\//, "").split("/");
    n = path.reduce<Json>((acc, key) => acc[key] as Json, root);
  }
  return n;
}

function shape(raw: Json, root: Json): Shape {
  const node = resolve(raw, root);
  if ("const" in node) return { kind: "enum", values: [node.const] };
  if (Array.isArray(node.enum)) return { kind: "enum", values: [...node.enum].sort() };

  const variants: Json[] = Array.isArray(node.anyOf) ? (node.anyOf as Json[]) : Array.isArray(node.oneOf) ? (node.oneOf as Json[]) : [];
  if (Array.isArray(node.type)) variants.push(...(node.type as string[]).map((t) => ({ ...node, type: t })));
  if (variants.length > 0) {
    const shapes = variants.map((v) => shape(v, root));
    const nonNull = shapes.filter((s) => s.kind !== "null");
    const inner: Shape = nonNull.length === 1 ? nonNull[0]! : { kind: "union", options: nonNull.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
    return nonNull.length < shapes.length ? { kind: "nullable", inner } : inner;
  }

  switch (node.type) {
    case "string":
    case "boolean":
    case "null":
      return { kind: node.type };
    case "number":
    case "integer":
      return { kind: "number" };
    case "array":
      return { kind: "array", items: node.items ? shape(node.items as Json, root) : { kind: "any" } };
    case "object": {
      const required = new Set((node.required as string[] | undefined) ?? []);
      const props: Record<string, { required: boolean; shape: Shape }> = {};
      for (const [k, v] of Object.entries((node.properties as Record<string, Json> | undefined) ?? {})) {
        props[k] = { required: required.has(k), shape: shape(v, root) };
      }
      const ap = node.additionalProperties;
      // JSON Schema default (absent) allows any extra property, same as `true`.
      const additional = ap === false ? false : ap === undefined || ap === true ? ({ kind: "any" } as Shape) : shape(ap as Json, root);
      return { kind: "object", props, additional };
    }
    default:
      return { kind: "any" };
  }
}

const shared = readShared("schemas/json/meridian.schema.json");
const sharedDefs = shared.definitions as Record<string, Json>;

describe("zod schemas match /shared/schemas/json", () => {
  it.each(Object.keys(SHARED_SCHEMAS))("%s", (name) => {
    expect(sharedDefs[name], `${name} missing from shared schemas`).toBeDefined();
    const zodJson = z.toJSONSchema(SHARED_SCHEMAS[name as keyof typeof SHARED_SCHEMAS], { target: "draft-7", io: "input", unrepresentable: "any" }) as Json;
    expect(shape(zodJson, zodJson)).toEqual(shape(sharedDefs[name]!, shared));
  });
});

describe("zod schemas accept the shared mocks", () => {
  const mocks = readdirSync(`${sharedDir}mocks`);
  const schemaFor: Record<string, z.ZodType> = {
    deployments: Deployments,
    ingest: z.array(Chunk),
    summarize: DecisionSummary,
    "extract-intent": IntentSpec,
    simulate: SimulationResult,
  };
  it.each(mocks)("%s", (file) => {
    const schema = schemaFor[file.split(".")[0] ?? ""];
    expect(schema, `no zod schema for ${file}`).toBeDefined();
    const result = schema!.safeParse(readShared(`mocks/${file}`));
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues.slice(0, 3))).toBe(true);
  });
});

describe("drift detection actually detects drift", () => {
  const sharedShape = shape(sharedDefs.Citation!, shared);
  const zodShape = (s: z.ZodType): Shape => {
    const j = z.toJSONSchema(s, { target: "draft-7", io: "input" }) as Json;
    return shape(j, j);
  };
  const base = { chunkId: z.string(), sha256: z.string(), quote: z.string(), sourceUri: z.string() };

  it("matches the correct schema", () => {
    expect(zodShape(z.strictObject(base))).toEqual(sharedShape);
  });

  it.each([
    ["a missing field", z.strictObject({ chunkId: z.string(), sha256: z.string(), quote: z.string() })],
    ["an extra field", z.strictObject({ ...base, page: z.number() })],
    ["a required field made optional", z.strictObject({ ...base, quote: z.string().optional() })],
    ["a field made nullable", z.strictObject({ ...base, quote: z.string().nullable() })],
    ["a changed type", z.strictObject({ ...base, quote: z.number() })],
    ["a non-strict object", z.object(base)],
  ])("flags %s", (_label, schema) => {
    expect(zodShape(schema)).not.toEqual(sharedShape);
  });

  it("flags a changed enum", () => {
    const j = z.toJSONSchema(z.enum(["LOW", "HIGH"]), { target: "draft-7", io: "input" }) as Json;
    const level = (sharedDefs.RiskChain!.properties as Record<string, Json>).level!;
    expect(shape(j, j)).not.toEqual(shape(level, shared));
  });
});
