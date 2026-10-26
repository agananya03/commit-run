import { answer, type ChatEvent, type ChatMessage } from "@/lib/chat/server";
import { verifyAnswer } from "@/lib/verify/answer";
import { warmNli } from "@/lib/verify/nli";

warmNli(); // the sentence checker's model loads while the first answer streams

// Node runtime: the assistant reads /data and the root .env from disk. Never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGES = 16;
const MAX_CHARS = 2000;

function parse(body: unknown): { messages: ChatMessage[]; page: string | null } | null {
  if (typeof body !== "object" || body === null) return null;
  const { messages, page } = body as { messages?: unknown; page?: unknown };
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const clean: ChatMessage[] = [];
  for (const m of messages.slice(-MAX_MESSAGES)) {
    const role = (m as ChatMessage)?.role;
    const text = (m as ChatMessage)?.text;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string" || !text.trim()) return null;
    clean.push({ role, text: text.slice(0, MAX_CHARS) });
  }
  if (clean.at(-1)?.role !== "user") return null;
  return { messages: clean, page: typeof page === "string" && /^[A-Z]+-\d+$/.test(page) ? page : null };
}

/**
 * POST /api/chat {messages:[{role,text}], page?} → newline-delimited JSON events:
 * sources, delta…, then checking + verify (every sentence fact-checked by the NLI model), then done.
 */
export async function POST(req: Request) {
  const input = parse(await req.json().catch(() => null));
  if (!input) return Response.json({ error: "Send {messages:[{role:'user', text}], page?}" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      let full = "";
      let sources: Extract<ChatEvent, { type: "sources" }> | null = null;
      try {
        for await (const event of answer(input.messages, input.page)) {
          if (event.type === "sources") sources = event;
          if (event.type === "delta") full += event.text;
          if (event.type === "done" && sources && full) {
            send({ type: "checking" });
            try {
              for await (const verified of verifyAnswer(full, sources)) send(verified);
            } catch {
              // a failed check never breaks the answer
            }
          }
          send(event);
        }
      } catch {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message: "The assistant hit a problem. Try again." })}\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
