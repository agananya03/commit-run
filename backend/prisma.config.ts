import { defineConfig, env } from "prisma/config";
import { loadRootEnv } from "./src/loadRootEnv.js";

// Prisma 7 does not read .env files itself; DATABASE_URL comes from the repo-root .env.
loadRootEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
