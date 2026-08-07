// The prompt pipeline — enhancer "inbetweens" that turn a raw intent into
// the final image-model request. Each stage is a small named transform;
// runPipeline snapshots the working prompt after every stage so the final
// request is fully explainable.

import type { ModelAdapter, NotifySubscribersFunction } from "glove-core";
import {
  type CharacterDef,
  type GenerationParams,
  type ImageAssetStore,
  type ImageLibraryReader,
  type ImageModelCapabilities,
  type ImageUsage,
  type RefImage,
  type SceneDef,
  type TraceEntry,
  ImageCharacterNotFoundError,
  ImageSceneNotFoundError,
} from "../core/index";

// ─── Draft & enhancer contracts ────────────────────────────────────────────

export interface PromptDraft {
  /** The original ask — never mutated. */
  intent: string;
  /** The working prompt. */
  positive: string;
  negative?: string;
  /** Accumulated reference images. */
  refs: RefImage[];
  params: GenerationParams;
  /** Library names requested on the call. Resolved by expand* inbetweens. */
  requested: { characters: string[]; scene?: string };
  /** Filled by expandCharacters(). */
  characters: CharacterDef[];
  /** Filled by expandScenes(). */
  scene?: SceneDef;
  trace: TraceEntry[];
}

export interface EnhancerContext {
  library: ImageLibraryReader;
  assets: Pick<ImageAssetStore, "get" | "list">;
  /** An LLM slot for rewrite passes. Usually the agent's own model. */
  model?: ModelAdapter;
  /** What the target image model supports. */
  capabilities: ImageModelCapabilities;
  /** Attach an explanation to this stage's trace entry. */
  note(message: string): void;
  /**
   * Report model spend this stage incurred (LLM rewrite passes etc.).
   * The mount aggregates it into the session UsageMeter under "enhance".
   */
  recordUsage(usage: Partial<ImageUsage>): void;
  signal?: AbortSignal;
}

export interface PromptEnhancer {
  name: string;
  /** Return the (possibly new) draft, or void to keep the mutated one. */
  run(draft: PromptDraft, ctx: EnhancerContext): Promise<PromptDraft | void>;
}

export function createDraft(args: {
  intent: string;
  characters?: string[];
  scene?: string;
  refs?: RefImage[];
  negative?: string;
  params?: GenerationParams;
}): PromptDraft {
  return {
    intent: args.intent,
    positive: args.intent,
    negative: args.negative,
    refs: args.refs ? [...args.refs] : [],
    params: { ...args.params },
    requested: { characters: args.characters ?? [], scene: args.scene },
    characters: [],
    scene: undefined,
    trace: [],
  };
}

/**
 * Run a draft through the inbetweens in order. Appends one TraceEntry per
 * stage. Throws whatever an enhancer throws (missing character/scene names
 * are real errors, not silent skips).
 */
export async function runPipeline(
  draft: PromptDraft,
  enhancers: PromptEnhancer[],
  ctx: Omit<EnhancerContext, "note" | "recordUsage"> & {
    recordUsage?: (usage: Partial<ImageUsage>) => void;
  },
): Promise<PromptDraft> {
  let current = draft;
  for (const enhancer of enhancers) {
    const notes: string[] = [];
    const stageCtx: EnhancerContext = {
      ...ctx,
      note: (message) => notes.push(message),
      recordUsage: ctx.recordUsage ?? (() => {}),
    };
    const result = await enhancer.run(current, stageCtx);
    if (result) current = result;
    current.trace.push({
      enhancer: enhancer.name,
      note: notes.length ? notes.join(" ") : undefined,
      positive_after: current.positive,
    });
  }
  return current;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function mergeNegative(existing: string | undefined, incoming?: string): string | undefined {
  if (!incoming) return existing;
  if (!existing) return incoming;
  const have = new Set(existing.split(",").map((s) => s.trim().toLowerCase()));
  const extra = incoming
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !have.has(s.toLowerCase()));
  return extra.length ? `${existing}, ${extra.join(", ")}` : existing;
}

function addRefs(draft: PromptDraft, refs: RefImage[]): void {
  const have = new Set(draft.refs.map((r) => `${r.asset}:${r.role}`));
  for (const ref of refs) {
    const key = `${ref.asset}:${ref.role}`;
    if (!have.has(key)) {
      draft.refs.push(ref);
      have.add(key);
    }
  }
}

// ─── Built-in inbetweens ───────────────────────────────────────────────────

/**
 * Resolve each requested character name against the library: splice its
 * canonical appearance block VERBATIM into the prompt, merge its negative,
 * and attach its reference images as identity refs. A missing name throws —
 * a clear error naming the miss beats silent drift.
 */
export function expandCharacters(): PromptEnhancer {
  return {
    name: "expand-characters",
    async run(draft, ctx) {
      if (draft.requested.characters.length === 0) return;
      const blocks: string[] = [];
      for (const name of draft.requested.characters) {
        const def = await ctx.library.getCharacter(name);
        if (!def) {
          const available = (await ctx.library.listCharacters()).map((c) => c.name);
          throw new ImageCharacterNotFoundError(name, available);
        }
        draft.characters.push(def);
        blocks.push(`${def.display_name ?? def.name}: ${def.appearance}`);
        draft.negative = mergeNegative(draft.negative, def.negative);
        if (def.ref_images?.length) {
          addRefs(
            draft,
            def.ref_images.map((r) => ({ asset: r.asset, role: "identity" as const })),
          );
        }
      }
      draft.positive = `${draft.positive}\n\nCharacters (keep these descriptions exact):\n${blocks.join("\n")}`;
      ctx.note(`Expanded ${draft.characters.length} character(s).`);
    },
  };
}

/**
 * Resolve the requested scene: splice its setting block verbatim, merge its
 * negative, attach its style/composition refs.
 */
