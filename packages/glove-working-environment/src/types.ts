/**
 * Shared contracts for the working environment: the pluggable filesystem
 * adapter, the stdlib adapter bridge, resource limits, and the model-facing
 * tool shape. Everything here is zero-dependency — the tool shape is
 * structurally compatible with glove-core's `GloveFoldArgs` without importing
 * it.
 */
import type { HandlesSpec } from "./adapters/handles";

export type { HandlesSpec };

/**
 * The filesystem contract now lives in `glove-vfs`, so the working
 * environment, the memory resource store and the sandboxed REPLs all mount
 * the SAME tree rather than each keeping a private one. These re-exports keep
 * the surface identical for anyone importing them from here.
 */
import type { Vfs, VfsEntry, VfsSnapshot, VfsStat } from "glove-vfs";

export type { Vfs, VfsEntry, VfsStat };
export type { VfsSnapshot as EnvSnapshot };


/**
 * A stdlib adapter bridges a real host-side library into the environment.
 * Scripts import it as `env:<name>`; its docs are materialized read-only
 * under `/std/<name>/`.
 *
 * `create(vfs)` is the capability boundary: every function the adapter
 * exposes must do its I/O exclusively through the given VFS handle. An
 * adapter that reaches for the network or the host filesystem is breaking
 * the contract — the environment cannot detect it, so don't do it.
 *
 * Prefer `defineAdapter` over writing this shape by hand: it checks the spec
 * eagerly and keeps the binding types.
 */
export interface StdlibAdapter {
  /** Module name: `"documents"` → scripts do `import { pdf } from 'env:documents'`. */
  name: string;
  /** One-liner surfaced in the tool description and in `ls /std`. */
  description: string;
  /** `.d.ts` source describing the module's exports (materialized at /std/<name>/index.d.ts). */
  types: string;
  /**
   * The version of this adapter's **binding contract** — bump it whenever a
   * signature changes, not when the implementation does.
   *
   * The gap it closes: a module this host never registered is caught at
   * startup, and a binding that was renamed or removed fails at the next run
   * with an error naming it. A binding whose *signature* changed under the
   * same name is undetectable at every layer — the stored script imports a
   * name that still exists, calls it with arguments that no longer mean the
   * same thing, and fails deep inside the adapter with a message about
   * neither.
   *
   * Recorded in `/.env/adapters.json` on every startup, so the tree carries
   * the version it was last used with. On the next startup a differing version
   * is reported on `WorkingEnvironment.warnings` **and** in the model's
   * orientation file. A warning, never a refusal: restoring across a version
   * bump is legitimate and usually fine, and a host that cannot restore a
   * year-old snapshot has lost the data either way.
   *
   * Optional, and omitting it opts out of the check entirely — an adapter with
   * no version is never compared against one.
   */
  version?: string;
  /** Optional README with worked examples (materialized at /std/<name>/README.md). */
  docs?: string;
  /**
   * The files this adapter understands, by extension and/or magic bytes. When
   * present alongside a `describe(path)` binding, the `describe` verb routes
   * matching files here and `ls` names the module beside them.
   */
  handles?: HandlesSpec;
  /**
   * The files this adapter can rasterize to page images, declared alongside a
   * `render(input, outDir, opts?)` binding.
   *
   * Kept separate from `handles` on purpose: the module that best *describes*
   * a PDF is rarely the one that best *rasterizes* it, and folding both into
   * one claim would make registering a renderer silently steal `describe`.
   */
  renders?: HandlesSpec;
  /**
   * Release whatever this adapter is holding. Called by `env.close()`, once
   * per created instance, after the worker pool has been shut down.
   *
   * Most adapters need nothing here — they own no resource that outlives a
   * call. It exists for the ones that do: `env:motion` keeps a browser warm
   * between renders, and without this the only ways it comes back are an idle
   * timer or process exit, so a host that closes fifty environments in a loop
   * is holding fifty browsers it has finished with.
   *
   * Awaited, but never allowed to fail the close: a throw is reported through
   * `execution.onWarning` and shutdown continues, because a host that has
   * asked to close cannot be left with an environment it cannot dispose of.
   */
  close?(): Promise<void> | void;
  /**
   * Factory producing the actual bindings. ALL I/O goes through the given VFS
   * handle.
   *
   * Called twice per environment — once for normal execution and once for the
   * read-only instance backing write-time script validation — so it must be
   * free of side effects outside the handle. `ctx.readOnly` distinguishes
   * them; most adapters can ignore it.
   */
  create(vfs: EnvFsHandle, ctx?: { name: string; readOnly: boolean }): Record<string, unknown>;
  /**
   * Worked recipes, materialized under `/skills` and listed in its index.
   *
   * `types` says what the module exports; a skill says how to do a task with
   * it. Both matter, and they are read at different moments — a model reaches
   * for a remembered shape before it reads a signature, which is why the most
   * common failures in this environment are guessed imports rather than
   * misused ones.
   */
  skills?: Array<{ name: string; summary: string; body: string }>;
}

