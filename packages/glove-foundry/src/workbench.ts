import { Effect } from "effect";
import {
  getToolJsonSchema,
  type IGloveRunnable,
  type Tool,
} from "glove-core";
import {
  JsSession,
  type ToolFn,
  mountJs,
  type MountJsConfig,
} from "glove-js";
import {
  LispSession,
  mountLisp,
  type MountLispConfig,
} from "glove-lisp";
import {
  PySession,
  mountPy,
  type MountPyConfig,
} from "glove-python";
import {
  createWorkingEnvironment,
  fromSnapshot,
  mountWorkingEnvironment,
  type CreateWorkingEnvironmentOptions,
  type EnvFsHandle,
  type EnvSnapshot,
  type MountWorkingEnvironmentConfig,
  type Vfs,
  type WorkingEnvironment,
} from "glove-working-environment";
import {
  resolveResolvable,
  type AgentAssemblyContext,
  type Resolvable,
} from "./definition.js";
import type {
  FoundryDataAdapter,
  FoundryRequest,
} from "./primitives.js";

export const FOUNDRY_WORKING_ENVIRONMENT_BRAND = Symbol.for(
  "glove-foundry-working-environment",
);
export const FOUNDRY_REPL_BRAND = Symbol.for("glove-foundry-repl");

export type FoundryVfs = Vfs;
export type FoundryVfsHandle = EnvFsHandle;

export interface FoundryWorkingEnvironmentPersistenceContext {
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly data: FoundryDataAdapter;
  readonly signal: AbortSignal;
}

/**
 * Storage is deliberately adapter-owned. Foundry never chooses a database,
 * object store, locking policy, or credential lifecycle for an environment.
 */
export interface FoundryWorkingEnvironmentPersistenceAdapter {
  readonly identifier: string;
  readonly load: (
    context: FoundryWorkingEnvironmentPersistenceContext,
  ) => Resolvable<EnvSnapshot | null>;
  readonly save: (
    snapshot: EnvSnapshot,
    context: FoundryWorkingEnvironmentPersistenceContext,
  ) => Resolvable<void>;
}

export interface FoundryWorkingEnvironmentCreateContext {
  readonly assembly: AgentAssemblyContext<FoundryRequest>;
  readonly snapshot: EnvSnapshot | null;
}

export interface DefineFoundryWorkingEnvironmentOptions {
  /**
   * Build the native Glove environment. Use this when creation itself needs
   * custom logic. The loaded snapshot is provided but never applied implicitly.
   */
  readonly create?: (
    context: FoundryWorkingEnvironmentCreateContext,
  ) => Resolvable<WorkingEnvironment>;
  /**
   * Native environment options. When persistence returns a snapshot and no
   * filesystem is supplied, Foundry restores that snapshot automatically.
   */
  readonly options?:
    | CreateWorkingEnvironmentOptions
    | ((
        context: FoundryWorkingEnvironmentCreateContext,
      ) => Resolvable<CreateWorkingEnvironmentOptions>);
  readonly persistence?: FoundryWorkingEnvironmentPersistenceAdapter;
  /** Native mount behavior: prompt priming and optional tool prefix. */
  readonly mount?: Omit<MountWorkingEnvironmentConfig, "env">;
  /** Close worker/adaptor resources after the run. Default true. */
  readonly close?: boolean;
}

export type FoundryWorkingEnvironmentDefinition = Readonly<
  DefineFoundryWorkingEnvironmentOptions
> & {
  readonly [FOUNDRY_WORKING_ENVIRONMENT_BRAND]: true;
};

export function defineWorkingEnvironment(
  options: DefineFoundryWorkingEnvironmentOptions = {},
): FoundryWorkingEnvironmentDefinition {
  if (options.create && options.options) {
    throw new Error(
      "defineWorkingEnvironment accepts either create or options, not both.",
    );
  }
  return Object.freeze({
    ...options,
    [FOUNDRY_WORKING_ENVIRONMENT_BRAND]: true as const,
  });
}

function assertSnapshot(value: unknown): EnvSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("Stored working-environment snapshot must be an object.");
  }
  const snapshot = value as Partial<EnvSnapshot>;
  if (
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.dirs) ||
    !snapshot.dirs.every((path) => typeof path === "string") ||
    !Array.isArray(snapshot.files) ||
    !snapshot.files.every((file) =>
      Boolean(
        file &&
          typeof file === "object" &&
          typeof file.path === "string" &&
          typeof file.data === "string" &&
          typeof file.mtime === "number",
      )
    )
  ) {
    throw new Error("Stored working-environment snapshot is invalid or unsupported.");
  }
  return structuredClone(snapshot as EnvSnapshot);
}

