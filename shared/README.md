# shared

The cross-team contract.

- [`schemas/types.ts`](schemas/types.ts): TypeScript source of truth. Never change a field without telling the team.
- [`schemas/json/`](schemas/json): JSON Schemas generated from `types.ts` (for Pydantic models). Regenerate with `npm run gen:schemas`; do not hand-edit.
- [`API.md`](API.md): every rag, sim and backend endpoint with examples.
- [`mocks/`](mocks): canned responses used when `USE_MOCKS=true`. `npm test` checks every mock against its schema.
