import type {
  IGloveRunnable,
  StoreAdapter,
  SubscriberAdapter,
} from "glove-core";
import { z } from "zod";
import { getAdapter, getTriggerAdapter } from "./config.js";
import { AgentValidationError } from "./errors.js";
import { parseInterval } from "./interval.js";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  type AgentMode,
  type Run,
} from "./types.js";
import { AGENT_BRAND } from "./util.js";

const VALID_NAME = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function assertTimeoutMs(ms: number): void {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    throw new RangeError(
      `.timeout(ms) requires a finite positive number; got ${String(ms)}`,
    );
  }
}

function assertConcurrency(n: number): void {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    throw new RangeError(
      `.concurrency(n) requires an integer >= 1; got ${String(n)}`,
    );
  }
}

function assertRetries(n: number): void {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    throw new RangeError(
      `.retries(n) requires a non-negative integer; got ${String(n)}`,
    );
  }
}

// ─── Factory context ─────────────────────────────────────────────────────────

export interface AgentFactoryContext {
  /** The agent's registered name. Stable across triggered wakeups. */
  name: string;
  /**
   * Run id. Per-wakeup for triggered agents; the stable string "warmup" for
   * concurrent agents during factory setup (later notify-runs get their own
   * ids — the bootstrap rotates `currentRunId` as IPC envelopes arrive).
   */
  runId: string;
  mode: AgentMode;
  /**
   * The persistent store built by the agent's `.store(factory)` setter, if
   * configured. `null` when the agent factory builds its own store.
   *
   * For triggered agents WITHOUT a persistent store, every wakeup starts
   * with a fresh in-memory context — that's almost certainly not what you
   * want, and the runtime emits a warning at discovery.
   */
  store: StoreAdapter | null;
  /**
   * A pre-built subscriber that forwards every Glove `SubscriberEvent` to
   * the parent runner via IPC. Factories should attach it to the Glove —
   * the bootstrap re-attaches defensively after the factory returns.
   */
  subscriber: SubscriberAdapter;
  controls: AgentRuntimeControls;
}

export interface AgentRuntimeControls {
  /**
   * Emit a custom event back to the runner's subscribers, wrapped as an
   * `agent:event` envelope. The `type` field becomes the envelope's
   * `event_type`; use a namespaced string (e.g. `"app:metric"`) so it
   * doesn't collide with the built-in `SubscriberEvent` types.
   */
  emit(event: { type: string; data?: Record<string, unknown> }): void;
  /**
   * Fires when the agent is being shut down — graceful stop, restart, or
   * terminal failure. Factories register cleanup (e.g. mesh unregister)
   * via `controls.signal.addEventListener("abort", …)`.
   */
  signal: AbortSignal;
}

// ─── Built agent shape ───────────────────────────────────────────────────────

interface AgentCommon<TInput, TOutput> {
  readonly [AGENT_BRAND]: true;
  readonly name: string;
  readonly mode: AgentMode;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema?: z.ZodType<TOutput>;
  readonly factory: (ctx: AgentFactoryContext) => Promise<IGloveRunnable>;
  readonly storeFactory?: (
    name: string,
  ) => Promise<StoreAdapter> | StoreAdapter;
  readonly onCompleteHandler?: (
    output: TOutput,
    input: TInput,
  ) => Promise<void> | void;
  readonly timeout: number;
  readonly maxAttempts: number;
  readonly maxConcurrency?: number;
  readonly env?: Record<string, string>;
  /** Hand off an input. Returns a run id immediately; does not wait for execution. */
  trigger(input: TInput): Promise<string>;
}

export interface TriggeredAgent<TInput = unknown, TOutput = void>
  extends AgentCommon<TInput, TOutput> {
  readonly mode: "triggered";
  readonly interval?: string;
  readonly recurringInput?: TInput;
}

export interface ConcurrentAgent<TInput = unknown, TOutput = void>
  extends AgentCommon<TInput, TOutput> {
  readonly mode: "concurrent";
  /**
   * Push an input to the warm subprocess. Same wire-effect as `trigger()`
   * for a concurrent agent (both enqueue `kind: "notify"`); exposed as a
   * separate name for callsite clarity ("I am pushing into a warm peer").
   */
  notify(input: TInput): Promise<string>;
}

export type Agent<TInput = unknown, TOutput = void> =
  | TriggeredAgent<TInput, TOutput>
  | ConcurrentAgent<TInput, TOutput>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgent = Agent<any, any>;

