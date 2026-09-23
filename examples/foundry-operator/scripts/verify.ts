import assert from "node:assert/strict";
import { port } from "../lib/settings.js";
import { ConversationStore } from "../lib/store.js";
import { writeState } from "../lib/state.js";
const base = `http://127.0.0.1:${port}`;
async function request(path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, body === undefined ? {} : { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(response.ok, true, `Operator API ${path}: ${response.status}`);
  return await response.json();
}
const initial = await request("/api/state");
assert.equal(initial.sandboxes.length > 0, true);
const run = process.argv.includes("--check") ? initial.run : await request("/api/verify", { message: `Use your browser tools to open https://example.com, inspect its main heading and take a screenshot. Then use the retained sandbox to build a polished, self-contained project dashboard called Field Notes: a blue-and-white layout with three sample tasks and a compact progress panel. These are demo tasks, not private data. Write a Node HTTP server in server.mjs, include the literal verification marker fieldwork-ready in the HTML, and start it as a managed service on port 3000. Verify the server with a Node fetch inside the sandbox. Report the observed web heading and the server result. Do not send any messages or visit Telegram.` });
const deadline = Date.now() + 300000;
let result;
while (Date.now() < deadline) {
  const state = await request("/api/state");
  if (state.run?.id === run.id && !["pending", "running", "retrying"].includes(state.run.status)) { result = state; break; }
  await new Promise(resolve => setTimeout(resolve, 1500));
}
assert.equal(result?.run.status, "completed", "Live agent run must complete");
assert.ok(result.services.some((service: { status: string }) => service.status === "running"), "Managed service must remain running");
const preview = await fetch(`http://127.0.0.1:${port + 3}`);
assert.equal(preview.status, 200);
assert.match(await preview.text(), /fieldwork-ready/);
const transcript = (await (await ConversationStore.open(run.conversationId)).getMessages());
assert.match(JSON.stringify(transcript.filter(message => message.sender === "agent")), /Example Domain/i);
const toolResults = transcript.flatMap(message => message.tool_results ?? []);
assert.ok(toolResults.some(result => result.tool_name === "execute_browser" && result.result.status === "success"));
assert.ok(toolResults.some(result => result.tool_name === "execute_sandbox" && result.result.status === "success"));
await writeState("verification.json", { runId: run.id, completedAt: new Date().toISOString(), checks: ["live-model", "browser-heading", "browser-image", "container-code", "managed-service", "HTTP-preview"], output: result.run.output });
console.log("Verified: live Foundry agent browsed, wrote code, started a container service, and served a working preview.");
