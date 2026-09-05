import type { ModelAdapter, NotifySubscribersFunction } from "glove-core";
import {
  type VideoAssetStore,
  type VideoBeat,
  type VideoCharacterDef,
  type VideoGenerationParams,
  type VideoLibraryReader,
  type VideoModelCapabilities,
  type VideoReference,
  type VideoSceneDef,
  type VideoTraceEntry,
  type VideoUsage,
  VideoCharacterNotFoundError,
  VideoSceneNotFoundError,
} from "../core/index";

export interface VideoPromptDraft {
  /** Original direction; never mutated. */
  intent: string;
  prompt: string;
  negative?: string;
  refs: VideoReference[];
  beats: VideoBeat[];
  params: VideoGenerationParams;
  requested: { characters: string[]; scene?: string };
  characters: VideoCharacterDef[];
  scene?: VideoSceneDef;
  trace: VideoTraceEntry[];
}

export interface VideoEnhancerContext {
  library: VideoLibraryReader;
  assets: Pick<VideoAssetStore, "get" | "list">;
  model?: ModelAdapter;
  capabilities: VideoModelCapabilities;
  note(message: string): void;
  recordUsage(usage: Partial<VideoUsage>): void;
  signal?: AbortSignal;
}

export interface VideoPromptEnhancer {
  name: string;
  run(
    draft: VideoPromptDraft,
    ctx: VideoEnhancerContext,
  ): Promise<VideoPromptDraft | void>;
}

export function createVideoDraft(args: {
  intent: string;
  characters?: string[];
  scene?: string;
  refs?: VideoReference[];
  beats?: VideoBeat[];
  negative?: string;
  params?: VideoGenerationParams;
}): VideoPromptDraft {
  return {
    intent: args.intent,
    prompt: args.intent,
    negative: args.negative,
    refs: args.refs ? [...args.refs] : [],
    beats: args.beats ? [...args.beats].sort((a, b) => a.at - b.at) : [],
    params: { ...args.params },
    requested: { characters: args.characters ?? [], scene: args.scene },
    characters: [],
    scene: undefined,
    trace: [],
  };
}

export async function runVideoPipeline(
  draft: VideoPromptDraft,
  enhancers: VideoPromptEnhancer[],
  ctx: Omit<VideoEnhancerContext, "note" | "recordUsage"> & {
    recordUsage?: (usage: Partial<VideoUsage>) => void;
  },
): Promise<VideoPromptDraft> {
  let current = draft;
  for (const enhancer of enhancers) {
    const notes: string[] = [];
    const result = await enhancer.run(current, {
      ...ctx,
      note: (message) => notes.push(message),
      recordUsage: ctx.recordUsage ?? (() => {}),
    });
    if (result) current = result;
    current.trace.push({
      enhancer: enhancer.name,
      note: notes.length ? notes.join(" ") : undefined,
      prompt_after: current.prompt,
    });
  }
  return current;
}

function mergeNegative(current: string | undefined, next?: string): string | undefined {
  if (!next) return current;
  if (!current) return next;
  const existing = new Set(current.split(",").map((part) => part.trim().toLowerCase()));
  const additions = next
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !existing.has(part.toLowerCase()));
  return additions.length ? `${current}, ${additions.join(", ")}` : current;
}

function addRefs(draft: VideoPromptDraft, refs: VideoReference[]): void {
  const keys = new Set(draft.refs.map((ref) => `${ref.asset}:${ref.role}`));
  for (const ref of refs) {
    const key = `${ref.asset}:${ref.role}`;
    if (!keys.has(key)) {
      draft.refs.push(ref);
      keys.add(key);
    }
  }
}

export function expandVideoCharacters(): VideoPromptEnhancer {
  return {
    name: "expand-characters",
    async run(draft, ctx) {
      if (draft.requested.characters.length === 0) return;
      const blocks: string[] = [];
      for (const name of draft.requested.characters) {
        const character = await ctx.library.getCharacter(name);
        if (!character) {
          const available = (await ctx.library.listCharacters()).map((item) => item.name);
          throw new VideoCharacterNotFoundError(name, available);
        }
        draft.characters.push(character);
        blocks.push(
          `${character.display_name ?? character.name}: ${character.appearance}` +
            (character.performance ? ` Performance: ${character.performance}` : ""),
        );
        draft.negative = mergeNegative(draft.negative, character.negative);
        addRefs(
          draft,
          character.refs?.map((ref) => ({ asset: ref.asset, role: ref.role })) ?? [],
        );
      }
      draft.prompt = `${draft.prompt}\n\nCharacters (preserve these descriptions exactly):\n${blocks.join("\n")}`;
      ctx.note(`Expanded ${draft.characters.length} character(s).`);
    },
  };
}

