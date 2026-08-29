import { pathToFileURL } from "node:url";
import type {
  DefineSkillArgs,
  DefineSubAgentArgs,
  GloveFoldArgs,
  InboxItem,
  ModelAdapter,
  SubscriberAdapter,
  SubscriberEvent,
  SubscriberEventDataMap,
} from "glove-core";
import { Displaymanager, Glove } from "glove-core";
import { mountMesh } from "glove-mesh";
import { Effect } from "effect";
import { signal, type AnySignal } from "station-signal";
import { z } from "zod";
import {
  EMPTY_FOUNDRY_APPLICATION,
  isFoundryApplication,
  type FoundryApplication,
} from "./application.js";
import {
  EMPTY_CAPABILITY_REGISTRY,
  installRegistry,
  isInboxCapableStore,
  mountAgentDefinitionMemory,
  type FoundryMemorySelection,
} from "./capabilities.js";
import {
  FOUNDRY_APPLICATION_ENV,
  FOUNDRY_EVENT_PREFIX,
  FOUNDRY_EXECUTION_MARKER,
  defineAgentFromModule,
  internalAgentName,
  resolveResolvable,
  type AgentAssemblyContext,
  type AgentRuntimeControls,
  type FoundryHookDefinition,
  type FoundryAgentConventionModule,
  type FoundryAgentDefinition,
  type FoundryCall,
  type FoundryMeshConfig,
  type FoundryExecutionContext,
  type Resolvable,
} from "./definition.js";
import {
  mountFoundrySurfaces,
  type FoundryLayerSelection,
  type FoundrySubscriberSelection,
  type FoundrySurfaceContext,
} from "./surfaces.js";
import {
  FOUNDRY_CORE_COMMAND_EVENT,
  createFoundryCoreTools,
  createInstalledApplicationTransmissionTools,
  type FoundryCoreCommand,
} from "./core-tools.js";
import {
  MemoryFoundryDataAdapter,
  freezeGloveMessage,
  toGloveMessage,
  toGloveRequestInput,
  type AgentInstance,
  type Conversation,
  type FoundryMessageInput,
  type FoundryRequest,
  type FoundryResult,
  type FoundryActivationRecord,
} from "./primitives.js";
import {
  agentScheduleActivationId,
  agentScheduleRevision,
  isFoundrySchedule,
  normalizeScheduleTiming,
  type FoundryScheduleDefinition,
} from "./schedule.js";
import {
  FOUNDRY_COMPOSED_PLAYBOOK_BRAND,
  agentPlaybookId,
  composedPlaybookRevision,
  materializeComposedPlaybook,
  type ComposedAgentPlaybook,
} from "./playbook.js";
import {
  mountFoundryWorkbench,
  type FoundryReplDefinition,
  type FoundryWorkingEnvironmentDefinition,
} from "./workbench.js";

