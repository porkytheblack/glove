import assert from "node:assert/strict";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { FoundryRuntime } from "glove-foundry";
import { toGloveMessage, type AgentAssemblyContext, type FoundryRequest } from "glove-foundry";
import { isS2SDrivenModel } from "glove-voice-s2s";
import { Effect } from "effect";
import briefingLine from "../agents/briefing-line/agent.js";
import { briefingTools } from "../agents/briefing-line/briefing.tools.js";
import { readBriefingSnapshot, recordVoiceDirection } from "../agents/briefing-line/briefing-workspace.js";
import lead from "../agents/lead/agent.js";
import application from "../foundry.application.js";
import config from "../foundry.config.js";
import { knowledgeWorkSkills, loadSkillSet, skillAdapter } from "../lib/skill-source.js";
import { normalizeCampaignBatch, planCampaignWaves } from "../lib/campaigns.js";
import { fileProviderGate, isRetryableProviderError, providerErrorStatus, providerRetryDelayMs } from "../lib/provider-pressure.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = await FoundryRuntime.discover({ rootDir: root, agentsDir: resolve(root, "agents"), application, config });
assert.deepEqual(runtime.manifest.agents.map((agent) => agent.id), ["briefing-line", "campaign-orchestrator", "critic", "lead", "maker", "scout", "strategist"]);
assert.equal(typeof lead.model, "function");
assert.equal(typeof lead.systemPrompt, "function");
assert.equal(typeof lead.run, "function");

let calls = 0;
const source = knowledgeWorkSkills({
  fetch: async (input) => {
    calls++;
    if (String(input).includes("git/trees")) {
      return new Response(JSON.stringify({ tree: [{ path: "marketing/skills/brand-voice/SKILL.md", type: "blob" }] }), { status: 200 });
    }
    return new Response("---\nname: brand-voice\ndescription: Keep the brand voice coherent.\n---\n# Brand voice\nUse a documented voice.", { status: 200 });
  },
});
const skills = await loadSkillSet(["marketing", "../../etc"], { source });
assert.equal(calls, 2);
assert.equal(skills.some((skill) => skill.name === "knowledge-marketing-brand-voice"), true);
assert.equal(skillAdapter(skills).skills?.length, skills.length);

const instances = await runtime.listAgentInstances("lead");
assert.equal(instances.some((instance) => instance.id === "braind-storm-lead"), true);
const conversations = await runtime.listConversations("braind-storm-lead");
assert.equal(conversations.some((conversation) => conversation.id === "braind-storm-lead-room"), true);

const briefingInstances = await runtime.listAgentInstances("briefing-line");
assert.equal(briefingInstances.some((instance) => instance.id === "braind-storm-briefing-line"), true);
const briefingConversations = await runtime.listConversations("braind-storm-briefing-line");
assert.equal(briefingConversations.some((conversation) => conversation.id === "braind-storm-briefing-line-room"), true);

const request: FoundryRequest = {
  agentId: "braind-storm-briefing-line",
  conversationId: "braind-storm-briefing-line-room",
  workspaceId: "braind-storm",
  message: "Open Mara's live briefing line.",
  payload: { port: 4761, token: "a".repeat(24), stormId: "Verify Voice / Unsafe" },
};
const message = toGloveMessage(request.message);
const context = {
  definitionId: "briefing-line",
  agentId: request.agentId,
  conversationId: request.conversationId,
  workspaceId: request.workspaceId,
  name: "glove_foundry_agent__briefing-line",
  runId: "verify-call-run",
  mode: "agent",
  request,
  input: request,
  message,
  messageInput: request.message,
  messageText: message.text,
  history: [],
  messages: [message],
  installations: [],
  agentInstance: { context: {}, installations: [] },
  conversation: {},
  data: {},
  store: null,
  subscriber: {},
  controls: { signal: new AbortController().signal, commands: [], emit() {} },
} as unknown as AgentAssemblyContext<FoundryRequest>;

async function settle<T>(value: T | Promise<T> | Effect.Effect<T, unknown, never>): Promise<T> {
  const awaited = await value;
  return Effect.isEffect(awaited) ? Effect.runPromise(awaited) : awaited;
}

assert.equal(typeof briefingLine.model, "function");
const modelResolver = briefingLine.model;
if (typeof modelResolver !== "function") throw new Error("Briefing line model must be lazy.");
const voiceModel = await settle(modelResolver(briefingLine, context));
assert.ok(isS2SDrivenModel(voiceModel));
assert.equal(voiceModel.s2s.provider, "gemini");

