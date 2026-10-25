# backend

Express + TypeScript (ESM, strict) API on **:4000**. Prisma + PostgreSQL (pgvector), BullMQ on Redis, Socket.IO for live analysis progress, Swagger at `/docs`.

Orchestrates the analysis pipeline: ingest (rag) → summarize / extract-intent (rag) → simulate (sim) → COI graph → 4-stage risk score → hash-chained evidence commit → `GovernanceGuard.flag()` on deviation.

Contract: [`/shared/schemas/types.ts`](../shared/schemas/types.ts) · Endpoints: [`/shared/API.md`](../shared/API.md)

Owner: backend. Status: not started.
