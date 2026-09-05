import type { IGloveRunnable, InboxItem, ToolResultData } from "glove-core";
import { Effect } from "effect";
import {
  defineAgent,
  defineCall,
  defineSubagent,
  installedApplicationTransmissionToolName,
} from "glove-foundry";
import { mountImage } from "glove-image";
import { z } from "zod";
import { createHermesAccountSessions } from "../../lib/account-sessions.js";
import { hermesContext, VerificationPayloadSchema } from "../../lib/context.js";
import {
  hermesImageAssets,
  hermesImageLibrary,
  hermesImageModel,
} from "../../lib/media.js";
import { HermesWorkerModel, hermesTextModel } from "../../lib/model.js";
import mediaStudio, { mediaStudioConfigSchema } from "./apps/media-studio.app.js";
import messaging from "./apps/messaging.app.js";
import { messagingPlaybooks } from "./apps/messaging/policy.js";
import chat from "./apps/messaging/transmissions/chat.transmission.js";
import { hermesComponents } from "./composition.js";
import executionContext from "./layers/execution-context.layer.js";
import personal from "./memory/personal.memory.js";
import dailyReview from "./schedules/daily-review.js";
import { planningSkill, researchSkill } from "./skills.js";
import trace from "./subscribers/trace.subscriber.js";
import { chatInbound, chatOutbound, operatorAccount } from "./topology.js";
import { hermesRepl, hermesWorkspace } from "./workbench.js";

function hasInstallation(context: Parameters<typeof hermesContext>[0], capability: { readonly id: string }) {
  return context.installations.some((installation) => installation.id === capability.id);
}

