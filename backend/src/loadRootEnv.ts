import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Repo root (one level above /backend). */
export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Loads the repo-root .env if present. Variables already set in the environment win. */
export function loadRootEnv(): void {
  const file = fileURLToPath(new URL("../../.env", import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}
