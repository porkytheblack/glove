/**
 * TypeSafe System One adapter: Jev behind {@link ClassifierAdapter}.
 *
 * Jev is not a chat model and cannot sit behind a Glove `ModelAdapter`: it
 * takes a state and typed questions and returns calibrated, typed answers in
 * one parallel pass (70–500 ms, input-token pricing, output free). This is
 * {@link SystemOneClassifier} with TypeSafe's defaults, which mirror the
 * official SDK: the same env vars, the `jev-latest` default, per-attempt
 * timeouts, and retries with backoff on 408 / 429 / 5xx (including 529
 * Overloaded) that honour `Retry-After`.
 *
 * Docs: https://docs.typesafe.ai/api
 */
import { ClassifierError } from "./errors";
import { env, SystemOneClassifier, type SystemOneFetch, type SystemOneModelCard, type SystemOneOptions } from "./systemone";

export const TYPESAFE_DEFAULT_BASE_URL = "https://api.typesafe.ai";
/** Most recent stable Jev release. Moves when a new version ships. */
export const JEV_LATEST = "jev-latest";
/** Most recent Jev build, official or preview. */
export const JEV_PREVIEW = "jev-preview";

export type TypeSafeFetch = SystemOneFetch;
export type TypeSafeModelCard = SystemOneModelCard;

export interface TypeSafeOptions extends Omit<Partial<SystemOneOptions>, "provider" | "requireApiKey"> {
  /** Falls back to `TYPESAFE_API_KEY`. */
  apiKey?: string;
  /** Falls back to `TYPESAFE_BASE_URL`, then `https://api.typesafe.ai`. */
  baseURL?: string;
  /**
   * Default model; falls back to `TYPESAFE_DEFAULT_MODEL`, then `jev-latest`.
   * Pin a versioned id (e.g. `jev-1.13.0`) when you have tuned confidence
   * thresholds against it — aliases move on release.
   */
  model?: string;
}

export class TypeSafeClassifier extends SystemOneClassifier {
  constructor(options: TypeSafeOptions = {}) {
    const apiKey = options.apiKey ?? env("TYPESAFE_API_KEY");
    if (!apiKey) {
      throw new ClassifierError(
        "auth",
        "No TypeSafe API key. Set TYPESAFE_API_KEY or pass apiKey (get one at https://console.typesafe.ai/keys).",
      );
    }
    super({
      ...options,
      apiKey,
      provider: "typesafe",
      requireApiKey: true,
      baseURL: options.baseURL ?? env("TYPESAFE_BASE_URL") ?? TYPESAFE_DEFAULT_BASE_URL,
      model: options.model ?? env("TYPESAFE_DEFAULT_MODEL") ?? JEV_LATEST,
      limits: options.limits ?? { maxChoiceOptions: 255, maxScoreLevels: 10 },
    });
  }
}

/** A TypeSafe System One classifier. Reads `TYPESAFE_API_KEY` by default. */
export function typesafe(options: TypeSafeOptions = {}): TypeSafeClassifier {
  return new TypeSafeClassifier(options);
}

/** Jev, TypeSafe's flagship System One model. Same as {@link typesafe}; defaults to `jev-latest`. */
export function jev(options: TypeSafeOptions = {}): TypeSafeClassifier {
  return new TypeSafeClassifier(options);
}
