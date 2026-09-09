import { randomUUID } from "node:crypto";
import type { GloveFoldArgs } from "glove-core";
import { Effect, JSONSchema, Schema } from "effect";
import { z } from "zod";
import type { AgentAssemblyContext } from "./definition.js";
import { id as foundryId } from "./primitives.js";
import type { FoundryActivationRecord } from "./primitives.js";
import type {
  AgentInstallation,
  FoundryAgentApplication,
} from "./capabilities.js";
import type { AnyFoundryTransmission } from "./integration.js";
import type { AgentPlaybook } from "./playbook.js";
import {
  durationMillis,
  normalizeScheduleTiming,
  type FoundryScheduleTiming,
  type FoundryScheduleTimingInput,
} from "./schedule.js";

export const FOUNDRY_CORE_COMMAND_EVENT = "foundry.core.command";

export type FoundryCoreCommand =
  | {
      readonly id: string;
      readonly type: "spawn";
      readonly definitionId: string;
      readonly agentId?: string;
      readonly conversationId?: string;
      readonly workspaceId: string;
      readonly message: string;
      readonly payload?: unknown;
    }
  | {
      readonly id: string;
      readonly type: "schedule";
      readonly definitionId: string;
      readonly agentId?: string;
      readonly conversationId?: string;
      readonly workspaceId: string;
      readonly message: string;
      readonly payload?: unknown;
      readonly timing:
        | { readonly kind: "at"; readonly at: string }
        | { readonly kind: "every"; readonly intervalMs: number }
        | { readonly kind: "cron"; readonly expression: string; readonly timezone: string };
    }
  | {
      readonly id: string;
      readonly type: "playbook.sync";
      readonly definitionId: string;
      readonly agentId: string;
      readonly conversationId: string;
      readonly workspaceId: string;
      readonly playbooks: ReadonlyArray<AgentPlaybook>;
    }
  | {
      readonly id: string;
      readonly type: "schedule.sync";
      readonly definitionId: string;
      readonly agentId: string;
      readonly conversationId: string;
      readonly workspaceId: string;
      readonly schedules: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly revision: string;
        readonly message: string;
        readonly payload?: unknown;
        readonly timing: FoundryScheduleTiming;
        readonly enabled: boolean;
      }>;
    }
  | {
      readonly id: string;
      readonly type: "schedule.update";
      readonly definitionId: string;
      readonly agentId: string;
      readonly conversationId: string;
      readonly workspaceId: string;
      readonly activationId: string;
      readonly patch: {
        readonly message?: string;
        readonly payload?: unknown;
        readonly timing?: FoundryScheduleTiming;
      };
    }
  | {
      readonly id: string;
      readonly type: "schedule.cancel";
      readonly definitionId: string;
      readonly agentId: string;
      readonly conversationId: string;
      readonly workspaceId: string;
      readonly activationId: string;
    }
  | {
      readonly id: string;
      readonly type: "sleep";
      readonly definitionId: string;
      readonly agentId: string;
      readonly conversationId: string;
      readonly workspaceId: string;
      readonly wakeAt: string;
      readonly message: string;
    }
  | {
      readonly id: string;
      readonly type: "background";
      readonly definitionId: string;
      readonly agentId: string;
      readonly conversationId: string;
      readonly workspaceId: string;
      readonly message: string;
      readonly payload?: unknown;
      readonly reconvene: boolean;
    }
  | {
      readonly id: string;
      readonly type: "transmit";
      readonly definitionId: string;
      readonly agentId: string;
      readonly conversationId: string;
      readonly workspaceId: string;
      readonly routeId: string;
      readonly payload: unknown;
      readonly applicationId?: string;
      readonly transmissionId?: string;
    };

function commandId(): string {
  return `command_${randomUUID()}`;
}

function durationSchema(description: string) {
  return z.string().describe(description).refine((value) => {
    try {
      durationMillis(value);
      return true;
    } catch {
      return false;
    }
  }, "Use a positive duration such as 30s, 5m, 2h, or '5 minutes'.");
}

function afterDuration(value: string): string {
  return (normalizeScheduleTiming({ kind: "after", duration: value }) as { kind: "at"; at: string }).at;
}

const timingInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), at: z.string().datetime() }),
  z.object({ kind: z.literal("after"), duration: durationSchema("Delay before the one-time activation") }),
  z.object({ kind: z.literal("every"), interval: durationSchema("Interval between recurring activations") }),
  z.object({ kind: z.literal("cron"), expression: z.string().min(1), timezone: z.string().min(1).default("UTC") }),
]);

