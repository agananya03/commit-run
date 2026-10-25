import { checkClaim, factCheck } from "@/lib/verify/factcheck";

// Node runtime: runs the local DeBERTa NLI model (onnxruntime-node) and reads /data from disk.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/factcheck {proposalId}          → the cross-examination board (cached per proposal)
 * POST /api/factcheck {proposalId, claim}   → a ruling on one new sentence ("try to lie to it")
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { proposalId?: unknown; claim?: unknown } | null;
  const slug = typeof body?.proposalId === "string" && /^[A-Z]+-\d+$/.test(body.proposalId) ? body.proposalId : null;
  if (!slug) return Response.json({ error: "Send {proposalId: 'MIP-21', claim?: string}" }, { status: 400 });

  if (typeof body?.claim === "string") {
    const claim = body.claim.trim().slice(0, 400);
    if (claim.length < 8) return Response.json({ error: "Write a full sentence to check." }, { status: 400 });
    const result = await checkClaim(slug, claim);
    return result ? Response.json(result) : Response.json({ error: `Unknown proposal ${slug}` }, { status: 404 });
  }

  const board = await factCheck(slug);
  return board ? Response.json(board) : Response.json({ error: `Unknown proposal ${slug}` }, { status: 404 });
}