// ─── Internal config carried by the builders ────────────────────────────────

interface CommonConfig<TInput, TOutput> {
  name: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  factory?: (ctx: AgentFactoryContext) => Promise<IGloveRunnable>;
  storeFactory?: (name: string) => Promise<StoreAdapter> | StoreAdapter;
  onCompleteHandler?: (
    output: TOutput,
    input: TInput,
  ) => Promise<void> | void;
  timeout: number;
  maxAttempts: number;
  maxConcurrency?: number;
  env?: Record<string, string>;
}

interface TriggeredConfig<TInput, TOutput> extends CommonConfig<TInput, TOutput> {
  interval?: string;
  recurringInput?: TInput;
}

type ConcurrentConfig<TInput, TOutput> = CommonConfig<TInput, TOutput>;

function makeRunBase(
  agentName: string,
  kind: Run["kind"],
  inputJson: string,
  maxAttempts: number,
  timeout: number,
  id: string,
): Run {
  return {
    id,
    agentName,
    kind,
    input: inputJson,
    status: "pending",
    attempts: 0,
    maxAttempts,
    timeout,
    createdAt: new Date(),
  };
}

async function enqueueLocal(
  agentName: string,
  inputJson: string,
  kind: Run["kind"],
  maxAttempts: number,
  timeout: number,
): Promise<string> {
  const adapter = getAdapter();
  const id = adapter.generateId();
  const run = makeRunBase(agentName, kind, inputJson, maxAttempts, timeout, id);
  await adapter.addRun(run);
  return id;
}

function buildTriggered<TInput, TOutput>(
  cfg: TriggeredConfig<TInput, TOutput>,
): TriggeredAgent<TInput, TOutput> {
  if (!cfg.factory) {
    throw new Error(
      `Agent "${cfg.name}" must call .factory(…) before it can be used.`,
    );
  }
  const factory = cfg.factory;

  const agent: TriggeredAgent<TInput, TOutput> = {
    [AGENT_BRAND]: true as const,
    name: cfg.name,
    mode: "triggered",
    inputSchema: cfg.inputSchema,
    outputSchema: cfg.outputSchema,
    factory,
    storeFactory: cfg.storeFactory,
    onCompleteHandler: cfg.onCompleteHandler,
    interval: cfg.interval,
    recurringInput: cfg.recurringInput,
    timeout: cfg.timeout,
    maxAttempts: cfg.maxAttempts,
    maxConcurrency: cfg.maxConcurrency,
    env: cfg.env,
    async trigger(input: TInput): Promise<string> {
      const result = cfg.inputSchema.safeParse(input);
      if (!result.success) {
        throw new AgentValidationError(cfg.name, result.error.message);
      }
      const remote = getTriggerAdapter();
      if (remote) {
        return remote.trigger(cfg.name, result.data);
      }
      return enqueueLocal(
        cfg.name,
        JSON.stringify(result.data),
        "trigger",
        cfg.maxAttempts,
        cfg.timeout,
      );
    },
  };
  return Object.freeze(agent);
}

function buildConcurrent<TInput, TOutput>(
  cfg: ConcurrentConfig<TInput, TOutput>,
): ConcurrentAgent<TInput, TOutput> {
  if (!cfg.factory) {
    throw new Error(
      `Agent "${cfg.name}" must call .factory(…) before it can be used.`,
    );
  }
  const factory = cfg.factory;

  async function push(input: TInput): Promise<string> {
    const result = cfg.inputSchema.safeParse(input);
    if (!result.success) {
      throw new AgentValidationError(cfg.name, result.error.message);
    }
    const remote = getTriggerAdapter();
    if (remote) {
      return remote.trigger(cfg.name, result.data);
    }
    return enqueueLocal(
      cfg.name,
      JSON.stringify(result.data),
      "notify",
      cfg.maxAttempts,
      cfg.timeout,
    );
  }

  const agent: ConcurrentAgent<TInput, TOutput> = {
    [AGENT_BRAND]: true as const,
    name: cfg.name,
    mode: "concurrent",
    inputSchema: cfg.inputSchema,
    outputSchema: cfg.outputSchema,
    factory,
    storeFactory: cfg.storeFactory,
    onCompleteHandler: cfg.onCompleteHandler,
    timeout: cfg.timeout,
    maxAttempts: cfg.maxAttempts,
    maxConcurrency: cfg.maxConcurrency,
    env: cfg.env,
    trigger: push,
    notify: push,
  };
  return Object.freeze(agent);
}