export function expandVideoScenes(): VideoPromptEnhancer {
  return {
    name: "expand-scenes",
    async run(draft, ctx) {
      const name = draft.requested.scene;
      if (!name) return;
      const scene = await ctx.library.getScene(name);
      if (!scene) {
        const available = (await ctx.library.listScenes()).map((item) => item.name);
        throw new VideoSceneNotFoundError(name, available);
      }
      draft.scene = scene;
      draft.prompt = `${draft.prompt}\n\nSetting: ${scene.setting}`;
      if (scene.ambient_motion) {
        draft.prompt = `${draft.prompt}\nAmbient motion: ${scene.ambient_motion}`;
      }
      draft.negative = mergeNegative(draft.negative, scene.negative);
      addRefs(
        draft,
        scene.refs?.map((ref) => ({ asset: ref.asset, role: ref.role })) ?? [],
      );
      ctx.note(`Expanded scene "${scene.name}".`);
    },
  };
}

/** Render structured beats into explicit temporal direction. */
export function expandVideoBeats(): VideoPromptEnhancer {
  return {
    name: "expand-beats",
    async run(draft, ctx) {
      if (draft.beats.length === 0) return;
      const timeline = draft.beats
        .map((beat) => `- ${beat.at.toFixed(1)}s: ${beat.action}`)
        .join("\n");
      draft.prompt = `${draft.prompt}\n\nTiming:\n${timeline}`;
      ctx.note(`Expanded ${draft.beats.length} timed beat(s).`);
    },
  };
}

export function videoStyleDirective(text: string): VideoPromptEnhancer {
  return {
    name: "style-directive",
    async run(draft) {
      draft.prompt = `${draft.prompt}\n\nVisual style: ${text}`;
    },
  };
}

export function cameraDirective(text: string): VideoPromptEnhancer {
  return {
    name: "camera-directive",
    async run(draft) {
      draft.prompt = `${draft.prompt}\n\nCamera: ${text}`;
    },
  };
}

export function videoNegativeDefaults(values: string[]): VideoPromptEnhancer {
  return {
    name: "negative-defaults",
    async run(draft) {
      draft.negative = mergeNegative(draft.negative, values.join(", "));
    },
  };
}

export interface LlmVideoEnhanceOptions {
  model?: ModelAdapter;
  instructions?: string;
}

const noopNotify: NotifySubscribersFunction = async () => {};

export function llmVideoEnhance(
  options: LlmVideoEnhanceOptions = {},
): VideoPromptEnhancer {
  return {
    name: "llm-enhance",
    async run(draft, ctx) {
      const model = options.model ?? ctx.model;
      if (!model) {
        ctx.note("Skipped — no LLM available for the rewrite pass.");
        return;
      }
      const instruction = [
        "Rewrite this video-generation prompt into precise visual and temporal direction.",
        "Preserve character descriptions word-for-word. Preserve all explicit timing.",
        "Describe visible action, camera movement, lighting, and continuity; do not add dialogue or text overlays.",
        options.instructions,
        "",
        draft.prompt,
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
        draft.prompt = text;
        ctx.note("Rewritten by the configured LLM.");
      } else {
        ctx.note("LLM returned no text; kept the previous prompt.");
      }
    },
  };
}

function closestNumber(value: number, supported: number[]): number {
  return supported.reduce((best, item) =>
    Math.abs(item - value) < Math.abs(best - value) ? item : best,
  );
}

function ratioValue(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) return null;
  const denominator = Number(match[2]);
  return denominator ? Number(match[1]) / denominator : null;
}

