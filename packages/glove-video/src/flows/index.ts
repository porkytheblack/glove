import {
  type VideoAsset,
  type VideoBeat,
  type VideoGenerationParams,
  type VideoReference,
  VideoError,
  generateVideoFlowRunId,
  videoNowIso,
} from "../core/index";

export interface VideoFlowShot {
  /** Stable within this flow; kebab-case is recommended. */
  id: string;
  intent: string;
  characters?: string[];
  scene?: string;
  refs?: VideoReference[];
  beats?: VideoBeat[];
  negative?: string;
  params?: VideoGenerationParams;
  /** Other shots that must finish first. */
  depends_on?: string[];
  /** Use the first output of another shot for temporal continuity. */
  continuity?: {
    from: string;
    mode: "reference" | "extend";
  };
  name?: string;
  tags?: string[];
}

export interface VideoFlowDefinition {
  name: string;
  description?: string;
  shots: VideoFlowShot[];
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export type VideoFlowRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface VideoFlowShotRun {
  shot: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  assets: string[];
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface VideoFlowRun {
  id: string;
  flow: string;
  /** Immutable snapshot so resuming does not pick up a changed definition. */
  definition: VideoFlowDefinition;
  status: VideoFlowRunStatus;
  shots: VideoFlowShotRun[];
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

export interface VideoFlowFilter {
  tags?: string[];
  name_contains?: string;
}

export interface VideoFlowStore {
  identifier: string;
  saveFlow(flow: VideoFlowDefinition): Promise<void>;
  getFlow(name: string): Promise<VideoFlowDefinition | null>;
  listFlows(filter?: VideoFlowFilter): Promise<VideoFlowDefinition[]>;
  removeFlow(name: string): Promise<void>;
  saveRun(run: VideoFlowRun): Promise<void>;
  getRun(id: string): Promise<VideoFlowRun | null>;
  listRuns(flow?: string): Promise<VideoFlowRun[]>;
}

export interface VideoFlowGenerateContext {
  run: VideoFlowRun;
  /** Successful outputs from every declared dependency. */
  dependencies: Record<string, string[]>;
  /** First output of continuity.from, when configured. */
  continuityAsset?: string;
  signal?: AbortSignal;
}

export type VideoFlowGenerate = (
  shot: VideoFlowShot,
  ctx: VideoFlowGenerateContext,
) => Promise<VideoAsset[]>;

export interface RunVideoFlowOptions {
  /** Resume this run instead of creating one. */
  runId?: string;
  /** Retry failed shots on resume. Default true. */
  retryFailed?: boolean;
  signal?: AbortSignal;
  onUpdate?: (run: VideoFlowRun) => void | Promise<void>;
}

function dependenciesOf(shot: VideoFlowShot): string[] {
  const values = [...(shot.depends_on ?? [])];
  if (shot.continuity && !values.includes(shot.continuity.from)) {
    values.push(shot.continuity.from);
  }
  return values;
}

/** Validate references and return a stable topological order. */
export function validateVideoFlow(flow: VideoFlowDefinition): VideoFlowShot[] {
  if (flow.shots.length === 0) throw new VideoError(`Video flow "${flow.name}" has no shots.`);
  const byId = new Map<string, VideoFlowShot>();
  for (const shot of flow.shots) {
    if (byId.has(shot.id)) throw new VideoError(`Duplicate shot id "${shot.id}".`);
    byId.set(shot.id, shot);
  }
  for (const shot of flow.shots) {
    for (const dependency of dependenciesOf(shot)) {
      if (!byId.has(dependency)) {
        throw new VideoError(`Shot "${shot.id}" depends on unknown shot "${dependency}".`);
      }
      if (dependency === shot.id) {
        throw new VideoError(`Shot "${shot.id}" cannot depend on itself.`);
      }
    }
  }

  const pending = new Set(flow.shots.map((shot) => shot.id));
  const completed = new Set<string>();
  const ordered: VideoFlowShot[] = [];
  while (pending.size) {
    const ready = flow.shots.filter(
      (shot) => pending.has(shot.id) && dependenciesOf(shot).every((id) => completed.has(id)),
    );
    if (ready.length === 0) {
      throw new VideoError(
        `Video flow "${flow.name}" contains a dependency cycle among: ${[...pending].join(", ")}.`,
      );
    }
    for (const shot of ready) {
      pending.delete(shot.id);
      completed.add(shot.id);
      ordered.push(shot);
    }
  }
  return ordered;
}

function createRun(flow: VideoFlowDefinition): VideoFlowRun {
  return {
    id: generateVideoFlowRunId(),
    flow: flow.name,
    definition: structuredClone(flow),
    status: "queued",
    shots: flow.shots.map((shot) => ({
      shot: shot.id,
      status: "pending",
      attempts: 0,
      assets: [],
    })),
    created_at: videoNowIso(),
  };
}

async function persist(
  store: VideoFlowStore,
  run: VideoFlowRun,
  onUpdate?: RunVideoFlowOptions["onUpdate"],
): Promise<void> {
  await store.saveRun(run);
  await onUpdate?.(structuredClone(run));
}

/**
 * Run or resume a flow. State is persisted before and after every model call,
 * so a failed process can safely resume without repeating successful shots.
 * Execution is intentionally stable/sequential; providers can fan out a
 * shot's candidate requests inside their adapter.
 */
export async function runVideoFlow(
  flow: VideoFlowDefinition,
  store: VideoFlowStore,
  generate: VideoFlowGenerate,
  options: RunVideoFlowOptions = {},
): Promise<VideoFlowRun> {
  let run: VideoFlowRun;
  if (options.runId) {
    const existing = await store.getRun(options.runId);
    if (!existing) throw new VideoError(`Video flow run "${options.runId}" not found.`);
    if (existing.flow !== flow.name) {
      throw new VideoError(`Run "${options.runId}" belongs to flow "${existing.flow}", not "${flow.name}".`);
    }
    run = existing;
    flow = run.definition;
  } else {
    run = createRun(flow);
  }

  const ordered = validateVideoFlow(flow);
  const byShot = new Map(run.shots.map((item) => [item.shot, item]));
  const retryFailed = options.retryFailed ?? true;
  run.status = "running";
  run.started_at ??= videoNowIso();
  run.completed_at = undefined;
  run.error = undefined;
  await persist(store, run, options.onUpdate);

  for (const shot of ordered) {
    const state = byShot.get(shot.id);
    if (!state) throw new VideoError(`Run "${run.id}" is missing state for shot "${shot.id}".`);
    if (state.status === "succeeded") continue;
    if (state.status === "failed" && !retryFailed) continue;
    if (options.signal?.aborted) {
      state.status = "cancelled";
      state.completed_at = videoNowIso();
      run.status = "cancelled";
      run.completed_at = videoNowIso();
      run.error = "Flow run aborted by the user.";
      await persist(store, run, options.onUpdate);
      return run;
    }

    const dependencyStates = dependenciesOf(shot).map((id) => byShot.get(id)!);
    const unavailable = dependencyStates.find((item) => item.status !== "succeeded");
    if (unavailable) {
      state.status = "failed";
      state.error = `Dependency "${unavailable.shot}" did not succeed.`;
      state.completed_at = videoNowIso();
      run.status = "failed";
      run.error = `Shot "${shot.id}" could not run: ${state.error}`;
      run.completed_at = videoNowIso();
      await persist(store, run, options.onUpdate);
      return run;
    }

    state.status = "running";
    state.attempts += 1;
    state.error = undefined;
    state.started_at = videoNowIso();
    state.completed_at = undefined;
    await persist(store, run, options.onUpdate);

    const dependencies = Object.fromEntries(
      dependencyStates.map((item) => [item.shot, [...item.assets]]),
    );
    const continuityState = shot.continuity ? byShot.get(shot.continuity.from) : undefined;
    try {
      const assets = await generate(shot, {
        run,
        dependencies,
        continuityAsset: continuityState?.assets[0],
        signal: options.signal,
      });
      if (assets.length === 0) throw new VideoError("Generator returned no video assets.");
      state.assets = assets.map((asset) => asset.id);
      state.status = "succeeded";
      state.completed_at = videoNowIso();
      await persist(store, run, options.onUpdate);
    } catch (error) {
      state.status = options.signal?.aborted ? "cancelled" : "failed";
      state.error = error instanceof Error ? error.message : String(error);
      state.completed_at = videoNowIso();
      run.status = options.signal?.aborted ? "cancelled" : "failed";
      run.error = `Shot "${shot.id}" failed: ${state.error}`;
      run.completed_at = videoNowIso();
      await persist(store, run, options.onUpdate);
      return run;
    }
  }

  const unfinished = run.shots.some((state) => state.status !== "succeeded");
  run.status = unfinished ? "failed" : "succeeded";
  run.error = unfinished ? "One or more shots did not succeed." : undefined;
  run.completed_at = videoNowIso();
  await persist(store, run, options.onUpdate);
  return run;
}
