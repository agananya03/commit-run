import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // DB, Redis and chain integration tests run in parallel files; the default 5 s is too tight under that load.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
