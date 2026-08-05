// ─────────────────────────────────────────────────────────────────────────────
// Server-side end-of-utterance scoring — LiveKit's open turn-detector model.
//
// The model (https://huggingface.co/livekit/turn-detector, a fine-tuned
// SmolLM ~135M) predicts whether a speaker has finished from the SEMANTIC
// content of the transcript. LiveKit runs it server-side in their agents
// framework; this scorer does the same in Node via transformers.js:
// format the transcript with the chat template, strip the trailing
// <|im_end|>, run the LM, and read P(<|im_end|>) at the final position —
// the probability that the model would end the utterance right here.
//
// IMPORTANT: the model was trained on NORMALIZED transcripts (lowercased,
// punctuation stripped) because STT punctuation is unreliable. Scoring raw
// punctuated text inverts the signal; this scorer normalizes internally.
// Measured on a quantized CPU build: ~20-30ms per score after warmup.
//
// transformers.js is an OPTIONAL dependency — install `@huggingface/transformers`
// in the consuming app and (recommended under pnpm's strict node_modules)
// inject the module via `transformers` so resolution happens in the app:
//
//   import * as transformers from "@huggingface/transformers";
//   const scorer = new LiveKitEouScorer({ transformers });
//   const p = await scorer.probability([{ role: "user", content: partial }]);
// ─────────────────────────────────────────────────────────────────────────────

export interface EouMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LiveKitEouScorerConfig {
  /** HF repo id (default "livekit/turn-detector"). */
  repo?: string;
  /** Quantization/dtype passed to transformers.js (default "q8"). */
  dtype?: string;
  /**
   * The imported `@huggingface/transformers` module. Recommended — under
   * pnpm's isolated node_modules a dynamic import from inside glove-voice
   * may not resolve the app's copy. Falls back to a dynamic import.
   */
  transformers?: unknown;
  /** Cap on transcript history tokens fed to the model (default 256). */
  maxTokens?: number;
}

interface TransformersModule {
  AutoTokenizer: { from_pretrained(repo: string): Promise<Tokenizer> };
  AutoModelForCausalLM: {
    from_pretrained(repo: string, opts: Record<string, unknown>): Promise<Model>;
  };
}
interface Tokenizer {
  apply_chat_template(
    messages: EouMessage[],
    opts: Record<string, unknown>,
  ): string;
  (text: string, opts: Record<string, unknown>): Record<string, unknown>;
  encode(text: string, opts: Record<string, unknown>): number[];
}
type Model = (inputs: Record<string, unknown>) => Promise<{
  logits: { dims: number[]; data: Float32Array | number[] };
}>;

const EOU_TOKEN = "<|im_end|>";

/** Lowercase + strip punctuation — the shape the model was trained on. */
export function normalizeForEou(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class LiveKitEouScorer {
  private tokenizer: Tokenizer | null = null;
  private model: Model | null = null;
  private eouId = -1;
  private initing: Promise<void> | null = null;
  private readonly repo: string;
  private readonly dtype: string;
  private readonly injected?: unknown;

  constructor(cfg: LiveKitEouScorerConfig = {}) {
    this.repo = cfg.repo ?? "livekit/turn-detector";
    this.dtype = cfg.dtype ?? "q8";
    this.injected = cfg.transformers;
  }

  /** Idempotent; the first call downloads the weights into the HF cache. */
  async init(): Promise<void> {
    if (this.model) return;
    if (this.initing) return this.initing;
    this.initing = (async () => {
      let mod = this.injected as TransformersModule | undefined;
      if (!mod) {
        try {
          // Bare-specifier dynamic import so the OPTIONAL dependency resolves
          // from the consuming app when possible (not typed here on purpose —
          // glove-voice does not depend on the package).
          const specifier = "@huggingface/transformers";
          mod = (await import(/* webpackIgnore: true */ specifier)) as unknown as TransformersModule;
        } catch {
          throw new Error(
            "LiveKitEouScorer needs @huggingface/transformers. Install it in your app " +
              "and pass it in: new LiveKitEouScorer({ transformers: await import('@huggingface/transformers') })",
          );
        }
      }
      this.tokenizer = await mod.AutoTokenizer.from_pretrained(this.repo);
      // This repo keeps its ONNX files at the root, not the conventional
      // onnx/ subfolder transformers.js defaults to.
      this.model = await mod.AutoModelForCausalLM.from_pretrained(this.repo, {
        dtype: this.dtype,
        subfolder: "",
      });
      this.eouId = this.tokenizer.encode(EOU_TOKEN, { add_special_tokens: false })[0];
    })();
    try {
      await this.initing;
    } finally {
      this.initing = null;
    }
  }

  /**
   * P(end of utterance) in [0,1] for the LAST message. Pass recent turns for
   * context when available — the model is more accurate with the other
   * side's preceding line. Content is normalized internally.
   */
  async probability(messages: EouMessage[]): Promise<number> {
    await this.init();
    const tokenizer = this.tokenizer!;
    const model = this.model!;
    const normalized = messages
      .map((m) => ({ role: m.role, content: normalizeForEou(m.content) }))
      .filter((m) => m.content);
    if (normalized.length === 0) return 0;

    const chat = tokenizer.apply_chat_template(normalized, {
      add_generation_prompt: false,
      tokenize: false,
    });
    const cut = chat.lastIndexOf(EOU_TOKEN);
    const trimmed = cut >= 0 ? chat.slice(0, cut) : chat;
    const inputs = tokenizer(trimmed, { add_special_tokens: false });
    const out = await model(inputs);
    const [, seq, vocab] = out.logits.dims;
    const data = out.logits.data;
    const off = (seq - 1) * vocab;
    let max = -Infinity;
    for (let i = 0; i < vocab; i++) if (data[off + i] > max) max = data[off + i];
    let denom = 0;
    for (let i = 0; i < vocab; i++) denom += Math.exp(data[off + i] - max);
    return Math.exp(data[off + this.eouId] - max) / denom;
  }
}