const INBOX_ITEMS_SCHEMA = z.array(z.object({
  id: z.string().min(1),
  tag: z.string(),
  request: z.string(),
  response: z.string().nullable(),
  status: z.enum(["pending", "resolved", "consumed"]),
  blocking: z.boolean(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
}));

async function hydrateInbox(
  store: import("glove-core").StoreAdapter,
  items: ReadonlyArray<InboxItem>,
  emit: (event: { type: string; data?: unknown }) => void,
): Promise<void> {
  if (!isInboxCapableStore(store)) {
    throw new Error("Agent inbox loading requires an inbox-capable Glove StoreAdapter.");
  }
  const loaded = INBOX_ITEMS_SCHEMA.parse(items) as ReadonlyArray<InboxItem>;
  const existing = new Map((await store.getInboxItems()).map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  for (const item of loaded) {
    const current = existing.get(item.id);
    if (!current) {
      await store.addInboxItem({ ...item });
      added++;
      continue;
    }
    if (
      current.status !== item.status ||
      current.response !== item.response ||
      current.resolved_at !== item.resolved_at
    ) {
      await store.updateInboxItem(item.id, {
        status: item.status,
        response: item.response,
        resolved_at: item.resolved_at,
      });
      updated++;
    }
  }
  emit({
    type: "foundry.definition.inboxes.loaded",
    data: { count: loaded.length, added, updated },
  });
}

function extractOutput(result: unknown): unknown {
  if (result == null || typeof result !== "object") return result;
  const object = result as Record<string, unknown>;
  if (Array.isArray(object.messages)) {
    const last = object.messages.at(-1) as { text?: string } | undefined;
    return last?.text ?? "";
  }
  return "text" in object ? object.text : result;
}

function serializable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function writeAgentEvent(type: string, data: unknown): Promise<void> {
  const line = `${FOUNDRY_EVENT_PREFIX}${JSON.stringify({
    type,
    data: serializable(data),
    timestamp: new Date().toISOString(),
  })}\n`;
  return new Promise<void>((resolveWrite, rejectWrite) => {
    process.stdout.write(line, (error) => {
      if (error) rejectWrite(error);
      else resolveWrite();
    });
  });
}

function executionSubscriber(): SubscriberAdapter {
  return {
    async record<T extends SubscriberEvent["type"]>(
      eventType: T,
      data: SubscriberEventDataMap[T],
    ): Promise<void> {
      await writeAgentEvent(eventType, data);
    },
  };
}

async function resolveAgentValue<T, TInput>(
  definition: FoundryAgentDefinition,
  value:
    | T
    | ((
        agent: FoundryAgentDefinition,
        context: AgentAssemblyContext<TInput>,
      ) => Resolvable<T>),
  context: AgentAssemblyContext<TInput>,
  field: string,
): Promise<T> {
  context.controls.emit({
    type: "foundry.assembly.resolve.start",
    data: { field },
  });
  const resolved = await resolveResolvable(
    typeof value === "function"
      ? (value as (
          agent: FoundryAgentDefinition,
          context: AgentAssemblyContext<TInput>,
        ) => Resolvable<T>)(definition, context)
      : value,
  );
  context.controls.emit({
    type: "foundry.assembly.resolve.complete",
    data: {
      field,
      count: Array.isArray(resolved) ? resolved.length : undefined,
    },
  });
  return resolved;
}

const HANDLER_ONLY_MODEL: ModelAdapter = {
  name: "foundry-handler",
  setSystemPrompt: () => undefined,
  prompt: async () => {
    throw new Error(
      "This is a model-free Foundry agent. Define run/spawn or configure a model.",
    );
  },
};

async function loadRuntimeApplication(): Promise<FoundryApplication> {
  const path = process.env[FOUNDRY_APPLICATION_ENV];
  if (!path) return EMPTY_FOUNDRY_APPLICATION;
  const imported = (await import(pathToFileURL(path).href)) as {
    default?: unknown;
  };
  if (!isFoundryApplication(imported.default)) {
    throw new Error(
      `${path} must default-export defineApplication(...) for installation resolution.`,
    );
  }
  return imported.default;
}

async function executeSpawned(
  spawned: unknown,
  message: FoundryMessageInput,
  signal: AbortSignal,
): Promise<unknown> {
  if (
    spawned &&
    typeof spawned === "object" &&
    "processRequest" in spawned &&
    typeof spawned.processRequest === "function"
  ) {
    return extractOutput(
      await (spawned.processRequest as (
        message: string | import("glove-core").ContentPart[],
        signal?: AbortSignal,
      ) => Promise<unknown>)(toGloveRequestInput(message), signal),
    );
  }
  if (
    spawned &&
    typeof spawned === "object" &&
    "run" in spawned &&
    typeof spawned.run === "function"
  ) {
    return (spawned.run as (message: FoundryMessageInput, signal: AbortSignal) => unknown)(
      message,
      signal,
    );
  }
  return spawned;
}

async function runDefinition(
  definition: FoundryAgentDefinition,
  id: string,
  runtimeValue: unknown,
): Promise<FoundryResult> {
  const envelope = runtimeValue as {
    readonly request: FoundryRequest;
    readonly agent: AgentInstance;
    readonly conversation: Conversation;
    readonly activations?: ReadonlyArray<FoundryActivationRecord>;
  };
  const request = envelope.request;
  const input = request;
  const runId = process.env.STATION_SIGNAL_RUN_ID ?? "unknown";
  const subscriber = executionSubscriber();
  const abortController = new AbortController();
  const onTerminate = (): void => abortController.abort();
  process.once("SIGTERM", onTerminate);
  let disposeSurfaces: (() => Promise<void>) | undefined;
  const cleanups: Array<() => void | Promise<void>> = [];
  const application = await loadRuntimeApplication();
  const storeFactory = definition.store ?? application.conversationStore;
  const store = storeFactory
    ? await storeFactory({
        definitionId: id,
        agentId: request.agentId,
        conversationId: request.conversationId,
        workspaceId: request.workspaceId,
      })
    : null;
  const history = Object.freeze(
    (store ? await store.getMessages() : []).map(freezeGloveMessage),
  );
  const message = toGloveMessage(request.message);
  const messages = Object.freeze([...history, message]);
  const controls: AgentRuntimeControls = {
    signal: abortController.signal,
    commands: [],
    emit: (event) => {
      void writeAgentEvent(event.type, event.data).catch((cause) => {
        process.stderr.write(
          `Foundry failed to forward agent event: ${cause instanceof Error ? cause.message : String(cause)}\n`,
        );
      });
    },
  };

  try {
    const registry = definition.components ?? {
      capabilities: EMPTY_CAPABILITY_REGISTRY,
      native: { layers: Object.freeze([]), subscribers: Object.freeze([]) },
    };
    const installations = envelope.agent.installations;
    const data = application.data ?? new MemoryFoundryDataAdapter();
    const initialAssemblyContext: AgentAssemblyContext<FoundryRequest> = {
      definitionId: id,
      agentId: request.agentId,
      conversationId: request.conversationId,
      workspaceId: request.workspaceId,
      name: internalAgentName(id),
      runId,
      mode: "agent",
      request,
      agentInstance: envelope.agent,
      conversation: envelope.conversation,
      activations: Object.freeze([...(envelope.activations ?? [])]),
      data,
      input,
      message,
      messageInput: request.message,
      messageText: message.text,
      history,
      messages,
      installations,
      store,
      subscriber,
      controls,
    };
    const assemblyContext = initialAssemblyContext;
    const resolveOptional = async <T>(
      field: string,
      value: unknown,
      fallback: T,
    ): Promise<T> =>
      value === undefined
        ? fallback
        : resolveAgentValue(
            definition,
            value as T | ((agent: FoundryAgentDefinition, context: AgentAssemblyContext<FoundryRequest>) => Resolvable<T>),
            assemblyContext,
            field,
          );

    const [model, systemPrompt, displayManager, compactionLimit, compactionInstructions, maxTurns] =
      await Promise.all([
        resolveOptional("model", definition.model, HANDLER_ONLY_MODEL),
        resolveOptional("systemPrompt", definition.systemPrompt, ""),
        resolveOptional("displayManager", definition.displayManager, new Displaymanager()),
        resolveOptional<number | undefined>("compactionLimit", definition.compactionLimit, undefined),
        resolveOptional("compactionInstructions", definition.compactionInstructions, "Preserve goals, decisions, unresolved work, tool results, and pending inbox items."),
        resolveOptional<number | undefined>("maxTurns", definition.maxTurns, undefined),
      ]);
    const base = new Glove({
      ...(store ? { store } : {}),
      model,
      displayManager,
      systemPrompt,
      serverMode: definition.serverMode ?? true,
      ...(definition.maxRetries !== undefined ? { maxRetries: definition.maxRetries } : {}),
      ...(definition.maxConsecutiveErrors !== undefined ? { maxConsecutiveErrors: definition.maxConsecutiveErrors } : {}),
      compaction_config: {
        compaction_instructions: compactionInstructions,
        ...(maxTurns !== undefined ? { max_turns: maxTurns } : {}),
        ...(compactionLimit !== undefined ? { compaction_context_limit: compactionLimit } : {}),
      },
      ...(definition.enableToolResultSummary !== undefined
        ? { enableToolResultSummary: definition.enableToolResultSummary }
        : {}),
    }).build();
    base.addSubscriber(subscriber);

    const [tools, hooks, skills, subagents, memory, inboxItems, layers, subscribers, calls, playbooks, schedules, mesh, workingEnvironment, repl] =
      await Promise.all([
        resolveOptional<ReadonlyArray<GloveFoldArgs<any>>>("tools", definition.tools, []),
        resolveOptional<ReadonlyArray<FoundryHookDefinition>>("hooks", definition.hooks, []),
        resolveOptional<ReadonlyArray<DefineSkillArgs>>("skills", definition.skills, []),
        resolveOptional<ReadonlyArray<DefineSubAgentArgs>>("subagents", definition.subagents, []),
        resolveOptional<ReadonlyArray<FoundryMemorySelection>>("memory", definition.memory, []),
        definition.inboxes
          ? resolveAgentValue<ReadonlyArray<InboxItem>, FoundryRequest>(
              definition,
              definition.inboxes,
              assemblyContext,
              "inboxes",
            )
          : Promise.resolve([]),
        resolveOptional<ReadonlyArray<FoundryLayerSelection>>("layers", definition.layers, []),
        resolveOptional<ReadonlyArray<FoundrySubscriberSelection | SubscriberAdapter>>("subscribers", definition.subscribers, []),
        resolveOptional<ReadonlyArray<FoundryCall>>("calls", definition.calls, []),
        resolveOptional<ReadonlyArray<ComposedAgentPlaybook>>("playbooks", definition.playbooks, []),
        resolveOptional<ReadonlyArray<FoundryScheduleDefinition>>("schedules", definition.schedules, []),
        resolveOptional<FoundryMeshConfig | undefined>("mesh", definition.mesh, undefined),
        resolveOptional<FoundryWorkingEnvironmentDefinition | undefined>("workingEnvironment", definition.workingEnvironment, undefined),
        resolveOptional<FoundryReplDefinition | undefined>("repl", definition.repl, undefined),
      ]);
    const playbookNames = new Set<string>();
    const desiredPlaybooks = definition.playbooks === undefined
      ? envelope.agent.playbooks
      : playbooks.map((playbook) => {
      if (playbook[FOUNDRY_COMPOSED_PLAYBOOK_BRAND] !== true) {
        throw new Error("Agent playbooks must be created at runtime with composePlaybook(...).");
      }
      if (playbookNames.has(playbook.name)) {
        throw new Error(`Duplicate composed playbook name "${playbook.name}".`);
      }
      playbookNames.add(playbook.name);
      const revision = composedPlaybookRevision(playbook);
      return materializeComposedPlaybook(
        playbook,
        agentPlaybookId(id, request.agentId, playbook.name),
        revision,
      );
      });
    if (definition.playbooks !== undefined) {
      const playbookSync: FoundryCoreCommand = {
        id: `playbook_sync_${runId}`,
        type: "playbook.sync",
        definitionId: id,
        agentId: request.agentId,
        conversationId: request.conversationId,
        workspaceId: request.workspaceId,
        playbooks: desiredPlaybooks,
      };
      controls.commands.push(playbookSync);
      controls.emit({ type: FOUNDRY_CORE_COMMAND_EVENT, data: playbookSync });
      controls.emit({
        type: "foundry.definition.playbooks.composed",
        data: { count: desiredPlaybooks.length, names: desiredPlaybooks.map((item) => item.playbookName) },
      });
    }
    const scheduleNames = new Set<string>();
    const desiredSchedules = schedules.map((schedule) => {
      if (!isFoundrySchedule(schedule)) {
        throw new Error("Agent schedules must be created with defineSchedule(...).");
      }
      if (scheduleNames.has(schedule.name)) {
        throw new Error(`Duplicate agent schedule name "${schedule.name}".`);
      }
      scheduleNames.add(schedule.name);
      return {
        id: agentScheduleActivationId(id, request.agentId, schedule.name),
        name: schedule.name,
        revision: agentScheduleRevision(schedule),
        message: schedule.message,
        ...(schedule.payload !== undefined ? { payload: schedule.payload } : {}),
        timing: normalizeScheduleTiming(schedule.timing),
        enabled: schedule.enabled !== false,
      };
    });
    const scheduleSync: FoundryCoreCommand = {
      id: `schedule_sync_${runId}`,
      type: "schedule.sync",
      definitionId: id,
      agentId: request.agentId,
      conversationId: request.conversationId,
      workspaceId: request.workspaceId,
      schedules: desiredSchedules,
    };
    controls.commands.push(scheduleSync);
    controls.emit({ type: FOUNDRY_CORE_COMMAND_EVENT, data: scheduleSync });
    controls.emit({
      type: "foundry.definition.schedules.loaded",
      data: { count: desiredSchedules.length, names: desiredSchedules.map((item) => item.name) },
    });
    const effectiveInstallations = [...installations];
    for (const tool of createFoundryCoreTools(assemblyContext, desiredSchedules)) base.fold(tool);
    const applicationTransmissionTools = createInstalledApplicationTransmissionTools(
      assemblyContext,
      registry.capabilities.applications,
      effectiveInstallations,
      desiredPlaybooks,
    );
    for (const tool of applicationTransmissionTools) base.fold(tool);
    if (applicationTransmissionTools.length > 0) {
      controls.emit({
        type: "foundry.application.transmission-tools.mounted",
        data: {
          tools: applicationTransmissionTools.map((tool) => tool.name),
        },
      });
    }
    for (const tool of tools) base.fold(tool);
    for (const hook of hooks) base.defineHook(hook.name, hook.handler);
    for (const skill of skills) base.defineSkill(skill);
    for (const subagent of subagents) base.defineSubAgent(subagent);

    const workbench = await mountFoundryWorkbench({
      glove: base,
      context: assemblyContext,
      ...(workingEnvironment ? { workingEnvironment } : {}),
      ...(repl ? { repl } : {}),
    });
    cleanups.push(workbench.dispose);

    const callByName = new Map<string, FoundryCall>();
    const invoke = async (name: string, callInput: unknown): Promise<unknown> => {
      const call = callByName.get(name);
      if (!call) throw new Error(`Foundry call "${name}" is not available.`);
      const parsed = call.input.parse(callInput);
      const value = await resolveResolvable(call.handler(parsed, callContext));
      return call.output.parse(value);
    };
    const surfaceContext: FoundrySurfaceContext<FoundryRequest> = {
      definitionId: id,
      agentId: request.agentId,
      conversationId: request.conversationId,
      workspaceId: request.workspaceId,
      runId,
      input,
      request,
      message,
      messageInput: request.message,
      messageText: message.text,
      history,
      messages,
      glove: base,
      ...(workbench.workingEnvironment
        ? { workingEnvironment: workbench.workingEnvironment, vfs: workbench.vfs }
        : {}),
      ...(workbench.repl ? { repl: workbench.repl } : {}),
      signal: abortController.signal,
      emit: controls.emit,
    };
    const callContext: FoundryExecutionContext<FoundryRequest> = {
      ...surfaceContext,
      installations: effectiveInstallations,
      invoke,
    };
    for (const call of calls) {
      if (callByName.has(call.name)) throw new Error(`Duplicate Foundry call "${call.name}".`);
      callByName.set(call.name, call);
      if (call.exposeToAgent ?? true) {
        base.fold({
          name: call.name,
          description: call.description,
          inputSchema: call.input,
          async do(callInput) {
            try {
              return { status: "success" as const, data: await invoke(call.name, callInput) };
            } catch (cause) {
              return {
                status: "error" as const,
                data: null,
                message: cause instanceof Error ? cause.message : String(cause),
              };
            }
          },
        });
      }
    }

    disposeSurfaces = await mountFoundrySurfaces({
      registry: registry.native,
      layers,
      subscribers,
      context: surfaceContext,
    });
    await Effect.runPromise(
      installRegistry({
        registry: registry.capabilities,
        installations: effectiveInstallations,
        context: {
          definitionId: id,
          agentId: request.agentId,
          conversationId: request.conversationId,
          workspaceId: request.workspaceId,
          runId,
          input,
          request,
          message,
          messageInput: request.message,
          messageText: message.text,
          history,
          messages,
          glove: base,
          store: base.store,
          emit: controls.emit,
        },
        ...(definition.mcpAdapter ? { mcpAdapter: definition.mcpAdapter } : {}),
        ...(definition.accountSessions ? { accountSessions: definition.accountSessions } : {}),
      }),
    );
    await Effect.runPromise(
      mountAgentDefinitionMemory({
        registry: registry.capabilities,
        memory,
        context: {
          definitionId: id,
          agentId: request.agentId,
          conversationId: request.conversationId,
          workspaceId: request.workspaceId,
          runId,
          input,
          request,
          message,
          messageInput: request.message,
          messageText: message.text,
          history,
          messages,
          glove: base,
          store: base.store,
          emit: controls.emit,
        },
      }),
    );
    if (definition.inboxes) {
      await hydrateInbox(base.store, inboxItems, controls.emit);
    }
    if (mesh) {
      await mountMesh(base, {
        adapter: mesh.adapter,
        identity: {
          id: mesh.identity?.id ?? request.agentId,
          name: mesh.identity?.name ?? request.agentId,
          description: mesh.identity?.description ?? definition.description,
          ...(mesh.identity?.capabilities ? { capabilities: mesh.identity.capabilities } : {}),
          metadata: {
            definitionId: id,
            conversationId: request.conversationId,
            workspaceId: request.workspaceId,
            ...(mesh.identity?.metadata ?? {}),
          },
        },
      });
      cleanups.push(() => mesh.adapter.unregister());
    }
    if (definition.configure) {
      await resolveResolvable(definition.configure(base, callContext));
    }
    const glove = definition.build
      ? (await resolveResolvable(definition.build(base, assemblyContext))) ?? base
      : base;
    const runtimeContext = { ...callContext, glove };
    const defaultRun = async () =>
      extractOutput(
        await glove.processRequest(
          toGloveRequestInput(assemblyContext.messageInput),
          abortController.signal,
        ),
      );
    const spawn = async (
      messageInput: FoundryMessageInput = assemblyContext.messageInput,
    ): Promise<unknown> =>
      definition.spawn
        ? executeSpawned(
            await resolveResolvable(definition.spawn(glove, runtimeContext, messageInput)),
            messageInput,
            abortController.signal,
          )
        : defaultRun();
    const handlerContext = {
      ...runtimeContext,
      defaultRun,
      defaultHandler: defaultRun,
      spawn,
    };
    const result = definition.run
      ? await resolveResolvable(definition.run(glove, handlerContext))
      : definition.handler
        ? await resolveResolvable(definition.handler(handlerContext))
        : definition.spawn
          ? await spawn()
          : await defaultRun();
    const sleep = [...controls.commands].reverse().find(
      (command: FoundryCoreCommand) => command.type === "sleep",
    );
    return {
      status: sleep ? "suspended" : "completed",
      value: serializable(result),
      agentId: request.agentId,
      conversationId: request.conversationId,
      workspaceId: request.workspaceId,
      ...(sleep && sleep.type === "sleep"
        ? { suspension: { commandId: sleep.id, wakeAt: sleep.wakeAt } }
        : {}),
    };
  } finally {
    const failures: unknown[] = [];
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup(); } catch (cause) { failures.push(cause); }
    }
    try { if (disposeSurfaces) await disposeSurfaces(); } catch (cause) { failures.push(cause); }
    process.removeListener("SIGTERM", onTerminate);
    if (failures.length > 0) throw new AggregateError(failures, "Foundry agent cleanup failed.");
  }
}