// ─── Builders ───────────────────────────────────────────────────────────────

/**
 * Pre-mode builder. Carries the input/output schemas and any setters that
 * apply to both modes; calling `.triggered()` or `.concurrent()` forks into
 * the mode-specific builder.
 */
export class AgentBuilder<TInput = unknown, TOutput = void> {
  private _name: string;
  private _inputSchema?: z.ZodType<TInput>;
  private _outputSchema?: z.ZodType<TOutput>;
  private _timeout: number = DEFAULT_TIMEOUT_MS;
  private _maxConcurrency?: number;
  private _env?: Record<string, string>;
  private _storeFactory?: (
    name: string,
  ) => Promise<StoreAdapter> | StoreAdapter;

  constructor(name: string) {
    if (!VALID_NAME.test(name)) {
      throw new Error(
        `Invalid agent name "${name}". Names must start with a letter and contain only letters, digits, hyphens, and underscores.`,
      );
    }
    this._name = name;
  }

  private _clone(): AgentBuilder<TInput, TOutput> {
    const b = new AgentBuilder<TInput, TOutput>(this._name);
    b._inputSchema = this._inputSchema;
    b._outputSchema = this._outputSchema;
    b._timeout = this._timeout;
    b._maxConcurrency = this._maxConcurrency;
    b._env = this._env ? { ...this._env } : undefined;
    b._storeFactory = this._storeFactory;
    return b;
  }

  input<T>(schema: z.ZodType<T>): AgentBuilder<T, TOutput> {
    const b = new AgentBuilder<T, TOutput>(this._name);
    b._inputSchema = schema;
    b._outputSchema = this._outputSchema as unknown as
      | z.ZodType<TOutput>
      | undefined;
    b._timeout = this._timeout;
    b._maxConcurrency = this._maxConcurrency;
    b._env = this._env ? { ...this._env } : undefined;
    b._storeFactory = this._storeFactory;
    return b;
  }

  output<T>(schema: z.ZodType<T>): AgentBuilder<TInput, T> {
    const b = new AgentBuilder<TInput, T>(this._name);
    b._inputSchema = this._inputSchema as unknown as
      | z.ZodType<TInput>
      | undefined;
    b._outputSchema = schema;
    b._timeout = this._timeout;
    b._maxConcurrency = this._maxConcurrency;
    b._env = this._env ? { ...this._env } : undefined;
    b._storeFactory = this._storeFactory;
    return b;
  }

  timeout(ms: number): AgentBuilder<TInput, TOutput> {
    assertTimeoutMs(ms);
    const b = this._clone();
    b._timeout = ms;
    return b;
  }

  concurrency(n: number): AgentBuilder<TInput, TOutput> {
    assertConcurrency(n);
    const b = this._clone();
    b._maxConcurrency = n;
    return b;
  }

  env(env: Record<string, string>): AgentBuilder<TInput, TOutput> {
    const b = this._clone();
    b._env = { ...env };
    return b;
  }

  store(
    factory: (name: string) => Promise<StoreAdapter> | StoreAdapter,
  ): AgentBuilder<TInput, TOutput> {
    const b = this._clone();
    b._storeFactory = factory;
    return b;
  }

  private _commonConfig(): CommonConfig<TInput, TOutput> {
    return {
      name: this._name,
      // Permissive fallback so callers who skip .input() don't lose primitives
      // / arrays / non-object payloads. A real schema almost always overrides
      // this; the fallback exists only so the builder is usable without one.
      inputSchema:
        this._inputSchema ??
        (z.any() as unknown as z.ZodType<TInput>),
      outputSchema: this._outputSchema,
      timeout: this._timeout,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      maxConcurrency: this._maxConcurrency,
      env: this._env,
      storeFactory: this._storeFactory,
    };
  }

  triggered(): TriggeredAgentBuilder<TInput, TOutput> {
    return new TriggeredAgentBuilder<TInput, TOutput>(this._commonConfig());
  }

  concurrent(): ConcurrentAgentBuilder<TInput, TOutput> {
    return new ConcurrentAgentBuilder<TInput, TOutput>(this._commonConfig());
  }
}

/** Triggered-mode builder. `.retries()`, `.every()`, `.withInput()` live here. */
export class TriggeredAgentBuilder<TInput = unknown, TOutput = void> {
  private _config: TriggeredConfig<TInput, TOutput>;

