import { MemoryStore, type Message } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import {
  defineAgent,
  defineCall,
  defineSubagent,
  composePlaybook,
} from "glove-foundry";
import { z } from "zod";
import { FoundryDemoModel } from "../../lib/demo-model.js";
import { releasePlannerComponents } from "./composition.js";
import releaseContext from "./memory/release-context.memory.js";
import { loadOperationsInbox } from "./inboxes/operations.inbox.js";
import requestContext from "./layers/request-context.layer.js";
import runAudit from "./subscribers/run-audit.subscriber.js";
import releaseReadiness from "./schedules/release-readiness.js";
import releaseNotes from "./apps/release-notes.app.js";
import respond from "./actions/respond.action.js";
import messageReceived from "./events/message-received.event.js";
import messageReply from "./events/message-reply.event.js";
import messageIncludes from "./predicates/message-includes.predicate.js";
import { supportAccount, supportInbound, supportOutbound } from "./topology.js";
import supportTransmission from "./transmissions/support.transmission.js";
import { releaseRepl, releaseWorkspace } from "./workbench.js";

const inputSchema = z.object({
  objective: z.string().min(1).describe("The outcome the plan must achieve"),
  constraints: z
    .array(z.string())
    .default([])
    .describe("Requirements the plan must preserve"),
});

function releaseInput(
  request: { readonly payload?: unknown },
  message: Message,
) {
  const parsed = inputSchema.safeParse(request.payload);
  return parsed.success
    ? parsed.data
    : { objective: message.text, constraints: ["Follow the serialized transmission directives"] };
}

function buildModel() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const forceDemo = process.env.FOUNDRY_FORCE_DEMO === "1";
  if (!apiKey || forceDemo) return new FoundryDemoModel();
  return createAdapter({
    provider: "openrouter",
    model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
    stream: true,
  });
}

export default defineAgent({
  description: "Turns a Foundry objective into a practical release plan",
  tags: ["planning", "foundry", "openrouter"],
  components: releasePlannerComponents,
  memory: [releaseContext],
  inboxes: (_agent, context) => loadOperationsInbox(context),
  schedules: async (_agent, { agentInstance }) =>
    agentInstance.context.disableReleaseReadiness === true ? [] : [releaseReadiness],
  playbooks: (_agent, { agentInstance, message }) => [composePlaybook({
    name: "support-release-planning",
    transmission: supportTransmission,
    match: {
      event: messageReceived,
      routes: [supportInbound],
      predicate: { definition: messageIncludes, parameters: { text: "release" } },
    },
    directives: [{
      action: respond,
      instruction: "Answer the support request using the current release plan and preserve its external thread.",
      parameters: {
        tone: agentInstance.context.role === "release-coordinator" ? "concise" : "helpful",
        includeTiming: message.text.length > 0,
      },
    }],
    applications: [releaseNotes],
    outbound: [{
      route: supportOutbound,
      application: releaseNotes,
      account: supportAccount,
      applicationAccount: supportAccount,
      event: messageReply,
      instruction: "Deliver the approved response back to the originating support thread.",
    }],
    serialization: { payload: "json", envelope: "xml" },
  })],
  workingEnvironment: releaseWorkspace,
  repl: (_agent, { agentId, request, message }) => {
    const input = releaseInput(request, message);
    return releaseRepl(agentId, input.constraints);
  },
  store: ({ conversationId }) => new MemoryStore(`foundry-example:${conversationId}`),
  model: (_agent, { request, message }) => {
    releaseInput(request, message);
    return buildModel();
  },
  systemPrompt: (_agent, { request, message, history, installations }) => {
    const input = releaseInput(request, message);
    const attachments =
      message.content?.filter((part) => part.type !== "text").length ?? 0;

    return [
      "You are a release-planning agent running in Glove Foundry.",
      `Objective: ${input.objective}`,
      `Current turn has ${attachments} attachment(s); conversation history has ${history.length} message(s).`,
      `Installed application surfaces: ${installations.map((item) => `${item.kind}:${item.id}`).join(", ") || "none"}.`,
      "Delegate focused review work to @release-reviewer when useful.",
      "Return a concise plan with verification and observability steps.",
    ].join("\n");
  },
  compactionLimit: (_agent, { request, message }) =>
    releaseInput(request, message).constraints.length > 5 ? 80_000 : 40_000,
  compactionInstructions: () =>
    "Preserve the objective, constraints, decisions, and verification results.",
  tools: (_agent, { request, message }) => {
    const input = releaseInput(request, message);
    const attachments = message.content?.filter((part) => part.type !== "text") ?? [];
    return [
      {
        name: "inspect_foundry_capabilities",
        description:
          "Inspect the concrete capabilities available in this Foundry example before planning.",
        inputSchema: z.object({}),
        async do() {
          return {
            status: "success" as const,
            data: {
              routing: "agents/<route>/agent.ts",
              validation: "Fixed Foundry envelopes with local payload validation",
              execution: "Isolated Foundry execution",
              observability:
                "Correlated run, model, tool, extension, layer, and log events",
              transport: "HTTP requests plus Server-Sent Events",
              client: "Generated definition routes plus a fixed request/result contract",
            },
          };
        },
      },
      ...(input.constraints.length > 0
        ? [
            {
              name: "list_release_constraints",
              description: "Return the constraints supplied for this release.",
              inputSchema: z.object({}),
              async do() {
                return { status: "success" as const, data: input.constraints };
              },
            },
          ]
        : []),
      ...(attachments.length > 0
        ? [{
            name: "inspect_release_attachments",
            description:
              "Describe the attachment types supplied with this release request.",
            inputSchema: z.object({}),
            async do() {
              return {
                status: "success" as const,
                data: attachments.map((part) => ({
                  type: part.type,
                  mediaType: part.source?.media_type,
                })),
              };
            },
          }]
        : []),
    ];
  },
  calls: (_agent, { request, message }) => {
    const input = releaseInput(request, message);
    return [
    defineCall({
      name: "release_scope",
      description: "Return a typed summary of the current release scope.",
      input: z.object({ includeConstraints: z.boolean().default(true) }),
      output: z.object({ objective: z.string(), constraints: z.array(z.string()) }),
      handler: ({ includeConstraints }) => ({
        objective: input.objective,
        constraints: includeConstraints ? input.constraints : [],
      }),
    }),
    ];
  },
  skills: [
    {
      name: "release-checklist",
      description: "Inject the standard release verification checklist",
      exposeToAgent: true,
      async handler() {
        return "Verify types, tests, runtime behavior, traces, and rollback.";
      },
    },
  ],
  subagents: (_agent, { request, message }) => {
    const input = releaseInput(request, message);
    return [
    defineSubagent({
      name: "release-reviewer",
      description: "Review a proposed release plan for missing risks",
      systemPrompt: `Review release objective: ${input.objective}. Return only concrete missing risks and checks.`,
      tools: [],
    }),
    ];
  },
  layers: [requestContext],
  subscribers: [runAudit],
});