function environmentSnapshotOwner(
  scope: "agent" | "conversation",
  context: FoundryWorkingEnvironmentPersistenceContext,
): import("./primitives.js").FoundryWorkingEnvironmentSnapshotOwner {
  return {
    scope,
    definitionId: context.definitionId,
    agentId: context.agentId,
    conversationId: context.conversationId,
    workspaceId: context.workspaceId,
  };
}

/**
 * Convenience persistence over the configured FoundryDataAdapter's private
 * snapshot seam. VFS contents never become public workspace entries.
 */
export function foundryDataEnvironmentPersistence(
  options: { readonly scope?: "agent" | "conversation" } = {},
): FoundryWorkingEnvironmentPersistenceAdapter {
  const scope = options.scope ?? "agent";
  const adapter: FoundryWorkingEnvironmentPersistenceAdapter = {
    identifier: `foundry-data:${scope}`,
    load(
      context: FoundryWorkingEnvironmentPersistenceContext,
    ): Resolvable<EnvSnapshot | null> {
      return Effect.map(
        context.data.getWorkingEnvironmentSnapshot(
          environmentSnapshotOwner(scope, context),
        ),
        (snapshot) => snapshot ? assertSnapshot(snapshot) : null,
      ) as Effect.Effect<EnvSnapshot | null, unknown, never>;
    },
    save(
      snapshot: EnvSnapshot,
      context: FoundryWorkingEnvironmentPersistenceContext,
    ): Resolvable<void> {
      return context.data.putWorkingEnvironmentSnapshot(
        environmentSnapshotOwner(scope, context),
        structuredClone(snapshot),
      );
    },
  };
  return Object.freeze(adapter);
}

interface FoundryReplBase {
  readonly [FOUNDRY_REPL_BRAND]: true;
  /**
   * Project an explicit set of the fully assembled agent's tools into the
   * sandbox as ordinary functions. Selection happens after applications,
   * installed capabilities, memory, mesh, calls, and `configure` have mounted.
   *
   * Returning the actual tool values keeps code relationships referential;
   * Foundry never accepts a second list of copied string ids here.
   */
  readonly programmaticTools?: FoundryProgrammaticTools;
}

export interface FoundryProgrammaticToolSelection {
  /** One of the exact live tools supplied to the selector context. */
  readonly tool: Tool<unknown>;
  /** Optional valid interpreter identifier when the tool name is unsuitable. */
  readonly name?: string;
  /** Informational effect hint used by capability discovery. */
  readonly readOnly?: boolean;
  /** Optional capability group used by progressive discovery. */
  readonly server?: string;
  readonly serverDescription?: string;
  readonly resultShape?: string;
}

export interface FoundryProgrammaticToolContext {
  readonly assembly: AgentAssemblyContext<FoundryRequest>;
  readonly glove: IGloveRunnable;
  /** Snapshot of every tool mounted before the programmatic surface itself. */
  readonly tools: ReadonlyArray<Tool<unknown>>;
  readonly workingEnvironment?: WorkingEnvironment;
  readonly vfs?: EnvFsHandle;
}

export interface FoundryProgrammaticTools {
  /**
   * Select direct live tool references. A selection may decorate its callable
   * name and discovery metadata without replacing the underlying capability.
   */
  readonly select: (
    context: FoundryProgrammaticToolContext,
  ) => Resolvable<ReadonlyArray<Tool<unknown> | FoundryProgrammaticToolSelection>>;
  /** Total underlying calls permitted during this assembled run. Default 50. */
  readonly maxCalls?: number;
}

export type FoundryJavaScriptReplDefinition = FoundryReplBase &
  Readonly<{
    readonly language: "javascript";
    readonly session: JsSession;
    readonly mount?: Omit<MountJsConfig, "session">;
  }>;

export type FoundryPythonReplDefinition = FoundryReplBase &
  Readonly<{
    readonly language: "python";
    readonly session: PySession;
    readonly mount?: Omit<MountPyConfig, "session">;
  }>;

export type FoundryLispReplDefinition = FoundryReplBase &
  Readonly<{
    readonly language: "lisp";
    readonly session: LispSession;
    readonly mount?: Omit<MountLispConfig, "session">;
  }>;

