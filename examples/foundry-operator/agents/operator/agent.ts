import type { FoundryStationConnection } from "glove-foundry/station";
import { SYSTEM_PROMPT, COMPACTION_PROMPT } from "./prompts.js";
import { operatorComponents } from "./composition.js";
import operatorMemory from "./memory/operator.memory.js";
import { rememberActivation, continuityContext, memoryJournal } from "../../lib/continuity.js";
import { defineAgent } from "glove-foundry";
import { createAdapter } from "glove-core/models/providers";
import { mountBrowser, mountSandbox } from "glove-execution";
import { stationBrowserClient, stationSandbox } from "glove-execution/station";
import { StationClient } from "station-client";
import { readGrants, readState, writeState } from "../../lib/state.js";
import { secret, modelName } from "../../lib/settings.js";

export default defineAgent({
  description: "A general-purpose assistant that browses, researches, writes code and runs sandbox servers",
  model: () => createAdapter({ provider: "openrouter", apiKey: secret("OPENROUTER_API_KEY"), model: modelName, stream: true, maxTokens: 6000 }),
  run: async (_agent, context) => {
    await rememberActivation(context);
    return context.defaultRun();
  },
  components: operatorComponents,
  memory: [operatorMemory],
  contextProviders: (_agent, context) => [() => continuityContext(context)],
  subscribers: (_agent, context) => [memoryJournal(context)],
  maxTurns: 30,
  compactionLimit: 120000,
  compactionInstructions: COMPACTION_PROMPT,
  maxRetries: 0,
  systemPrompt: SYSTEM_PROMPT,
  async configure(agent, context) {
    const connection = await readState<FoundryStationConnection | null>("worker-client.json", null);
    if (!connection) throw new Error("Start Operator with pnpm start before running its agent.");
    const grants = await readGrants();
    const browserAdapter = stationBrowserClient({ baseUrl: connection.url, stationId: connection.stationId, apiKey: connection.token, access: "operator", timeoutMs: 60000 }, {
      sessionIds: grants.browserIds, profileIds: ["personal"], maxSessions: 2, allowEvaluate: true, cleanup: "retain",
    });
    let closeBrowser = () => browserAdapter.close();
    context.onCleanup(async () => {
      try { await closeBrowser(); }
      finally { await writeState("grants.json", { ...await readGrants(), browserIds: browserAdapter.resourceIds() }); }
    });
    const browser = mountBrowser(agent, { adapter: browserAdapter });
    closeBrowser = () => browser.close();
    const sandboxAdapter = await stationSandbox({ client: new StationClient({ url: connection.url, token: connection.token }), stationId: connection.stationId, sandboxIds: grants.sandboxIds, maxSandboxes: 2, cleanup: "retain" });
    let closeSandbox = () => sandboxAdapter.close();
    context.onCleanup(async () => {
      try { await closeSandbox(); }
      finally { await writeState("grants.json", { ...await readGrants(), sandboxIds: sandboxAdapter.resourceIds() }); }
    });
    const sandbox = mountSandbox(agent, { adapter: sandboxAdapter });
    closeSandbox = () => sandbox.close();
  },
});