  /** @internal */
  constructor(config: CommonConfig<TInput, TOutput>) {
    this._config = { ...config };
  }

  private _clone(): TriggeredAgentBuilder<TInput, TOutput> {
    const b = new TriggeredAgentBuilder<TInput, TOutput>({
      ...this._config,
    });
    b._config = { ...this._config };
    return b;
  }

  timeout(ms: number): TriggeredAgentBuilder<TInput, TOutput> {
    assertTimeoutMs(ms);
    const b = this._clone();
    b._config.timeout = ms;
    return b;
  }

  retries(n: number): TriggeredAgentBuilder<TInput, TOutput> {
    assertRetries(n);
    const b = this._clone();
    b._config.maxAttempts = n + 1;
    return b;
  }

  concurrency(n: number): TriggeredAgentBuilder<TInput, TOutput> {
    assertConcurrency(n);
    const b = this._clone();
    b._config.maxConcurrency = n;
    return b;
  }

  env(env: Record<string, string>): TriggeredAgentBuilder<TInput, TOutput> {
    const b = this._clone();
    b._config.env = { ...env };
    return b;
  }

  store(
    factory: (name: string) => Promise<StoreAdapter> | StoreAdapter,
  ): TriggeredAgentBuilder<TInput, TOutput> {
    const b = this._clone();
    b._config.storeFactory = factory;
    return b;
  }

  every(interval: string): TriggeredAgentBuilder<TInput, TOutput> {
    parseInterval(interval);
    const b = this._clone();
    b._config.interval = interval;
    return b;
  }

  withInput(input: TInput): TriggeredAgentBuilder<TInput, TOutput> {
    const b = this._clone();
    b._config.recurringInput = input;
    return b;
  }

  onComplete(
    handler: (output: TOutput, input: TInput) => Promise<void> | void,
  ): TriggeredAgentBuilder<TInput, TOutput> {
    const b = this._clone();
    b._config.onCompleteHandler = handler;
    return b;
  }

  factory(
    fn: (ctx: AgentFactoryContext) => Promise<IGloveRunnable>,
  ): TriggeredAgent<TInput, TOutput> {
    const b = this._clone();
    b._config.factory = fn;
    return buildTriggered(b._config);
  }
}

/** Concurrent-mode builder. No retries / every — concurrent agents are always-on. */
export class ConcurrentAgentBuilder<TInput = unknown, TOutput = void> {
  private _config: ConcurrentConfig<TInput, TOutput>;

  /** @internal */
  constructor(config: CommonConfig<TInput, TOutput>) {
    this._config = { ...config };
  }

  private _clone(): ConcurrentAgentBuilder<TInput, TOutput> {
    const b = new ConcurrentAgentBuilder<TInput, TOutput>({
      ...this._config,
    });
    b._config = { ...this._config };
    return b;
  }

  timeout(ms: number): ConcurrentAgentBuilder<TInput, TOutput> {
    assertTimeoutMs(ms);
    const b = this._clone();
    b._config.timeout = ms;
    return b;
  }

  concurrency(n: number): ConcurrentAgentBuilder<TInput, TOutput> {
    assertConcurrency(n);
    const b = this._clone();
    b._config.maxConcurrency = n;
    return b;
  }

  env(env: Record<string, string>): ConcurrentAgentBuilder<TInput, TOutput> {
    const b = this._clone();
    b._config.env = { ...env };
    return b;
  }

  store(
    factory: (name: string) => Promise<StoreAdapter> | StoreAdapter,
  ): ConcurrentAgentBuilder<TInput, TOutput> {
    const b = this._clone();
    b._config.storeFactory = factory;
    return b;
  }

  onComplete(
    handler: (output: TOutput, input: TInput) => Promise<void> | void,
  ): ConcurrentAgentBuilder<TInput, TOutput> {
    const b = this._clone();
    b._config.onCompleteHandler = handler;
    return b;
  }

  factory(
    fn: (ctx: AgentFactoryContext) => Promise<IGloveRunnable>,
  ): ConcurrentAgent<TInput, TOutput> {
    const b = this._clone();
    b._config.factory = fn;
    return buildConcurrent(b._config);
  }
}

/** Start building an agent. Chain `.input(zod).triggered()…` or `.input(zod).concurrent()…`. */
export function agent(name: string): AgentBuilder {
  return new AgentBuilder(name);
}