export type FoundryReplDefinition =
  | FoundryJavaScriptReplDefinition
  | FoundryPythonReplDefinition
  | FoundryLispReplDefinition;

export type DefineFoundryReplOptions =
  | Omit<FoundryJavaScriptReplDefinition, typeof FOUNDRY_REPL_BRAND>
  | Omit<FoundryPythonReplDefinition, typeof FOUNDRY_REPL_BRAND>
  | Omit<FoundryLispReplDefinition, typeof FOUNDRY_REPL_BRAND>;

export function defineRepl(
  options: DefineFoundryReplOptions,
): FoundryReplDefinition {
  const valid =
    (options.language === "javascript" && options.session instanceof JsSession) ||
    (options.language === "python" && options.session instanceof PySession) ||
    (options.language === "lisp" && options.session instanceof LispSession);
  if (!valid) {
    throw new Error(
      `Foundry ${options.language} REPL requires the matching native Glove session.`,
    );
  }
  return Object.freeze({
    ...options,
    [FOUNDRY_REPL_BRAND]: true as const,
  }) as FoundryReplDefinition;
}

export type FoundryMountedRepl =
  | Readonly<{ readonly language: "javascript"; readonly session: JsSession }>
  | Readonly<{ readonly language: "python"; readonly session: PySession }>
  | Readonly<{ readonly language: "lisp"; readonly session: LispSession }>;

export interface FoundryMountedWorkbench {
  readonly workingEnvironment?: WorkingEnvironment;
  readonly vfs?: EnvFsHandle;
  readonly repl?: FoundryMountedRepl;
  /** Idempotently expose the configured REPL to the agent. */
  readonly mountRepl: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

function isProgrammaticSelection(
  value: Tool<unknown> | FoundryProgrammaticToolSelection,
): value is FoundryProgrammaticToolSelection {
  return typeof value === "object" && value !== null && "tool" in value;
}

function parseProgrammaticToolData(data: unknown): unknown {
  if (typeof data !== "string") return data;
  const text = data.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return data;
  try {
    return JSON.parse(text);
  } catch {
    return data;
  }
}

async function runProgrammaticTool(
  tool: Tool<unknown>,
  input: unknown,
  signal?: AbortSignal,
) {
  if (tool.unAbortable || !signal) return tool.run(input, undefined, signal);
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  return new Promise<Awaited<ReturnType<Tool<unknown>["run"]>>>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    tool.run(input, undefined, signal).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (cause) => {
        signal.removeEventListener("abort", abort);
        reject(cause);
      },
    );
  });
}

function programmaticToolFunction(
  selection: Tool<unknown> | FoundryProgrammaticToolSelection,
  options: {
    readonly available: ReadonlySet<Tool<unknown>>;
    readonly budget: { used: number; readonly max: number };
    readonly context: AgentAssemblyContext<FoundryRequest>;
  },
): ToolFn {
  const decorated = isProgrammaticSelection(selection) ? selection : { tool: selection };
  const tool = decorated.tool;
  if (!options.available.has(tool)) {
    throw new Error(
      `Programmatic tool "${tool.name}" is not an exact reference from the assembled agent tool registry.`,
    );
  }
  const name = decorated.name ?? tool.name;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `Programmatic tool name "${name}" is not a valid JavaScript/Python/Lisp identifier; provide a valid name override.`,
    );
  }
  return {
    name,
    description: tool.description,
    inputSchema: getToolJsonSchema(tool),
    ...(decorated.readOnly !== undefined ? { readOnlyHint: decorated.readOnly } : {}),
    ...(decorated.server !== undefined ? { server: decorated.server } : {}),
    ...(decorated.serverDescription !== undefined
      ? { serverDescription: decorated.serverDescription }
      : {}),
    ...(decorated.resultShape !== undefined ? { resultShape: decorated.resultShape } : {}),
    async call(input, fnContext = {}) {
      if (options.budget.used >= options.budget.max) {
        options.context.controls.emit({
          type: "foundry.repl.programmatic-tool.limit",
          data: { tool: tool.name, function: name, maxCalls: options.budget.max },
        });
        throw new Error(
          `Programmatic tool-call limit (${options.budget.max}) reached for this run. Return the result already computed or continue in a new run.`,
        );
      }
      options.budget.used += 1;
      const parsed = tool.input_schema?.safeParse(input);
      if (parsed && !parsed.success) {
        throw new Error(
          parsed.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
            .join("; "),
        );
      }
      const validated = parsed?.success ? parsed.data : input;
      const permission = typeof tool.requiresPermission === "function"
        ? tool.requiresPermission(validated)
        : Boolean(tool.requiresPermission);
      if (permission) {
        options.context.controls.emit({
          type: "foundry.repl.programmatic-tool.denied",
          data: { tool: tool.name, function: name, reason: "interactive-approval-required" },
        });
        throw new Error(
          `Tool "${tool.name}" requires interactive approval and cannot run inside a programmatic workflow. Call it directly so the approval can be shown.`,
        );
      }
      const started = Date.now();
      options.context.controls.emit({
        type: "foundry.repl.programmatic-tool.started",
        data: { tool: tool.name, function: name, call: options.budget.used },
      });
      try {
        const result = await runProgrammaticTool(tool, validated, fnContext.signal);
        if (result.status !== "success") {
          throw new Error(result.message ?? `Tool "${tool.name}" failed.`);
        }
        options.context.controls.emit({
          type: "foundry.repl.programmatic-tool.completed",
          data: { tool: tool.name, function: name, durationMs: Date.now() - started },
        });
        return parseProgrammaticToolData(result.data);
      } catch (cause) {
        options.context.controls.emit({
          type: "foundry.repl.programmatic-tool.failed",
          data: {
            tool: tool.name,
            function: name,
            durationMs: Date.now() - started,
            outcome: "error",
          },
        });
        throw cause;
      }
    },
  };
}

