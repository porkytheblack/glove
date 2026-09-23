import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FoundryRuntime, FoundryServer } from "glove-foundry";
import application from "../foundry.application.js";
import config from "../foundry.config.js";
import { connectResources, type Resources } from "../lib/resource-client.js";
import { previewServer } from "../lib/preview.js";
import { allowedRequest, jsonBody, json } from "../lib/http.js";
import { root, port, prepareState, agentId, conversationId, modelName, secret } from "../lib/settings.js";
import { writeState } from "../lib/state.js";
import { ConversationStore } from "../lib/store.js";

prepareState();
secret("OPENROUTER_API_KEY"); secret("STEEL_API_KEY");
let resources: Resources | undefined, runtime: FoundryRuntime | undefined, inspector: FoundryServer | undefined;
let consoleServer: Server | undefined, preview: Server | undefined;
let working = false, activeRun: string | undefined, stopping = false;
const active = new Set(["pending", "running", "retrying"]);
async function stop() {
  if (stopping) return; stopping = true;
  consoleServer?.closeAllConnections(); preview?.closeAllConnections();
  await Promise.allSettled([consoleServer && new Promise<void>(resolve => consoleServer!.close(() => resolve())), preview && new Promise<void>(resolve => preview!.close(() => resolve()))]);
  if (runtime) await runtime.stop();
  if (inspector) await inspector.close();
}
process.once("SIGINT", () => { void stop().finally(() => process.exit()); });
process.once("SIGTERM", () => { void stop().finally(() => process.exit()); });
async function listen(server: Server, value: number) {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(value, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
}
try {
  runtime = await FoundryRuntime.discover({ rootDir: root, agentsDir: join(root, "agents"), application, applicationFilePath: join(root, "foundry.application.ts"), config });
  const foundry = runtime;
  await foundry.start();
  resources = await connectResources();
  const world = resources;
  if (!(await foundry.listAgentInstances("operator")).some(agent => agent.id === agentId)) await foundry.createAgent("operator", { id: agentId, workspaceId: "personal" });
  if (!(await foundry.listConversations(agentId)).some(conversation => conversation.id === conversationId)) await foundry.createConversation(agentId, { id: conversationId, title: "Operator" });
  inspector = new FoundryServer(foundry, { host: "127.0.0.1", port: port + 2 });
  await inspector.listen();
  preview = previewServer(world); await listen(preview, port + 3);
  consoleServer = createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("content-security-policy", `default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; frame-src http://127.0.0.1:${port + 3}; frame-ancestors 'none'`);
    if (!allowedRequest(request, port)) { json(response, { error: "This console accepts local same-origin requests only." }, 403); return; }
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    try {
      if (request.method === "GET" && ["/", "/app.js", "/style.css"].includes(url.pathname)) {
        const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        response.setHeader("content-type", name.endsWith("html") ? "text/html" : name.endsWith("js") ? "text/javascript" : "text/css");
        response.end(await readFile(join(root, "web", name))); return;
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        const run = activeRun ? await foundry.getRun(activeRun) : null;
        const running = run && active.has(run.status);
        if (working && activeRun && !running) working = false;
        if (!working) await world.reapExpired();
        const boxes = await world.sandbox.list();
        const services = boxes[0] ? await world.sandbox.services(boxes[0].id) : [];
        const messages = (await (await ConversationStore.open(conversationId)).getMessages())
          .filter(message => ["user", "agent"].includes(message.sender) && message.text && !message.framework_context && !message.tool_results?.length && !message.is_compaction)
          .map(message => ({ role: message.sender === "user" ? "user" : "assistant", text: message.text })).slice(-40);
        const trace = run ? foundry.observability.list({ runId: run.id, limit: 80 }).filter(event => event.category === "tool" || event.category === "run").map(event => {
          const data = event.data as Record<string, unknown> | null;
          return { type: event.type, name: data?.name ?? data?.tool_name ?? "", at: event.timestamp };
        }) : [];
        json(response, { working, model: modelName, run: run ? { id: run.id, conversationId: run.conversationId, status: run.status, output: run.output, error: run.error ? "This run failed. Inspect the local Foundry trace for details." : undefined } : null, messages, trace, browsers: await world.browser.list(), sandboxes: boxes, services, previewUrl: `http://127.0.0.1:${port + 3}`, inspectorUrl: `http://127.0.0.1:${port + 2}` }); return;
      }
      if (request.method === "POST" && ["/api/message", "/api/verify"].includes(url.pathname)) {
        const body = await jsonBody(request);
        if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 16000) { json(response, { error: "Enter a direction up to 16,000 characters." }, 400); return; }
        if (working) { json(response, { error: "Wait for the current run or stop it first." }, 409); return; }
        working = true; activeRun = undefined;
        try {
          if ((await foundry.listRuns()).some(run => active.has(run.status))) { json(response, { error: "A run is active in Foundry. Wait or stop it in the inspector." }, 409); working = false; return; }
          // This console owns every resource on its private worker. Reconcile IDs
          // before each run, including resources left by an interrupted process.
          await world.reapExpired();
          await writeState("grants.json", { browserIds: (await world.browser.list()).map(item => item.id), sandboxIds: (await world.sandbox.list()).map(item => item.id) });
          let targetConversation = conversationId;
          if (url.pathname === "/api/verify") {
            if (body.conversationId !== undefined) {
              if (typeof body.conversationId !== "string" || !body.conversationId.startsWith("verification-") || !(await foundry.listConversations(agentId)).some(item => item.id === body.conversationId)) {
                working = false; json(response, { error: "Verification can only resume an existing verification conversation." }, 400); return;
              }
              targetConversation = body.conversationId;
            } else {
              targetConversation = `verification-${randomUUID()}`;
              await foundry.createConversation(agentId, { id: targetConversation, title: "Isolated verification" });
            }
          }
          const run = await foundry.send(agentId, targetConversation, body.message); activeRun = run.id; json(response, { id: run.id, conversationId: targetConversation }, 202);
        }
        catch (error) { working = false; throw error; }
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/stop") {
        await jsonBody(request);
        if (activeRun) await foundry.cancel(activeRun);
        json(response, { ok: true }); return;
      }
      if (request.method === "GET" && url.pathname === "/api/browser.png") {
        if (working) { response.writeHead(204).end(); return; }
        const browser = (await world.browser.list())[0];
        if (!browser) { response.writeHead(204).end(); return; }
        try {
          const image = await world.browser.perform(browser.id, "screenshot") as { base64: string };
          response.setHeader("content-type", "image/png"); response.end(Buffer.from(image.base64, "base64"));
        } catch { response.writeHead(204).end(); }
        return;
      }
      json(response, { error: "Not found" }, 404);
    } catch (error) {
      let detail = error instanceof Error ? error.message : "Unknown operation error";
      for (const name of ["OPENROUTER_API_KEY", "STEEL_API_KEY"] as const) detail = detail.replaceAll(secret(name), "[redacted]");
      console.error(`Operator ${url.pathname}: ${detail}`);
      json(response, { error: "The operation failed. Check the private runtime log before retrying a change." }, 500);
    }
  });
  await listen(consoleServer, port);
  await writeState("host.json", { pid: process.pid, url: `http://127.0.0.1:${port}` });
  console.log(`Operator ready: http://127.0.0.1:${port}`);
  console.log(`Foundry inspector: http://127.0.0.1:${port + 2}`);
} catch (error) {
  // Known setup messages contain no provider credentials or response payloads.
  console.error(`Operator startup failed: ${error instanceof Error ? error.message.replace(/(?:sk-or-v1-|ste_)[A-Za-z0-9_-]+/g, "[redacted]") : "unknown setup error"}`);
  await stop(); process.exitCode = 1;
}
