/**
 * Natural-language inference on the server, fully local: DeBERTa-v3 (cross-encoder/nli-deberta-v3-small, ONNX
 * int8 via transformers.js) judges whether a premise ENTAILS, CONTRADICTS or is NEUTRAL to a hypothesis.
 * This is the model the research dossier recommends for "does evidence E support claim C?"; no API, CPU only.
 *
 * The weights (~140 MB) download once from Hugging Face into the OS temp dir. On machines whose antivirus
 * intercepts TLS, start Node with NODE_OPTIONS=--use-system-ca for that first download.
 */
import os from "node:os";
import path from "node:path";

export const NLI_MODEL = "Xenova/nli-deberta-v3-small";

export interface NliScores {
  entailment: number;
  contradiction: number;
  neutral: number;
}

interface Loaded {
  tokenizer: (a: string[], o: { text_pair: string[]; padding: boolean; truncation: boolean; max_length?: number }) => unknown;
  model: ((inputs: unknown) => Promise<{ logits: { data: Float32Array; dims: number[] } }>) & { config: { id2label: Record<string, string> } };
}

let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const T = await import("@huggingface/transformers");
    T.env.cacheDir = path.join(os.tmpdir(), "poi-models");
    const tokenizer = await T.AutoTokenizer.from_pretrained(NLI_MODEL);
    const model = await T.AutoModelForSequenceClassification.from_pretrained(NLI_MODEL, { dtype: "q8" });
    return { tokenizer, model } as unknown as Loaded;
  })().catch((err: unknown) => {
    loading = null; // allow a retry on the next request
    throw err;
  });
  return loading;
}

/** Starts loading the model in the background (first request otherwise pays the ~2 s load). */
export function warmNli(): void {
  void load().catch(() => {});
}

/**
 * Scores many (premise, hypothesis) pairs. Batched 16 at a time; returns null when the model can't load,
 * so callers can say "model unavailable" instead of inventing a verdict.
 */
export async function nliBatch(pairs: [premise: string, hypothesis: string][]): Promise<NliScores[] | null> {
  let m: Loaded;
  try {
    m = await load();
  } catch {
    return null;
  }
  const labels = m.model.config.id2label;
  const out: NliScores[] = [];
  for (let i = 0; i < pairs.length; i += 16) {
    const chunk = pairs.slice(i, i + 16);
    const inputs = m.tokenizer(
      chunk.map((p) => p[0]),
      { text_pair: chunk.map((p) => p[1]), padding: true, truncation: true, max_length: 256 },
    );
    const { logits } = await m.model(inputs);
    const width = logits.dims[1] ?? 3;
    for (let r = 0; r < chunk.length; r++) {
      const row = Array.from(logits.data.slice(r * width, r * width + width));
      const max = Math.max(...row);
      const exp = row.map((x) => Math.exp(x - max));
      const sum = exp.reduce((a, b) => a + b, 0);
      const s: NliScores = { entailment: 0, contradiction: 0, neutral: 0 };
      exp.forEach((x, k) => {
        const label = labels[k] as keyof NliScores | undefined;
        if (label) s[label] = x / sum;
      });
      out.push(s);
    }
  }
  return out;
}