export function expandScenes(): PromptEnhancer {
  return {
    name: "expand-scenes",
    async run(draft, ctx) {
      const name = draft.requested.scene;
      if (!name) return;
      const def = await ctx.library.getScene(name);
      if (!def) {
        const available = (await ctx.library.listScenes()).map((s) => s.name);
        throw new ImageSceneNotFoundError(name, available);
      }
      draft.scene = def;
      draft.positive = `${draft.positive}\n\nSetting: ${def.setting}`;
      draft.negative = mergeNegative(draft.negative, def.negative);
      if (def.ref_images?.length) {
        addRefs(
          draft,
          def.ref_images.map((r) => ({ asset: r.asset, role: r.role })),
        );
      }
      ctx.note(`Expanded scene "${def.name}".`);
    },
  };
}

/** Append a fixed house-style clause. The dumb, reliable one. */
export function styleDirective(text: string): PromptEnhancer {
  return {
    name: "style-directive",
    async run(draft) {
      draft.positive = `${draft.positive}\n\nStyle: ${text}`;
    },
  };
}

/** Merge a standing negative list without clobbering per-call negatives. */
export function negativeDefaults(list: string[]): PromptEnhancer {
  return {
    name: "negative-defaults",
    async run(draft) {
      draft.negative = mergeNegative(draft.negative, list.join(", "));
    },
  };
}

export interface LlmEnhanceOptions {
  /** Dedicated adapter; defaults to ctx.model (the agent's own model). */
  model?: ModelAdapter;
  /** Extra guidance appended to the rewrite instruction. */
  instructions?: string;
}

const noopNotify: NotifySubscribersFunction = async () => {};

/**
 * One LLM rewrite pass over the working prompt. Contract: preserve
 * character-appearance wording verbatim (identity consistency dies in
 * paraphrase), return only the rewritten prompt. Skips with a trace note
 * when no model is available.
 */
export function llmEnhance(options: LlmEnhanceOptions = {}): PromptEnhancer {
  return {
    name: "llm-enhance",
    async run(draft, ctx) {
      const model = options.model ?? ctx.model;
      if (!model) {
        ctx.note("Skipped — no LLM available for the rewrite pass.");
        return;
      }
      const instruction = [
        "Rewrite the image-generation prompt below to be more vivid and compositionally specific.",
        "Rules:",
        "- Preserve every line under 'Characters (keep these descriptions exact):' word-for-word.",
        "- Preserve any 'Setting:' and 'Style:' content, though you may integrate it naturally.",
        "- Do not add new subjects, text overlays, or watermarks.",
        "- Reply with ONLY the rewritten prompt, no preamble.",
        options.instructions ? `- ${options.instructions}` : "",
        "",
        "Prompt:",
        draft.positive,
      ]
        .filter(Boolean)
        .join("\n");

      const result = await model.prompt(
        { messages: [{ sender: "user", text: instruction }] },
        noopNotify,
        ctx.signal,
      );
      ctx.recordUsage({
        requests: 1,
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
      });
      const text = result.messages[result.messages.length - 1]?.text?.trim();
      if (text) {
        draft.positive = text;
        ctx.note("Rewritten by LLM pass.");
      } else {
        ctx.note("Skipped — LLM returned no text.");
      }
    },
  };
}

/**
 * Terminal stage, always appended by mountImage: clamp the draft to the
 * adapter's declared capabilities. Every degradation lands in the trace
 * rather than happening silently.
 */
export function fitToModel(): PromptEnhancer {
  return {
    name: "fit-to-model",
    async run(draft, ctx) {
      const caps = ctx.capabilities;

      // Negative prompt: fold into positive when the model has no slot.
      if (draft.negative && !caps.negativePrompt) {
        draft.positive = `${draft.positive}\n\nAvoid: ${draft.negative}`;
        draft.negative = undefined;
        ctx.note("No negative-prompt slot — folded into the prompt as an Avoid clause.");
      }

      // Seed: drop when unsupported.
      if (draft.params.seed !== undefined && !caps.seed) {
        draft.params.seed = undefined;
        ctx.note("Seed dropped — the model does not support seeding.");
      }

      // Refs: drop unsupported roles, then clamp count (identity refs survive first).
      const supported = draft.refs.filter((r) => caps.refRoles.includes(r.role));
      if (supported.length !== draft.refs.length) {
        ctx.note(
          `Dropped ${draft.refs.length - supported.length} ref(s) with unsupported roles.`,
        );
      }
      let refs = supported;
      if (refs.length > caps.maxRefs) {
        const byPriority = [...refs].sort((a, b) => {
          const rank = (r: RefImage) => (r.role === "identity" ? 0 : r.role === "content" ? 1 : 2);
          return rank(a) - rank(b);
        });
        refs = byPriority.slice(0, caps.maxRefs);
        ctx.note(
          `Clamped refs to ${caps.maxRefs} (model limit); identity refs kept first.`,
        );
      }
      draft.refs = refs;

      // Size: snap to a supported size.
      if (draft.params.size && caps.sizes !== "flexible" && !caps.sizes.includes(draft.params.size)) {
        const fallback = caps.sizes[0];
        ctx.note(`Size "${draft.params.size}" unsupported — snapped to "${fallback}".`);
        draft.params.size = fallback;
      }

      // Candidates: clamp to the model's max.
      if ((draft.params.candidates ?? 1) > caps.maxCandidates) {
        ctx.note(`Candidates clamped to ${caps.maxCandidates} (model limit).`);
        draft.params.candidates = caps.maxCandidates;
      }
    },
  };
}

/** The default middle of the pipeline when the consumer passes none. */
export function defaultPipeline(): PromptEnhancer[] {
  return [expandCharacters(), expandScenes()];
}