async function registerProgrammaticTools(options: {
  readonly repl: FoundryReplDefinition;
  readonly glove: IGloveRunnable;
  readonly context: AgentAssemblyContext<FoundryRequest>;
  readonly workingEnvironment?: WorkingEnvironment;
  readonly vfs?: EnvFsHandle;
}): Promise<number> {
  const config = options.repl.programmaticTools;
  if (!config) return 0;
  const max = config.maxCalls ?? 50;
  if (!Number.isInteger(max) || max < 1 || max > 1_000) {
    throw new Error("Foundry programmaticTools.maxCalls must be an integer from 1 to 1000.");
  }
  const tools = Object.freeze([...options.glove.tools]);
  const selected = await resolveResolvable(config.select({
    assembly: options.context,
    glove: options.glove,
    tools,
    ...(options.workingEnvironment ? { workingEnvironment: options.workingEnvironment } : {}),
    ...(options.vfs ? { vfs: options.vfs } : {}),
  }));
  const available = new Set(tools);
  const budget = { used: 0, max };
  const functions = selected.map((selection) =>
    programmaticToolFunction(selection, { available, budget, context: options.context })
  );
  const names = new Set<string>();
  for (const fn of functions) {
    if (names.has(fn.name)) throw new Error(`Duplicate programmatic function name "${fn.name}".`);
    names.add(fn.name);
  }
  switch (options.repl.language) {
    case "javascript":
    case "python":
      options.repl.session.registerAll(functions);
      break;
    case "lisp":
      options.repl.session.registerFns(functions);
      break;
  }
  return functions.length;
}

function persistenceContext(
  context: AgentAssemblyContext<FoundryRequest>,
): FoundryWorkingEnvironmentPersistenceContext {
  return {
    definitionId: context.definitionId,
    agentId: context.agentId,
    conversationId: context.conversationId,
    workspaceId: context.workspaceId,
    runId: context.runId,
    data: context.data,
    signal: context.controls.signal,
  };
}

async function createEnvironment(
  definition: FoundryWorkingEnvironmentDefinition,
  context: AgentAssemblyContext<FoundryRequest>,
): Promise<{ environment: WorkingEnvironment; persistence: FoundryWorkingEnvironmentPersistenceContext }> {
  if (definition[FOUNDRY_WORKING_ENVIRONMENT_BRAND] !== true) {
    throw new Error(
      "Agent workingEnvironment must be created with defineWorkingEnvironment(...).",
    );
  }
  const persistence = persistenceContext(context);
  const snapshot = definition.persistence
    ? await resolveResolvable(definition.persistence.load(persistence))
    : null;
  const createContext: FoundryWorkingEnvironmentCreateContext = {
    assembly: context,
    snapshot,
  };
  if (definition.create) {
    return {
      environment: await resolveResolvable(definition.create(createContext)),
      persistence,
    };
  }
  const resolvedOptions = typeof definition.options === "function"
    ? await resolveResolvable(definition.options(createContext))
    : definition.options ?? {};
  return {
    environment: await createWorkingEnvironment({
      ...resolvedOptions,
      ...(snapshot && resolvedOptions.filesystem === undefined
        ? { filesystem: fromSnapshot(snapshot) }
        : {}),
    }),
    persistence,
  };
}

