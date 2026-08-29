import { Effect } from "effect";
import type { IGloveRunnable } from "glove-core";
import {
  JsSession,
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
  readonly dispose: () => Promise<void>;
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
}): Promise<FoundryMountedWorkbench> {
  let environment: WorkingEnvironment | undefined;
  let persistence: FoundryWorkingEnvironmentPersistenceContext | undefined;
  let mountedRepl: FoundryMountedRepl | undefined;

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
      if (options.repl[FOUNDRY_REPL_BRAND] !== true) {
        throw new Error("Agent repl must be created with defineRepl(...).");
      }
      switch (options.repl.language) {
        case "javascript":
          mountJs(options.glove, {
            session: options.repl.session,
            ...(options.repl.mount ?? {}),
          });
          mountedRepl = Object.freeze({
            language: "javascript" as const,
            session: options.repl.session,
          });
          break;
        case "python":
          mountPy(options.glove, {
            session: options.repl.session,
            ...(options.repl.mount ?? {}),
          });
          mountedRepl = Object.freeze({
            language: "python" as const,
            session: options.repl.session,
          });
          break;
        case "lisp":
          mountLisp(options.glove, {
            session: options.repl.session,
            ...(options.repl.mount ?? {}),
          });
          mountedRepl = Object.freeze({
            language: "lisp" as const,
            session: options.repl.session,
          });
          break;
      }
      options.context.controls.emit({
        type: "foundry.repl.mounted",
        data: {
          language: options.repl.language,
          frame: options.repl.mount?.frame ?? "repl",
        },
      });
    }

    return {
      ...(environment ? { workingEnvironment: environment, vfs: environment.fs } : {}),
      ...(mountedRepl ? { repl: mountedRepl } : {}),
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