/** Internal compiler used only by the Foundry-owned execution entrypoint. */
export function compileAgentDefinition(
  definition: FoundryAgentDefinition,
  route: string,
): AnySignal {
  const contentPartSchema = z.object({
    type: z.enum(["text", "image", "video", "document"]),
    text: z.string().optional(),
    source: z.object({
      type: z.enum(["base64", "url"]),
      media_type: z.string(),
      data: z.string().optional(),
      url: z.string().optional(),
    }).optional(),
  });
  const requestSchema = z.object({
    agentId: z.string().min(1),
    conversationId: z.string().min(1),
    workspaceId: z.string().min(1),
    message: z.union([z.string(), z.array(contentPartSchema)]),
    payload: z.unknown().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    source: z.object({
      kind: z.enum(["direct", "transmission", "activation", "spawn", "background"]),
      id: z.string().optional(),
      provider: z.string().optional(),
      eventId: z.string().optional(),
      threadKey: z.string().optional(),
    }).optional(),
  });
  const executionEnvelope = z.object({
    [FOUNDRY_EXECUTION_MARKER]: z.literal(true),
    request: requestSchema,
    agent: z.object({
      id: z.string(), definitionId: z.string(), workspaceId: z.string(),
      context: z.record(z.string(), z.unknown()),
      installations: z.array(z.object({
        kind: z.enum(["tool", "application", "mcp"]),
        id: z.string(),
        config: z.unknown().optional(),
      })),
      playbooks: z.array(z.object({
        id: z.string(), transmissionId: z.string(), enabled: z.boolean().optional(),
        match: z.object({
          event: z.string().optional(), routeIds: z.array(z.string()).optional(),
          predicate: z.object({
            name: z.string(), parameters: z.record(z.string(), z.unknown()).optional(),
          }).optional(),
        }).optional(),
        directives: z.array(z.object({
          action: z.string(), instruction: z.string(),
          parameters: z.record(z.string(), z.unknown()).optional(),
        })),
        applications: z.array(z.string()).optional(),
        outbound: z.array(z.object({
          routeId: z.string(), applicationId: z.string().optional(), event: z.string().optional(),
          accountId: z.string().optional(), applicationAccountId: z.string().optional(),
          instruction: z.string().optional(),
        })).optional(),
        serialization: z.record(z.string(), z.unknown()).optional(),
        origin: z.enum(["agent-definition", "instance"]).optional(),
        playbookName: z.string().optional(),
        definitionRevision: z.string().optional(),
      })),
      createdAt: z.string(), updatedAt: z.string(),
    }),
    conversation: z.object({
      id: z.string(), agentId: z.string(), workspaceId: z.string(), title: z.string().optional(),
      context: z.record(z.string(), z.unknown()), createdAt: z.string(), updatedAt: z.string(),
    }),
    activations: z.array(z.object({
      id: z.string(), kind: z.enum(["scheduled", "sleep"]),
      definitionId: z.string(), agentId: z.string(), conversationId: z.string(),
      workspaceId: z.string(), message: z.string(), payload: z.unknown().optional(),
      timing: z.union([
        z.object({ kind: z.literal("at"), at: z.string() }),
        z.object({ kind: z.literal("every"), intervalMs: z.number() }),
        z.object({ kind: z.literal("cron"), expression: z.string(), timezone: z.string() }),
      ]),
      origin: z.enum(["agent-definition", "agent-tool"]), scheduleName: z.string().optional(),
      definitionRevision: z.string().optional(),
      status: z.enum(["pending", "active", "completed", "cancelled"]),
      createdByRunId: z.string(), lastRunId: z.string().optional(),
      createdAt: z.string(), updatedAt: z.string(),
    })).default([]),
  });
  let builder = signal(internalAgentName(route))
    .input(executionEnvelope)
    .output(z.object({
      status: z.enum(["completed", "suspended"]),
      value: z.unknown(),
      agentId: z.string(),
      conversationId: z.string(),
      workspaceId: z.string(),
      suspension: z.object({ commandId: z.string(), wakeAt: z.string() }).optional(),
    }));
  const built = builder.run((value) =>
    runDefinition(definition, route, value),
  );
  return built;
}

export function compileAgentModule(
  route: string,
  module: FoundryAgentConventionModule,
): AnySignal {
  return compileAgentDefinition(defineAgentFromModule(route, module), route);
}