export async function mountFoundryWorkbench(options: {
  readonly glove: IGloveRunnable;
  readonly context: AgentAssemblyContext<FoundryRequest>;
  readonly workingEnvironment?: FoundryWorkingEnvironmentDefinition;
  readonly repl?: FoundryReplDefinition;
  /** Internal assembly seam: delay priming until every install/configure surface exists. */
  readonly deferRepl?: boolean;
}): Promise<FoundryMountedWorkbench> {
  let environment: WorkingEnvironment | undefined;
  let persistence: FoundryWorkingEnvironmentPersistenceContext | undefined;
  let mountedRepl: FoundryMountedRepl | undefined;
  let replMountPromise: Promise<void> | undefined;

  const dispose = async (): Promise<void> => {
    if (!environment || !options.workingEnvironment) return;
    const failures: unknown[] = [];
    if (options.workingEnvironment.persistence && persistence) {
      try {
        const snapshot = await environment.snapshot();
        await resolveResolvable(
          options.workingEnvironment.persistence.save(snapshot, persistence),
        );
        options.context.controls.emit({
          type: "foundry.working-environment.snapshot.saved",
          data: {
            persistence: options.workingEnvironment.persistence.identifier,
            files: snapshot.files.length,
          },
        });
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (options.workingEnvironment.close !== false) {
      try {
        await environment.close();
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Foundry working-environment cleanup failed.",
      );
    }
  };

  const mountRepl = (): Promise<void> => {
    const repl = options.repl;
    if (!repl) return Promise.resolve();
    if (replMountPromise) return replMountPromise;
    replMountPromise = (async () => {
      if (repl[FOUNDRY_REPL_BRAND] !== true) {
        throw new Error("Agent repl must be created with defineRepl(...).");
      }
      const programmaticTools = await registerProgrammaticTools({
        repl,
        glove: options.glove,
        context: options.context,
        ...(environment ? { workingEnvironment: environment, vfs: environment.fs } : {}),
      });
      switch (repl.language) {
        case "javascript":
          mountJs(options.glove, {
            session: repl.session,
            ...(repl.mount ?? {}),
            exclusive: false,
          });
          break;
        case "python":
          mountPy(options.glove, {
            session: repl.session,
            ...(repl.mount ?? {}),
            exclusive: false,
          });
          break;
        case "lisp":
          mountLisp(options.glove, {
            session: repl.session,
            ...(repl.mount ?? {}),
            exclusive: false,
          });
          break;
      }
      options.context.controls.emit({
        type: "foundry.repl.mounted",
        data: {
          language: repl.language,
          frame: repl.mount?.frame ?? "repl",
          programmaticTools,
        },
      });
    })();
    return replMountPromise;
  };

  try {
    if (options.workingEnvironment) {
      const created = await createEnvironment(
        options.workingEnvironment,
        options.context,
      );
      environment = created.environment;
      persistence = created.persistence;
      mountWorkingEnvironment(options.glove, {
        env: environment,
        ...(options.workingEnvironment.mount ?? {}),
      });
      options.context.controls.emit({
        type: "foundry.working-environment.mounted",
        data: {
          tools: environment.tools.map((tool) => tool.name),
          modules: [...environment.moduleDescriptions.keys()],
          warnings: environment.warnings,
          persistence: options.workingEnvironment.persistence?.identifier ?? null,
        },
      });
    }

    if (options.repl) {
      mountedRepl = options.repl.language === "javascript"
        ? Object.freeze({ language: "javascript" as const, session: options.repl.session })
        : options.repl.language === "python"
          ? Object.freeze({ language: "python" as const, session: options.repl.session })
          : Object.freeze({ language: "lisp" as const, session: options.repl.session });
      if (!options.deferRepl) await mountRepl();
    }

    return {
      ...(environment ? { workingEnvironment: environment, vfs: environment.fs } : {}),
      ...(mountedRepl ? { repl: mountedRepl } : {}),
      mountRepl,
      dispose,
    };
  } catch (cause) {
    try {
      await dispose();
    } catch (cleanupCause) {
      throw new AggregateError(
        [cause, cleanupCause],
        "Foundry workbench mounting and cleanup failed.",
      );
    }
    throw cause;
  }
}