function toolSegment(value: string): string {
  return value.replaceAll("/", "__").replaceAll("-", "_");
}

/** Resolve an installed app's generated outbound tool without duplicating ids. */
export function installedApplicationTransmissionToolName(
  application: { readonly id: string },
  transmission: { readonly id: string },
): string {
  return `glove_app_${toolSegment(application.id)}__${toolSegment(transmission.id)}_send`;
}

function outboundToolSchema(
  transmission: AnyFoundryTransmission,
  routeIds: ReadonlyArray<string>,
): Record<string, unknown> {
  const document = JSONSchema.make(transmission.outbound!.input) as unknown as
    Record<string, unknown>;
  const { $schema: _schema, $defs, ...payload } = document;
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      routeId: {
        type: "string",
        description: "Authorized Foundry outbound route id",
        ...(routeIds.length > 0 ? { enum: routeIds } : {}),
      },
      payload,
    },
    required: ["routeId", "payload"],
    ...($defs ? { $defs } : {}),
  };
}

/**
 * Installed apps expose one namespaced Glove tool per outbound transmission.
 * The tool only queues a parent-runtime command; grants and delivery adapters
 * remain authoritative outside the agent subprocess.
 */
export function createInstalledApplicationTransmissionTools(
  context: AgentAssemblyContext,
  applications: ReadonlyArray<FoundryAgentApplication>,
  installations: ReadonlyArray<AgentInstallation>,
  playbooks: ReadonlyArray<AgentPlaybook> = context.agentInstance.playbooks,
): ReadonlyArray<GloveFoldArgs<any>> {
  const installed = new Set(
    installations
      .filter((item) => item.kind === "application")
      .map((item) => item.id),
  );
  const emit = (command: FoundryCoreCommand) => {
    context.controls.commands.push(command);
    context.controls.emit({ type: FOUNDRY_CORE_COMMAND_EVENT, data: command });
    return success(command);
  };
  const tools: GloveFoldArgs<any>[] = [];
  for (const application of applications) {
    if (!installed.has(application.id)) continue;
    for (const transmission of application.transmissions ?? []) {
      if (!transmission.outbound) continue;
      const routeIds = [...new Set(
        playbooks
          .filter(
            (playbook) =>
              playbook.enabled !== false &&
              playbook.transmissionId === transmission.id,
          )
          .flatMap((playbook) =>
            (playbook.outbound ?? [])
              .filter((outbound) =>
                outbound.applicationId
                  ? outbound.applicationId === application.id
                  : (playbook.applications ?? []).includes(application.id),
              )
              .map((outbound) => outbound.routeId),
          ),
      )].sort();
      tools.push({
        name: installedApplicationTransmissionToolName(application, transmission),
        description: [
          `Send through the ${transmission.name} outbound transmission installed by the ${application.id} application.`,
          routeIds.length > 0
            ? `Allowed playbook routes: ${routeIds.join(", ")}.`
            : "Supply a route authorized for this agent run.",
        ].join(" "),
        jsonSchema: outboundToolSchema(transmission, routeIds),
        async do(input: { readonly routeId: string; readonly payload: unknown }) {
          if (routeIds.length > 0 && !routeIds.includes(input.routeId)) {
            return {
              status: "error" as const,
              data: null,
              message: `Route "${input.routeId}" is not selected for application "${application.id}".`,
            };
          }
          try {
            const payload = await Schema.decodeUnknownPromise(
              transmission.outbound!.input,
            )(input.payload);
            return emit({
              id: commandId(),
              type: "transmit",
              definitionId: context.definitionId,
              agentId: context.agentId,
              conversationId: context.conversationId,
              workspaceId: context.workspaceId,
              routeId: input.routeId,
              payload,
              applicationId: application.id,
              transmissionId: transmission.id,
            });
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
  return Object.freeze(tools);
}

function success(command: FoundryCoreCommand) {
  return {
    status: "success" as const,
    data: {
      commandId: command.id,
      accepted: true,
      type: command.type,
      ...(command.type === "sleep" ? { wakeAt: command.wakeAt } : {}),
      ...(command.type === "schedule" ? { timing: command.timing } : {}),
      ...("activationId" in command ? { activationId: command.activationId } : {}),
    },
  };
}

/** Framework-owned orchestration tools. They emit commands for Foundry's runtime adapters. */
export function createFoundryCoreTools(
  context: AgentAssemblyContext,
  desiredSchedules: Extract<FoundryCoreCommand, { readonly type: "schedule.sync" }>["schedules"] = [],
): ReadonlyArray<GloveFoldArgs<any>> {
  const emit = (command: FoundryCoreCommand) => {
    context.controls.commands.push(command);
    context.controls.emit({ type: FOUNDRY_CORE_COMMAND_EVENT, data: command });
    return success(command);
  };
  const scheduleView = (): ReadonlyArray<FoundryActivationRecord> => {
    const records = new Map(
      context.activations
        .filter((item) => item.kind === "scheduled")
        .map((item) => [item.id, item]),
    );
    const now = new Date().toISOString();
    for (const desired of desiredSchedules) {
      if (records.has(desired.id) || !desired.enabled) continue;
      records.set(desired.id, {
        id: desired.id,
        kind: "scheduled",
        definitionId: context.definitionId,
        agentId: context.agentId,
        conversationId: context.conversationId,
        workspaceId: context.workspaceId,
        message: desired.message,
        ...(desired.payload !== undefined ? { payload: desired.payload } : {}),
        timing: desired.timing,
        origin: "agent-definition",
        scheduleName: desired.name,
        definitionRevision: desired.revision,
        status: "pending",
        createdByRunId: context.runId,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const command of context.controls.commands) {
      if (command.type === "schedule" && command.agentId === context.agentId) {
        const createdAt = new Date().toISOString();
        records.set(command.id, {
          id: command.id,
          kind: "scheduled",
          definitionId: command.definitionId,
          agentId: context.agentId,
          conversationId: command.conversationId ?? context.conversationId,
          workspaceId: command.workspaceId,
          message: command.message,
          ...(command.payload !== undefined ? { payload: command.payload } : {}),
          timing: command.timing,
          origin: "agent-tool",
          status: "pending",
          createdByRunId: context.runId,
          createdAt,
          updatedAt: createdAt,
        });
      } else if (command.type === "schedule.update") {
        const current = records.get(command.activationId);
        if (current) records.set(command.activationId, {
          ...current,
          ...command.patch,
          status: "pending",
          updatedAt: new Date().toISOString(),
        });
      } else if (command.type === "schedule.cancel") {
        const current = records.get(command.activationId);
        if (current) records.set(command.activationId, {
          ...current,
          status: "cancelled",
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return [...records.values()];
  };
  return [
    {
      name: "glove_foundry_spawn",
      description:
        "Immediately invoke an agent. Use glove_foundry_schedule for future or recurring work.",
      inputSchema: z.object({
        definitionId: z.string().optional(),
        agentId: z.string().optional(),
        conversationId: z.string().optional(),
        message: z.string(),
        payload: z.unknown().optional(),
      }),
      async do(input) {
        return emit({
          id: commandId(),
          type: "spawn",
          definitionId: input.definitionId ?? context.definitionId,
          ...(input.agentId ? { agentId: input.agentId } : {}),
          ...(input.conversationId ? { conversationId: input.conversationId } : {}),
          workspaceId: context.workspaceId,
          message: input.message,
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
        });
      },
    },
    {
      name: "glove_foundry_schedule",
      description:
        "Create an ad hoc future or recurring activation. Agent-definition schedules are loaded separately through the lazy schedules resolver.",
      inputSchema: z.object({
        definitionId: z.string().optional(),
        agentId: z.string().optional(),
        conversationId: z.string().optional(),
        message: z.string(),
        payload: z.unknown().optional(),
        timing: timingInputSchema,
      }),
      async do(input) {
        return emit({
          id: commandId(),
          type: "schedule",
          definitionId: input.definitionId ?? context.definitionId,
          ...((input.agentId ?? (!input.definitionId ? context.agentId : undefined))
            ? { agentId: input.agentId ?? context.agentId }
            : {}),
          ...((input.conversationId ?? (!input.definitionId && !input.agentId ? context.conversationId : undefined))
            ? { conversationId: input.conversationId ?? context.conversationId }
            : {}),
          workspaceId: context.workspaceId,
          message: input.message,
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
          timing: normalizeScheduleTiming(input.timing as FoundryScheduleTimingInput),
        });
      },
    },
    {
      name: "glove_foundry_schedules",
      description:
        "List, update, or cancel scheduled triggers owned by this agent instance. Use the activation id returned by list.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("list"),
          status: z.enum(["active", "completed", "cancelled", "all"]).default("active"),
        }),
        z.object({
          action: z.literal("update"),
          activationId: z.string().min(1),
          message: z.string().min(1).optional(),
          payload: z.unknown().optional(),
          timing: timingInputSchema.optional(),
        }),
        z.object({ action: z.literal("cancel"), activationId: z.string().min(1) }),
      ]),
      async do(input) {
        if (input.action === "list") {
          const scheduled = scheduleView();
          const filter = input.status ?? "active";
          const filtered = filter === "all"
            ? scheduled
            : filter === "active"
              ? scheduled.filter((item) => item.status === "pending" || item.status === "active")
              : scheduled.filter((item) => item.status === filter);
          return { status: "success" as const, data: filtered };
        }
        if (!scheduleView().some((item) =>
          item.id === input.activationId && item.agentId === context.agentId && item.kind === "scheduled")) {
          return { status: "error" as const, data: null, message: `Schedule "${input.activationId}" is not owned by this agent instance.` };
        }
        if (input.action === "cancel") {
          return emit({
            id: commandId(), type: "schedule.cancel", activationId: input.activationId,
            definitionId: context.definitionId, agentId: context.agentId,
            conversationId: context.conversationId, workspaceId: context.workspaceId,
          });
        }
        const patch: { message?: string; payload?: unknown; timing?: FoundryScheduleTiming } = {};
        if (input.message !== undefined) patch.message = input.message;
        if (input.payload !== undefined) patch.payload = input.payload;
        if (input.timing !== undefined) patch.timing = normalizeScheduleTiming(input.timing as FoundryScheduleTimingInput);
        if (Object.keys(patch).length === 0) {
          return { status: "error" as const, data: null, message: "Provide message, payload, or timing to update." };
        }
        return emit({
          id: commandId(), type: "schedule.update", activationId: input.activationId, patch,
          definitionId: context.definitionId, agentId: context.agentId,
          conversationId: context.conversationId, workspaceId: context.workspaceId,
        });
      },
    },
    {
      name: "glove_foundry_sleep",
      description:
        "Suspend this logical run, then wake the same agent instance and conversation at a date or after a duration.",
      inputSchema: z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("until"),
          at: z.string().datetime(),
          message: z.string().default("Continue the suspended work."),
        }),
        z.object({
          kind: z.literal("for"),
          duration: durationSchema("How long this agent should sleep"),
          message: z.string().default("Continue the suspended work."),
        }),
      ]),
      async do(input) {
        return emit({
          id: commandId(),
          type: "sleep",
          definitionId: context.definitionId,
          agentId: context.agentId,
          conversationId: context.conversationId,
          workspaceId: context.workspaceId,
          wakeAt: input.kind === "until" ? input.at : afterDuration(input.duration),
          message: input.message,
        });
      },
    },
    {
      name: "glove_foundry_background",
      description:
        "Start work in the background and optionally reconvene its result into this conversation's shared inbox.",
      inputSchema: z.object({
        definitionId: z.string().optional(),
        message: z.string(),
        payload: z.unknown().optional(),
        reconvene: z.boolean().default(true),
      }),
      async do(input) {
        return emit({
          id: commandId(),
          type: "background",
          definitionId: input.definitionId ?? context.definitionId,
          agentId: context.agentId,
          conversationId: context.conversationId,
          workspaceId: context.workspaceId,
          message: input.message,
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
          reconvene: input.reconvene,
        });
      },
    },
    {
      name: "glove_foundry_transmit",
      description:
        "Deliver an outbound event through a route declared by this instance's playbook and authorized for this run.",
      inputSchema: z.object({
        routeId: z.string(),
        payload: z.unknown(),
      }),
      async do(input) {
        return emit({
          id: commandId(),
          type: "transmit",
          definitionId: context.definitionId,
          agentId: context.agentId,
          conversationId: context.conversationId,
          workspaceId: context.workspaceId,
          routeId: input.routeId,
          payload: input.payload,
        });
      },
    },
    {
      name: "glove_foundry_conversations",
      description: "List the conversations owned by this runtime agent instance.",
      inputSchema: z.object({}),
      async do() {
        return { status: "success" as const, data: await Effect.runPromise(context.data.listConversations(context.agentId)) };
      },
    },
    {
      name: "glove_foundry_workspace",
      description: "Read or write a value in the agent's shared workspace.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({ action: z.literal("get"), key: z.string() }),
        z.object({ action: z.literal("set"), key: z.string(), value: z.unknown() }),
        z.object({ action: z.literal("list") }),
      ]),
      async do(input) {
        if (input.action === "get") {
          return { status: "success" as const, data: await Effect.runPromise(context.data.getWorkspaceEntry(context.workspaceId, input.key)) };
        }
        if (input.action === "list") {
          return { status: "success" as const, data: await Effect.runPromise(context.data.listWorkspaceEntries(context.workspaceId)) };
        }
        await Effect.runPromise(context.data.putWorkspaceEntry({
          workspaceId: context.workspaceId,
          key: input.key,
          value: input.value,
          updatedAt: new Date().toISOString(),
        }));
        return { status: "success" as const, data: { key: input.key, saved: true } };
      },
    },
    {
      name: "glove_foundry_shared_inbox",
      description: "List shared workspace inbox items or post a new item for another agent/conversation.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({ action: z.literal("list") }),
        z.object({
          action: z.literal("post"), topic: z.string(), payload: z.unknown(),
          agentId: z.string().optional(), conversationId: z.string().optional(),
        }),
        z.object({
          action: z.literal("update"), itemId: z.string(),
          status: z.enum(["pending", "resolved", "dismissed"]),
        }),
      ]),
      async do(input) {
        if (input.action === "list") {
          return { status: "success" as const, data: await Effect.runPromise(context.data.listInboxItems(context.workspaceId)) };
        }
        if (input.action === "update") {
          const current = (await Effect.runPromise(context.data.listInboxItems(context.workspaceId)))
            .find((item) => item.id === input.itemId);
          if (!current) return { status: "error" as const, data: null, error: `Shared inbox item "${input.itemId}" was not found.` };
          const item = { ...current, status: input.status, updatedAt: new Date().toISOString() };
          await Effect.runPromise(context.data.putInboxItem(item));
          return { status: "success" as const, data: item };
        }
        const now = new Date().toISOString();
        const item = {
          id: foundryId("inbox"), workspaceId: context.workspaceId,
          agentId: input.agentId ?? context.agentId,
          conversationId: input.conversationId ?? context.conversationId,
          topic: input.topic, payload: input.payload, status: "pending" as const,
          createdAt: now, updatedAt: now,
        };
        await Effect.runPromise(context.data.putInboxItem(item));
        return { status: "success" as const, data: item };
      },
    },
    {
      name: "glove_foundry_tasks",
      description: "List shared workspace tasks or create a task scoped to this agent conversation.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({ action: z.literal("list") }),
        z.object({ action: z.literal("create"), title: z.string(), detail: z.string().optional() }),
        z.object({
          action: z.literal("update"), taskId: z.string(),
          status: z.enum(["open", "in-progress", "completed", "cancelled"]),
        }),
      ]),
      async do(input) {
        if (input.action === "list") {
          return { status: "success" as const, data: await Effect.runPromise(context.data.listTasks(context.workspaceId)) };
        }
        if (input.action === "update") {
          const current = (await Effect.runPromise(context.data.listTasks(context.workspaceId)))
            .find((task) => task.id === input.taskId);
          if (!current) return { status: "error" as const, data: null, error: `Task "${input.taskId}" was not found.` };
          const task = { ...current, status: input.status, updatedAt: new Date().toISOString() };
          await Effect.runPromise(context.data.putTask(task));
          return { status: "success" as const, data: task };
        }
        const now = new Date().toISOString();
        const task = {
          id: foundryId("task"), workspaceId: context.workspaceId,
          agentId: context.agentId, conversationId: context.conversationId,
          title: input.title, ...(input.detail ? { detail: input.detail } : {}),
          status: "open" as const, createdAt: now, updatedAt: now,
        };
        await Effect.runPromise(context.data.putTask(task));
        return { status: "success" as const, data: task };
      },
    },
    {
      name: "glove_foundry_environment",
      description: "List non-secret environment metadata visible to this workspace, agent, and conversation.",
      inputSchema: z.object({}),
      async do() {
        return {
          status: "success" as const,
          data: await Effect.runPromise(context.data.listEnvironment({
            workspaceId: context.workspaceId,
            agentId: context.agentId,
            conversationId: context.conversationId,
          })),
        };
      },
    },
  ];
}