assert.equal(typeof briefingLine.tools, "function");
const toolResolver = briefingLine.tools;
if (typeof toolResolver !== "function") throw new Error("Briefing line tools must be lazy.");
const tools = await settle(toolResolver(briefingLine, context));
assert.deepEqual(tools.map((tool) => tool.name), ["get_storm_briefing", "record_direction", "launch_campaign_workforce"]);

const dependencyBatch = normalizeCampaignBatch({
  batchId: "verify-waves",
  parentStormId: "Verify Voice / Unsafe",
  execution: "auto",
  skillPacks: ["marketing"],
  generateImage: false,
  remoteSkills: false,
  campaigns: [
    { id: "launch", name: "Launch", brief: "Develop the launch campaign for working architects.", dependsOn: [] },
    { id: "retention", name: "Retention", brief: "Develop the retained-use campaign after launch.", dependsOn: ["launch"] },
    { id: "partners", name: "Partners", brief: "Develop an independent partner campaign for studios.", dependsOn: [] },
  ],
});
const dependencyPlan = planCampaignWaves(dependencyBatch);
assert.equal(dependencyPlan.resolvedExecution, "dependency-waves");
assert.deepEqual(dependencyPlan.waves.map((wave) => wave.map((campaign) => campaign.id)), [["launch", "partners"], ["retention"]]);

let launchedCampaigns = 0;
const launchTool = briefingTools("Verify Voice / Unsafe", {
  async launch(input) {
    launchedCampaigns = input.campaigns.length;
    return { accepted: true, batchId: "verify-batch", batchRunId: "verify-run", campaignCount: input.campaigns.length, execution: input.execution, message: "queued" };
  },
}).find((tool) => tool.name === "launch_campaign_workforce");
assert.ok(launchTool);
const launchResult = await launchTool.do({
  campaigns: [{ id: "launch", name: "Launch", brief: "Develop the launch campaign for working architects.", dependsOn: [] }],
  execution: "parallel",
  skillPacks: ["marketing"],
  generateImage: false,
}, undefined as never, undefined as never);
assert.equal(launchResult.status, "success");
assert.equal(launchedCampaigns, 1);

const quotaError = Object.assign(new Error("429 status code (no body)"), { status: 429 });
assert.equal(providerErrorStatus(quotaError), 429);
assert.equal(isRetryableProviderError(quotaError), true);
const firstQuotaDelay = providerRetryDelayMs(quotaError, 1);
assert.ok(firstQuotaDelay >= 15_000 && firstQuotaDelay < 16_500);

const gatePath = resolve(root, ".braind-storm", "verify-provider-gate.lock");
await rm(gatePath, { recursive: true, force: true });
const gates = [0, 1].map((index) => fileProviderGate({ name: `verify-${index}`, lockPath: gatePath, minimumIntervalMs: 0, pollMs: 20 }));
let activeProviderCalls = 0;
let maximumProviderCalls = 0;
await Promise.all(gates.map((gate) => gate.run(async () => {
  activeProviderCalls++;
  maximumProviderCalls = Math.max(maximumProviderCalls, activeProviderCalls);
  await new Promise((resolve) => setTimeout(resolve, 35));
  activeProviderCalls--;
})));
await rm(gatePath, { recursive: true, force: true });
assert.equal(maximumProviderCalls, 1);

const recorded = await recordVoiceDirection({
  stormId: "Verify Voice / Unsafe",
  direction: "Keep the launch grounded in working architects, not speculative AI language.",
  priority: "important",
  appliesTo: "positioning",
});
assert.equal(recorded.stormId, "verify-voice-unsafe");
assert.match(recorded.path, /^\/inbox\/voice\/.+\.md$/);
const snapshot = await readBriefingSnapshot("Verify Voice / Unsafe", "headline");
assert.equal(snapshot.state, "empty");
assert.equal(snapshot.recordedDirections.some((item) => item.includes("working architects")), true);

process.stdout.write("Braind Storm offline verification passed.\n");
process.stdout.write("Verified seven file-routed definitions, lazy lead and Gemini Live assembly, durable voice direction, dependency-aware campaign waves, call-triggered launches, cross-process provider admission, quota-aware retry timing, seeded conversations, and adapter-backed skill loading.\n");