/**
 * The guarded, text-friendly VFS handle given to stdlib adapters and to the
 * `env:fs` builtin. Mutations flow through the environment's zones, limits,
 * script pipeline, and version recording — exactly like the model-facing
 * verbs.
 */
export interface EnvFsHandle {
  /**
   * The environment's resource limits, so an adapter can size its work
   * instead of only failing late.
   *
   * The gateway enforces these on every write regardless; what this buys is
   * the chance to refuse BEFORE doing something expensive — inflating an
   * archive that cannot fit, allocating a canvas for a page count that will
   * never be written.
   */
  readonly limits: EnvLimits;
  readFile(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  /** Append to a file, creating it if absent. */
  appendFile(path: string, content: string | Uint8Array): Promise<void>;
  readdir(path: string): Promise<VfsEntry[]>;
  glob(pattern: string): Promise<string[]>;
  stat(path: string): Promise<VfsStat | null>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  rm(path: string): Promise<void>;
  mv(from: string, to: string): Promise<void>;
  cp(from: string, to: string): Promise<void>;
}

/** Resource limits. Every limit failure names the limit it hit. */
export interface EnvLimits {
  /** Wall-clock budget per run_script (and per write-time validation). Default 30_000. */
  runTimeoutMs: number;
  /**
   * Total bytes across all files (including versions and history). Default
   * 128 MiB.
   *
   * With the default in-memory filesystem this is host **heap**, and it is
   * per environment — a host running N agents in one process must be able to
   * afford `N * maxVfsBytes` on top of everything else. Size it deliberately
   * for a multi-tenant host; the default assumes an agent working on a
   * handful of documents, not a bulk pipeline.
   *
   * Erring low is the safe direction: too low is a named, actionable error
   * the operator raises in one line, while too high is a process the OOM
   * killer takes down along with every other agent inside it.
   */
  maxVfsBytes: number;
  /** Bytes for any single file. Default 32 MiB. */
  maxFileBytes: number;
  /** Serialized bytes a tool response may carry before spilling to /tmp. Default 8192. */
  maxToolResponseBytes: number;
  /** Lines a tool response may carry before truncating/spilling. Default 200. */
  maxToolResponseLines: number;
  /** Per-file undo ring depth. Default 10. */
  maxVersionsPerFile: number;
  /** history.jsonl ring depth in lines. Default 5000. */
  maxHistoryLines: number;
}

/** Thrown when a configured resource limit is hit. The message names the limit. */
export class EnvLimitError extends Error {
  constructor(message: string) {
    super(message);
    // Only `name` and `message` survive the realm bridge, so the name is the
    // only way a script can tell a limit apart from an ordinary failure.
    this.name = "EnvLimitError";
  }
}

export const DEFAULT_LIMITS: EnvLimits = {
  runTimeoutMs: 30_000,
  maxVfsBytes: 128 * 1024 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
  maxToolResponseBytes: 8_192,
  maxToolResponseLines: 200,
  maxVersionsPerFile: 10,
  maxHistoryLines: 5_000,
};

/** Result of one script execution. */
export interface RunResult {
  ok: boolean;
  /** The value returned by the script's default export (host-side value). */
  result: unknown;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

/**
 * Model-facing tool result — structurally a glove-core `ToolResultData`.
 */
export interface EnvToolResult {
  status: "success" | "error";
  data: unknown;
  message?: string;
}

/**
 * A model-facing verb. Structurally compatible with glove-core's
 * `GloveFoldArgs` (raw JSON Schema variant), so `glove.fold(tool)` accepts it
 * directly — without this package depending on glove-core.
 */
/**
 * Cheap counters a host can scrape for a dashboard.
 *
 * Plain numbers on a live object rather than an event stream, deliberately:
 * these are the questions asked on a schedule — "how often are we hitting the
 * size cap?", "how much output is spilling to /tmp?" — and an event per
 * occurrence is the wrong shape for a gauge.
 */
export interface EnvCounters {
  /** Refusals caused by `maxFileBytes` or `maxVfsBytes`. */
  limitHits: number;
  /** Tool responses too large to inline, written to a `/tmp` file instead. */
  spillovers: number;
  /** Successful changes to the tree, from any source. */
  mutations: number;
}

export interface EnvTool {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  /**
   * The trailing parameters are glove-core's fold signature —
   * `(input, display, glove, signal)` — and only the last one is used here.
   *
   * Matching it exactly is what makes cancellation free: glove already passes
   * the active request's signal to every tool it calls, and `run_script`
   * simply ignored it, so an aborted turn abandoned the script rather than
   * stopping it. Now the same signal terminates the run.
   *
   * A host calling a verb directly passes `tool.do(input, undefined,
   * undefined, signal)` — or just `tool.do(input)`, since everything after
   * the input is optional.
   */
  do(input: any, display?: unknown, agent?: unknown, signal?: AbortSignal): Promise<EnvToolResult>;
  /**
   * Whether this verb is able to change the tree.
   *
   * Declared here so a host does not keep its own list of verb names. The
   * hand-maintained version goes wrong twice over: it drifts the moment a
   * verb is added, and it ignores `toolsWithPrefix`, so a host that renamed
   * the verbs matches nothing at all. For "did this call actually change
   * anything" — a `run_script` may well not have — use `onVerb`'s `mutated`.
   */
  mutates: boolean;
}

/**
 * The minimal structural surface of a Glove agent that
 * `mountWorkingEnvironment` needs. Any `IGloveRunnable`/`IGloveBuilder`
 * satisfies it.
 */
export interface MountableAgent {
  fold(tool: EnvTool): unknown;
  getSystemPrompt?(): string;
  setSystemPrompt?(prompt: string): unknown;
}

/**
 * A model that can look at an image, supplied by the host.
 *
 * This is the seam that lets an agent **check its own output**. Everything
 * else in the environment verifies by reading text back, which catches a wrong
 * number and misses a table running off the page, a chart with no bars, or a
 * deck whose title overlaps its subtitle. Those are the failures a person
 * notices in the first second and an extraction never sees.
 *
 * Kept as one function rather than a model adapter so the package stays free
 * of a `glove-core` dependency and works with whatever the host already has.
 */
export interface VisionAdapter {
  /**
   * Answer `prompt` about the image. Return prose, not a verdict — the calling
   * agent decides whether what it is told matches what it intended.
   */
  describe(input: { bytes: Uint8Array; mediaType: string; prompt: string }): Promise<string>;
}

/** A deliverable the agent is handing over, as passed to `onPresent`. */
export interface PresentedFile {
  /** VFS path, always under `/out`. */
  path: string;
  /** File name, for a download or an attachment. */
  name: string;
  bytes: Uint8Array;
  /** Guessed from the extension; `application/octet-stream` when unknown. */
  mediaType: string;
  /** The agent's one-line description of what this is and why. */
  caption: string;
}

export interface CreateWorkingEnvironmentOptions {
  /** Filesystem backend. Default: a fresh {@link inMemoryFs}. */
  filesystem?: Vfs;
  /**
   * Enables the `view_image` verb, which is otherwise absent from the tool
   * set entirely — an agent is never shown a capability the host did not wire.
   */
  vision?: VisionAdapter;
  /**
   * Enables the `present` verb: the agent hands a finished file to the person.
   *
   * Without it the agent can only *say* it wrote something to `/out`, and the
   * host has to guess when a turn produced a deliverable. With it, the moment
   * of "here it is" is an explicit act with a caption attached — which is
   * exactly what a UI needs to render a download, an inline preview, or a
   * message with an attachment.
   *
   * Throwing surfaces to the agent as a failed verb, so a rejected file (too
   * large, wrong type, the user is gone) is something it can respond to.
   */
  onPresent?: (item: PresentedFile) => Promise<void> | void;
  /**
   * Let the agent ask the person a question mid-task.
   *
   * Without one there is no channel at all, and the observed behaviour is not
   * "the agent asks in prose" — it is the agent inventing an `ask_user` tool
   * and burning turns on "no such tool", or, in a turn-capped loop where
   * ending the turn *is* failing the run, guessing. "Two sheets are named
   * Revenue — which one?" has a right answer the environment cannot supply.
   *
   * Everything about how the question is asked belongs to the host: the UI,
   * the timeout, whether `options` become buttons or a list. Return the
   * person's answer as a string; throw (or resolve with a refusal) if nobody
   * answers, and the agent is told so and carries on.
   *
   * A **verb** rather than an `env:` module, deliberately: a script blocking
   * on a human would spend its own `runTimeoutMs` waiting, and a person who
   * takes a minute to reply would kill the run.
   */
  onAsk?: (question: { question: string; options?: string[] }) => Promise<string>;
  /**
   * Called after every model-facing verb, for telemetry.
   *
   * `durationMs` is what the model waited for. `mutated` is whether the tree
   * really changed — measured, not inferred from the verb's name, so a
   * `run_script` that only read something reports false and a UI does not
   * refresh its file tree for nothing.
   *
   * ```ts
   * onVerb: ({ name, ok, durationMs, mutated }) => {
   *   metrics.timing(`env.verb.${name}`, durationMs);
   *   if (mutated) refreshTree();
   * }
   * ```
   *
   * Never allowed to fail a verb: a throw here is swallowed.
   */
  onVerb?: (event: { name: string; ok: boolean; durationMs: number; mutated: boolean }) => void;
  /**
   * Directories the agent can read but never mutate.
   *
   * The rule the environment already applies to `/std` and `/skills`, made
   * host-configurable: everything under these paths is readable, greppable
   * and describable, and every mutation — write, edit, rm, mv in or out,
   * mkdir, undo — is refused with an error naming the zone and the fix.
   *
   * Enforced at the core mutation gateway, so it binds the model verbs,
   * scripts going through `env:fs`, and stdlib adapters alike. The host
   * doors stay open: `env.mount()` seeds content INTO a read-only zone,
   * which is the intended workflow —
   *
   * ```ts
   * const env = await createWorkingEnvironment({ readOnlyPaths: ["/corpus"] });
   * await env.mount("./handbook.pdf", "/corpus/handbook.pdf");   // host: fine
   * // agent: read_file/grep/describe on /corpus work; write_file is refused
   * ```
   *
   * Combine with `hostDirectory("./project")` to hand an agent a real
   * directory where some subtrees are reference-only.
   *
   * Paths are normalized; `/` itself is refused (an environment the agent
   * cannot write to at all has no reason to exist). Not persisted in
   * snapshots — like `stdlib`, the host re-supplies it on restore.
   */
  readOnlyPaths?: string[];
  /** Stdlib adapters to register (materialized under /std, importable as env:<name>). */
  stdlib?: StdlibAdapter[];
  /** Resource limit overrides. */
  limits?: Partial<EnvLimits>;
  /**
   * Throw at startup when stored scripts import an `env:*` module this host
   * did not register, instead of reporting it on `WorkingEnvironment.warnings`.
   * Off by default: restoring a deliberate subset of adapters is legitimate.
   */
  strictAdapters?: boolean;
  /**
   * Refuse the FIRST script write of a session — once — if no docs have been
   * opened yet, naming `/skills/README.md`. Default false.
   *
   * Measured: with `/skills` present and the preamble naming it first, the
   * most frequent errors across 36 agent runs were still guessed imports.
   * Reading is optional and guessing is free, so guessing wins; this puts the
   * file in front of the model at the one moment it is about to matter.
   *
   * It is a signpost, not a gate. Resending the identical write succeeds, and
   * nothing afterwards is ever refused — a standing rule is just another
   * thing to work around, and every turn spent doing that is a turn not spent
   * on the task.
   *
   * **It did not work, and the measurement is why this is off.** A/B over 45
   * runs per arm (5 scenarios × 3 models × 3 reps, same build, same day):
   * 25/45 complete without it, 24/45 with it. Two of the three models scored
   * identically. It does remove errors — genuine errored calls fell 87 → 72,
   * about 17% — but the errors it removes are not what costs runs, which is
   * the whole finding.
   *
   * Kept as an opt-in rather than deleted because it is cheap when off and a
   * different model mix may answer differently. Turn it on to re-measure, not
   * because it is expected to help.
   */
  nudgeToDocsOnFirstWrite?: boolean;
  /** Script-execution tuning. Scripts always run in terminable workers. */
  execution?: {
    /**
     * Warm worker threads kept alive per environment. Default 1.
     *
     * One is right for an agent loop, which runs a script at a time. Raise it
     * only if the host genuinely runs scripts concurrently against the same
     * environment — each worker is a thread and its own heap.
     */
    size?: number;
    /**
     * Grace after `runTimeoutMs` before the worker is destroyed. Default 250ms.
     *
     * The in-worker deadline usually resolves the run first with a better
     * message; this is the backstop for when it cannot, which is exactly the
     * compute-loop case it exists for.
     */
    graceMs?: number;
    /**
     * Ceiling on a worker's JS heap, in MB. Default 256.
     *
     * The time limit alone does not make a script survivable: measured
     * without this, a script pushing arrays in a loop grew the host to 7.2
     * GiB of RSS well inside the default 30s budget, and a process that gets
     * OOM-killed takes every other agent in it along. With the ceiling, V8
     * terminates only that worker and the run fails naming this option.
     *
     * Raise it for scripts that legitimately hold large intermediates in
     * memory. Adapter work does not count against it — adapters run on the
     * host — so this bounds the model's own data structures.
     */
    memoryMb?: number;
    /**
     * How long `close()` lets an in-flight run finish before terminating it.
     * Default 5000ms. Overridable per call: `close({ graceMs })`.
     */
    shutdownGraceMs?: number;
    /**
     * How long a warm worker may sit unused before it is terminated, in ms.
     * Default 60000. `0` keeps it forever.
     *
     * An environment nobody is using was measured at 16.5 MB and one OS thread
     * of steady residency — five open environments at +82.5 MB and +5 threads,
     * all of it returned on `close()` and none of it before. That is the bill
     * a multi-tenant host pays for every conversation someone left open.
     *
     * The trade is cheap in the other direction: a replacement worker is ready
     * in ~82 ms, which is noise beside the model round trip that precedes any
     * script. Raise it for a latency-critical single-tenant host; set `0` when
     * a warm worker matters more than the thread.
     *
     * This reclaims the *worker*, not the tree. The environment stays usable
     * and its files are untouched — LIFECYCLE.md covers reclaiming the rest
     * (`close()` on idle, `fromSnapshot` to resume).
     */
    idleTimeoutMs?: number;
    /**
     * Start the pool's workers in the background as soon as the environment is
     * created, instead of on the first script. Default false.
     *
     * The first `run_script` of a session — or the first script the model
     * *writes*, since write-time validation runs in a worker too — otherwise
     * carries ~82 ms of thread start-up. A host that knows a session is
     * beginning can spend it during the wait it already has.
     *
     * Never fails a create: a prewarm spawn that does not come up leaves the
     * pool exactly as it was and is retried on demand at the first acquire.
     * `env.warmup()` does the same thing at a moment of the host's choosing —
     * after restoring a snapshot, say — and can be awaited.
     */
    prewarm?: boolean;
    /**
     * How long a freshly spawned worker has to become ready. Default 10000ms.
     *
     * The failure this bounds is the quiet one: a worker that never signals
     * ready holds the slot it was given, so at the default pool size of 1
     * every `run_script` after it waits forever — and nothing times out,
     * because the run deadline only starts once a worker has been acquired.
     * Meanwhile writes and validation keep working through the overflow path,
     * so the environment looks healthy. Past this, the run fails with a
     * message naming the usual causes instead.
     */
    readyTimeoutMs?: number;
    /**
     * Watch a run as it happens, rather than reading its transcript
     * afterwards.
     *
     * Called with each console line a running script writes, batched in the
     * worker so narration inside a loop does not become the slowest thing the
     * script does. `runId` matches the id in `/.env/history.jsonl`.
     *
     * ```ts
     * execution: { onProgress: (e) => sse.send({ type: "progress", ...e }) }
     * ```
     *
     * The same lines still arrive in full with the run's result, so a host
     * that ignores this loses nothing — and the worker only streams when a
     * callback is present.
     */
    onProgress?: (event: { runId: string; script: string; stream: "stdout" | "stderr"; text: string }) => void;
    /**
     * Where to report a misconfigured host. Defaults to `console.warn`; point
     * it at your logger. Called at most once per environment.
     *
     * Today it reports exactly one thing: a `memoryMb` ceiling that V8 did
     * not apply because a process-level `--max-old-space-size` overrode it.
     */
    onWarning?: (message: string) => void;
  };
}

/** One recorded version of a file (for `history <path>` output). */
export interface FileVersionInfo {
  ts: number;
  /** The mutation that pushed this version. */
  op: string;
  /** Whether the file existed in this version. */
  present: boolean;
  size: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

export function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? encoder.encode(content) : content;
}

export function toText(data: Uint8Array): string {
  return decoder.decode(data);
}

/** Cheap binary sniff: a NUL byte in the first 8 KiB means "not text". */
export function looksBinary(data: Uint8Array): boolean {
  const n = Math.min(data.length, 8192);
  for (let i = 0; i < n; i++) if (data[i] === 0) return true;
  return false;
}
