/**
 * Open typed-decision models that serve the System One API.
 *
 * Within weeks of Jev's release, several open models appeared that serve
 * the same `POST /v1/systemone` contract on your own hardware. Each preset
 * here is a {@link SystemOneClassifier} with that server's documented
 * default address, model id, auth variable and limits. Start the server as
 * its README describes, then:
 *
 * ```ts
 * const classifier = kev();                                   // http://127.0.0.1:8009
 * const remote = laya({ baseURL: "https://laya.internal" });  // any address
 * ```
 *
 * Every option can be overridden, and `systemOne()` covers any other
 * compatible server. Defaults follow each project's README as of
 * September 2026. The model ids and ports are theirs to change, so pin them
 * in production.
 *
 * | Preset | Project | Default address | Notes |
 * | --- | --- | --- | --- |
 * | `kev()` | github.com/jaredpalmer/kev | http://127.0.0.1:8009 | Qwen3.5 + LoRA (0.8B–27B). 1–255 options. Auth via KEV_API_KEY when set. |
 * | `laya()` | github.com/NandhaKishorM/laya | http://127.0.0.1:8000 | ModernBERT / mmBERT encoders (~400M, CPU-friendly). Score levels need descriptions. |
 * | `von()` | github.com/wfzyx/von | http://localhost:8000 | ModernBERT-large (395M). |
 * | `rizzo()` | github.com/Rizzo-AI-Academy/rizzo-flow | http://127.0.0.1:8017 | Spark-X2.5 (1.7B/4B). At most 26 choice labels. Uncalibrated by default. |
 * | `decider()` | github.com/Mapika/decider | http://127.0.0.1:8000 | Qwen-based (0.8B–35B). 2–255 options, 32k context, English only. |
 */
import { env, SystemOneClassifier, type SystemOneOptions } from "./systemone";

export type OpenModelOptions = Partial<Omit<SystemOneOptions, "provider">>;

interface Preset {
  provider: string;
  baseURL: string;
  model: string;
  /** Env vars read for the base URL and the API key, in that order. */
  envPrefix: string;
  limits: SystemOneOptions["limits"];
  /** Local models on CPU are slower than a hosted API; allow for it. */
  timeout: number;
}

function preset(p: Preset, options: OpenModelOptions): SystemOneClassifier {
  return new SystemOneClassifier({
    timeout: p.timeout,
    ...options,
    provider: p.provider,
    baseURL: options.baseURL ?? env(`${p.envPrefix}_BASE_URL`) ?? p.baseURL,
    model: options.model ?? p.model,
    apiKey: options.apiKey ?? env(`${p.envPrefix}_API_KEY`),
    limits: options.limits ?? p.limits,
  });
}

/**
 * Kev (Jared Palmer): open Qwen3.5 checkpoints behind a Jev-shaped API.
 * Serve with `uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009`.
 * Reads `KEV_BASE_URL` and `KEV_API_KEY`.
 */
export function kev(options: OpenModelOptions = {}): SystemOneClassifier {
  return preset(
    { provider: "kev", baseURL: "http://127.0.0.1:8009", model: "kev-latest", envPrefix: "KEV", limits: { maxChoiceOptions: 255, maxScoreLevels: 255 }, timeout: 30_000 },
    options,
  );
}

/**
 * Laya (ConvAI Innovations): ModernBERT / mmBERT encoders, fast on CPU.
 * Serve with `pip install "laya[serve]"` then `laya-serve`.
 * `model` may be `english`, `multilingual` or `typed-decisions`. Any other
 * value lets Laya's router pick a checkpoint by script.
 * Reads `LAYA_BASE_URL` and `LAYA_API_KEY`.
 */
export function laya(options: OpenModelOptions = {}): SystemOneClassifier {
  return preset(
    { provider: "laya", baseURL: "http://127.0.0.1:8000", model: "auto", envPrefix: "LAYA", limits: { maxChoiceOptions: 126, maxScoreLevels: 10, scoreLevelsNeedDescriptions: true }, timeout: 30_000 },
    options,
  );
}

/**
 * Von (wfzyx): a 395M ModernBERT-large decision model.
 * Serve with `pip install von-sdk` then `von serve --port 8000`.
 * Reads `VON_BASE_URL` and `VON_API_KEY`.
 */
export function von(options: OpenModelOptions = {}): SystemOneClassifier {
  return preset(
    { provider: "von", baseURL: "http://localhost:8000", model: "von-1.2.0", envPrefix: "VON", limits: { maxChoiceOptions: 255, maxScoreLevels: 10 }, timeout: 30_000 },
    options,
  );
}

/**
 * Rizzo Flow (Rizzo AI Academy): Spark-X2.5 via llama.cpp.
 * Serve with `uv run rizzo serve`. Probabilities are uncalibrated by default.
 * Reads `RIZZO_BASE_URL` and `RIZZO_API_KEY`.
 */
export function rizzo(options: OpenModelOptions = {}): SystemOneClassifier {
  return preset(
    { provider: "rizzo", baseURL: "http://127.0.0.1:8017", model: "rizzo-latest", envPrefix: "RIZZO", limits: { maxChoiceOptions: 26, maxScoreLevels: 10 }, timeout: 60_000 },
    options,
  );
}

/**
 * Decider (Mapika): Qwen-based decision models (0.8B–35B).
 * Serve with `scripts/serve.sh Mapika/decider-2b 8000`.
 * Reads `DECIDER_BASE_URL` and `DECIDER_API_KEY`.
 */
export function decider(options: OpenModelOptions = {}): SystemOneClassifier {
  return preset(
    { provider: "decider", baseURL: "http://127.0.0.1:8000", model: "decider", envPrefix: "DECIDER", limits: { maxChoiceOptions: 255, maxScoreLevels: 10 }, timeout: 30_000 },
    options,
  );
}
