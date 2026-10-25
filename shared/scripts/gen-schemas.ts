/**
 * Generates JSON Schemas from schemas/types.ts:
 * - schemas/json/<Type>.schema.json: one self-contained schema per exported
 *   interface / union / enum (primitive aliases like Address are inlined).
 * - schemas/json/meridian.schema.json: every type in one file, for Pydantic codegen.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGenerator, type Config } from "ts-json-schema-generator";

type JsonSchema = Record<string, unknown>;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "schemas", "json");

const config: Config = {
  path: join(root, "schemas", "types.ts"),
  tsconfig: join(root, "tsconfig.json"),
  expose: "export",
  jsDoc: "extended",
  additionalProperties: false,
  sortProps: true,
  skipTypeCheck: true,
};

const generator = createGenerator(config);

function write(file: string, schema: unknown): void {
  writeFileSync(join(outDir, file), `${JSON.stringify(schema, null, 2)}\n`);
}

/** Plain string/number aliases (Address, Uint256, ...) without an enum. */
function isPrimitiveAlias(def: JsonSchema): boolean {
  return (def.type === "string" || def.type === "number") && !("enum" in def);
}

const all = generator.createSchema("*");
const definitions = (all.definitions ?? {}) as Record<string, JsonSchema>;

mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(outDir)) {
  if (file.endsWith(".schema.json")) rmSync(join(outDir, file));
}

const names = Object.keys(definitions)
  .filter((name) => !isPrimitiveAlias(definitions[name] as JsonSchema))
  .sort();

for (const name of names) {
  write(`${name}.schema.json`, {
    $id: `https://proofofintent.local/schemas/${name}.schema.json`,
    ...generator.createSchema(name),
  });
}

write("meridian.schema.json", {
  $id: "https://proofofintent.local/schemas/meridian.schema.json",
  title: "Meridian",
  ...all,
});

console.log(`wrote ${names.length} schemas + meridian.schema.json to ${outDir}`);