function findTool(agent: IGloveRunnable, name: string) {
  const tool = agent.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Expected mounted tool "${name}".`);
  return tool;
}

async function invokeTool(
  agent: IGloveRunnable,
  name: string,
  input: unknown,
  signal: AbortSignal,
): Promise<ToolResultData> {
  return findTool(agent, name).run(input, undefined, signal);
}

function outboundText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text;
  }
  return JSON.stringify(value);
}

async function deliverInboundReply(
  agent: IGloveRunnable,
  context: Parameters<NonNullable<Parameters<typeof defineAgent>[0]["run"]>>[1],
  value: unknown,
): Promise<void> {
  if (
    context.request.source?.kind !== "transmission" ||
    context.request.source.id !== chatInbound.id ||
    !context.request.source.threadKey
  ) return;
  const toolName = installedApplicationTransmissionToolName(messaging, chat);
  const messages = await agent.store.getMessages();
  const alreadySent = messages
    .slice(context.history.length)
    .some((message) => message.tool_calls?.some((call) => call.tool_name === toolName));
  if (alreadySent) return;
  const delivered = await invokeTool(agent, toolName, {
    routeId: chatOutbound.id,
    payload: {
      thread: context.request.source.threadKey,
      text: outboundText(value),
    },
  }, context.signal);
  if (delivered.status === "error") {
    throw new Error(delivered.message ?? "Hermes could not deliver its inbound reply.");
  }
}

const hermes = defineAgent({
  description: "A self-improving personal agent assembled end to end with Glove Foundry",
  tags: ["hermes", "personal-agent", "memory", "workspace", "media", "delegation"],
  components: hermesComponents,
  accountSessions: createHermesAccountSessions(operatorAccount),
  model: () => hermesTextModel(),
  systemPrompt: (_agent, context) => {
    const config = hermesContext(context);
    const installed = context.installations.map((installation) => `${installation.kind}:${installation.id}`);
    return [
      `You are ${config.displayName}, a ${config.personality} personal agent for ${config.ownerName}.`,
      "Infer the workflow from the user's outcome. Do not force work into a fixed graph.",
      "Use the persistent working environment for files, calculations, and deliverables; keep large data out of conversation context.",
      "Use memory deliberately: curate stable preferences, people, projects, lessons, and reusable procedures.",
      "Delegate bounded research or review when isolated reasoning will help. Preserve the final synthesis in the parent conversation.",
      "Use scheduling, sleep, background work, shared inbox, tasks, and conversations through the framework-owned glove_foundry_* tools.",
      "Treat outbound transmission and media generation as effects. Confirm the target and intent before consequential actions.",
      `Installed instance surfaces: ${installed.join(", ") || "none"}.`,
      `Current source: ${context.request.source?.kind ?? "direct"}; prior messages: ${context.history.length}.`,
    ].join("\n");
  },
  maxRetries: 3,
  maxConsecutiveErrors: 4,
  maxTurns: (_agent, context) => hermesContext(context).maxTurns,
  compactionLimit: (_agent, context) => context.history.length > 30 ? 80_000 : 48_000,
  compactionInstructions: () =>
    "Preserve user preferences, commitments, decisions, active tasks, schedule ids, workspace paths, source links, and unresolved questions.",
  memory: () => [personal],
  inboxes: async (_agent, context): Promise<ReadonlyArray<InboxItem>> => {
    const items = await Effect.runPromise(context.data.listInboxItems(context.workspaceId));
    return items
      .filter((item) => item.status === "pending")
      .filter((item) => !item.agentId || item.agentId === context.agentId)
      .filter((item) => !item.conversationId || item.conversationId === context.conversationId)
      .map((item) => ({
        id: item.id,
        tag: `foundry:${item.topic}`,
        request: typeof item.payload === "string" ? item.payload : JSON.stringify(item.payload),
        response: null,
        status: "pending" as const,
        blocking: false,
        created_at: item.createdAt,
        resolved_at: null,
      }));
  },
  skills: (_agent, context) => {
    const enabled = new Set(hermesContext(context).enabledSkills);
    const researchRelevant = /research|compare|investigate|source/i.test(context.messageText);
    return [
      ...(enabled.has("planning") ? [planningSkill] : []),
      ...(enabled.has("research") && researchRelevant ? [researchSkill] : []),
    ];
  },
  subagents: (_agent, context) => {
    const request = context.messageText;
    const researchRelevant = /research|delegate|investigate|compare|@researcher/i.test(request);
    const reviewRelevant = /review|critique|check|verify|@reviewer/i.test(request);
    return [
      ...(researchRelevant ? [defineSubagent({
        name: "researcher",
        description: "Investigate one bounded question in isolated context",
        durable: true,
        model: new HermesWorkerModel("researcher"),
        systemPrompt: "Investigate the supplied question. Return evidence, uncertainty, and a concise conclusion.",
        tools: [],
      })] : []),
      ...(reviewRelevant ? [defineSubagent({
        name: "reviewer",
        description: "Critique a proposed result for correctness and omissions",
        model: new HermesWorkerModel("reviewer"),
        systemPrompt: "Review the supplied result. Return only concrete defects, risks, and improvements.",
        tools: [],
      })] : []),
    ];
  },
  schedules: (_agent, context) => hermesContext(context).enableDailyReview ? [dailyReview] : [],
  playbooks: (_agent, context) => {
    if (!hasInstallation(context, messaging)) return [];
    return messagingPlaybooks(hermesContext(context).displayName);
  },
  workingEnvironment: hermesWorkspace,
  repl: (_agent, context) => hermesRepl(context.agentId, context.workspaceId, context.messageText),
  layers: [executionContext],
  subscribers: [trace],
  calls: (_agent, context) => [
    defineCall({
      name: "hermes_capabilities",
      description: "Return a typed inventory of the current Hermes assembly",
      input: z.object({}),
      output: z.object({
        definitionId: z.string(),
        agentId: z.string(),
        conversationId: z.string(),
        workspaceId: z.string(),
        installations: z.array(z.object({ kind: z.enum(["tool", "application", "mcp"]), id: z.string() })),
        message: z.string(),
      }),
      handler: () => ({
        definitionId: context.definitionId,
        agentId: context.agentId,
        conversationId: context.conversationId,
        workspaceId: context.workspaceId,
        installations: context.installations.map(({ kind, id }) => ({ kind, id })),
        message: context.messageText,
      }),
    }),
  ],
  configure: async (agent, context) => {
    const installation = context.installations.find((item) => item.id === mediaStudio.id);
    if (!installation) return;
    const media = mediaStudioConfigSchema.parse(installation.config ?? {});
    const imageModel = hermesImageModel(media.provider);
    await mountImage(agent, {
      adapter: imageModel,
      assets: hermesImageAssets,
      library: hermesImageLibrary,
      candidates: media.candidates,
      curate: true,
      requirePermission: false,
      onUsage: (source, usage) => context.emit({ type: "hermes.media.usage", data: { source, usage } }),
    });
    context.emit({
      type: "hermes.media.mounted",
      data: { provider: media.provider, adapter: imageModel.name },
    });
  },
  run: async (agent, context) => {
    const parsed = VerificationPayloadSchema.safeParse(context.request.payload);
    if (!parsed.success) {
      const value = await context.defaultRun();
      await deliverInboundReply(agent, context, value);
      return value;
    }
    return Effect.runPromise(Effect.tryPromise({
      try: async () => {
        if (parsed.data.mode === "verify-workspace") {
          if (!context.vfs) throw new Error("Hermes working environment was not mounted.");
          const path = "/out/foundry-hermes-verification.md";
          const body = [
            "# Foundry Hermes verification",
            "",
            `Agent: ${context.agentId}`,
            `Conversation: ${context.conversationId}`,
            "The persistent sandboxed workspace is writable.",
          ].join("\n");
          await context.vfs.writeFile(path, body);
          const schedule = await invokeTool(agent, "glove_foundry_schedule", {
            message: "Revisit the Foundry Hermes verification.",
            timing: { kind: "after", duration: "1d" },
          }, context.signal);
          return {
            check: "passed",
            capabilities: await context.invoke("hermes_capabilities", {}),
            workspace: { path, content: await context.vfs.readFile(path) },
            schedule,
            mountedTools: agent.tools.map((tool) => tool.name).sort(),
          };
        }
        if (parsed.data.mode === "cancel-schedule") {
          return invokeTool(agent, "glove_foundry_schedules", {
            action: "cancel",
            activationId: parsed.data.activationId,
          }, context.signal);
        }
        return invokeTool(agent, "glove_foundry_sleep", {
          kind: "for",
          duration: "500ms",
          message: "Wake and finish the suspended Foundry Hermes check.",
        }, context.signal);
      },
      catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
    }));
  },
});

export default hermes;
