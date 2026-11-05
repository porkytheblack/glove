/**
 * A Foundry controller for voice event tests, in its own process group so a
 * test can SIGKILL it with its daemon and runs. Commands arrive over IPC;
 * each gets `{ id, value }` or `{ id, error }` back.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import application from "./foundry.application.js";
import { discoverAgents } from "../../../src/discovery.js";
import { FoundryRuntime } from "../../../src/runtime.js";

const here = dirname(fileURLToPath(import.meta.url));
const agents = await discoverAgents({ agentsDir: resolve(here, "agents") });
const runtime = new FoundryRuntime({
  rootDir: resolve(here, ".."),
  agents,
  application,
  applicationFilePath: resolve(here, "foundry.application.ts"),
  config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10, maxConcurrent: 4 } },
});
await runtime.start();

type Command =
  | { method: "setup"; definitionId: string; agentId: string; conversationId: string }
  | { method: "request"; route: string; request: Parameters<FoundryRuntime["request"]>[1] }
  | { method: "event"; target: { agentId: string; conversationId: string }; event: Parameters<FoundryRuntime["emitEvent"]>[1]; policy?: Parameters<FoundryRuntime["emitEvent"]>[2] }
  | { method: "wait"; runId: string }
  | { method: "stop" };

process.on("message", (message: { id: number; command: Command }) => {
  void (async () => {
    const { command } = message;
    switch (command.method) {
      case "setup": {
        const agent = (await Effect.runPromise(application.data!.getAgent(command.agentId)))
          ?? await runtime.createAgent(command.definitionId, { id: command.agentId, workspaceId: "voice-events" });
        const conversations = await runtime.listConversations(agent.id);
        if (!conversations.some((item) => item.id === command.conversationId)) {
          await runtime.createConversation(agent.id, { id: command.conversationId });
        }
        return null;
      }
      case "request": return (await runtime.request(command.route, command.request)).id;
      case "event": return runtime.emitEvent(command.target, command.event, command.policy ?? {});
      case "wait": return (await runtime.waitForRun(command.runId, { pollMs: 20, timeoutMs: 60_000 }))?.status ?? null;
      case "stop": await runtime.stop(); setTimeout(() => process.exit(0), 50); return null;
    }
  })().then(
    (value) => process.send?.({ id: message.id, value }),
    (cause: unknown) => process.send?.({ id: message.id, error: cause instanceof Error ? cause.message : String(cause) }),
  );
});
process.send?.({ started: true });