function closestRatio(value: string, supported: string[]): string {
  const requested = ratioValue(value);
  if (requested === null) return supported[0]!;
  return supported.reduce((best, item) => {
    const bestValue = ratioValue(best) ?? requested;
    const itemValue = ratioValue(item) ?? requested;
    return Math.abs(itemValue - requested) < Math.abs(bestValue - requested) ? item : best;
  });
}

const refPriority: Record<VideoReference["role"], number> = {
  "first-frame": 0,
  "last-frame": 1,
  identity: 2,
  continuity: 3,
  source: 4,
  motion: 5,
  style: 6,
};

/** Terminal compatibility pass. Every degradation is written into the trace. */
export function fitVideoToModel(): VideoPromptEnhancer {
  return {
    name: "fit-to-model",
    async run(draft, ctx) {
      const caps = ctx.capabilities;
      if (draft.negative && !caps.negativePrompt) {
        draft.prompt = `${draft.prompt}\n\nAvoid: ${draft.negative}`;
        draft.negative = undefined;
        ctx.note("Negative prompt folded into the main prompt; adapter has no negative slot.");
      }

      const unsupported = draft.refs.filter((ref) => !caps.refRoles.includes(ref.role));
      if (unsupported.length) {
        draft.refs = draft.refs.filter((ref) => caps.refRoles.includes(ref.role));
        ctx.note(`Dropped ${unsupported.length} unsupported reference(s).`);
      }
      if (draft.refs.length > caps.maxRefs) {
        draft.refs = draft.refs
          .map((ref, index) => ({ ref, index }))
          .sort((a, b) => refPriority[a.ref.role] - refPriority[b.ref.role] || a.index - b.index)
          .slice(0, caps.maxRefs)
          .sort((a, b) => a.index - b.index)
          .map((item) => item.ref);
        ctx.note(`Clamped references to the adapter maximum of ${caps.maxRefs}.`);
      }

      const requestedDuration = draft.params.duration;
      if (requestedDuration !== undefined) {
        const supported = caps.durations;
        const next = Array.isArray(supported)
          ? closestNumber(requestedDuration, supported)
          : Math.min(supported.max, Math.max(supported.min, requestedDuration));
        if (next !== requestedDuration) {
          draft.params.duration = next;
          ctx.note(`Duration snapped from ${requestedDuration}s to ${next}s.`);
        }
      }

      if (
        draft.params.aspectRatio &&
        caps.aspectRatios !== "flexible" &&
        !caps.aspectRatios.includes(draft.params.aspectRatio)
      ) {
        const before = draft.params.aspectRatio;
        draft.params.aspectRatio = closestRatio(before, caps.aspectRatios);
        ctx.note(`Aspect ratio snapped from ${before} to ${draft.params.aspectRatio}.`);
      }
      if (
        draft.params.resolution &&
        caps.resolutions !== "flexible" &&
        !caps.resolutions.includes(draft.params.resolution)
      ) {
        const before = draft.params.resolution;
        draft.params.resolution = caps.resolutions[0];
        ctx.note(`Resolution snapped from ${before} to ${draft.params.resolution}.`);
      }
      if (draft.params.audio && !caps.audio) {
        draft.params.audio = false;
        ctx.note("Audio disabled because the adapter does not support it.");
      }
      if (draft.params.seed !== undefined && !caps.seed) {
        draft.params.seed = undefined;
        ctx.note("Seed dropped because the adapter does not support it.");
      }
      if ((draft.params.candidates ?? 1) > caps.maxCandidates) {
        draft.params.candidates = caps.maxCandidates;
        ctx.note(`Candidates clamped to ${caps.maxCandidates}.`);
      }

      const duration = draft.params.duration;
      if (duration !== undefined) {
        const removed = draft.beats.filter((beat) => beat.at > duration);
        if (removed.length) {
          for (const beat of removed) {
            draft.prompt = draft.prompt.replace(
              `\n- ${beat.at.toFixed(1)}s: ${beat.action}`,
              "",
            );
          }
          draft.beats = draft.beats.filter((beat) => beat.at <= duration);
          ctx.note(`Dropped ${removed.length} beat(s) beyond the ${duration}s duration.`);
        }
      }
    },
  };
}

export function defaultVideoPipeline(): VideoPromptEnhancer[] {
  return [expandVideoCharacters(), expandVideoScenes(), expandVideoBeats()];
}
