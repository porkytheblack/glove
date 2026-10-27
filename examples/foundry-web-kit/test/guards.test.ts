import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../src/server/errors";
import { ownedAgent, ownedAgents, ownedApproval, ownedConversation, ownedRun } from "../src/server/guards";
import { pendingApprovals } from "../src/server/approvals";

// A stand-in for Foundry with two people's records in it.
const agents = [
  { id: "maya-inbox", workspaceId: "maya", definitionId: "bot", name: "Inbox Manager", context: {}, installations: [], playbooks: [] },
  { id: "sam-bot-1", workspaceId: "sam", definitionId: "bot", name: "Pip", context: {}, installations: [], playbooks: [] },
];
const conversations: Record<string, Array<{ id: string; agentId: string; workspaceId: string }>> = {
  "maya-inbox": [{ id: "maya-inbox-chat", agentId: "maya-inbox", workspaceId: "maya" }],
  "sam-bot-1": [{ id: "sam-bot-1-chat", agentId: "sam-bot-1", workspaceId: "sam" }],
};
const runs: Record<string, { id: string; workspaceId: string; status: string }> = {
  "run-maya": { id: "run-maya", workspaceId: "maya", status: "running" },
  "run-sam": { id: "run-sam", workspaceId: "sam", status: "running" },
};
const approvals = [
  { id: "approval-maya", workspaceId: "maya", runId: "run-maya", agentId: "maya-inbox", conversationId: "maya-inbox-chat", definitionId: "bot", toolName: "glove_app_gmail__gmail_send", toolInput: { routeId: "maya-gmail-out", payload: { to: "dan@contoso.example", subject: "Re: Thursday", body: "Friday at 10?", threadId: "t-1" } }, status: "pending", requestedAt: "2026-10-27T09:00:00.000Z", expiresAt: "2026-10-27T09:05:00.000Z" },
  { id: "approval-sam", workspaceId: "sam", runId: "run-sam", agentId: "sam-bot-1", conversationId: "sam-bot-1-chat", definitionId: "bot", toolName: "connect_app", toolInput: { app: "gmail", why: "To read mail" }, status: "pending", requestedAt: "2026-10-27T09:01:00.000Z", expiresAt: "2026-10-27T09:06:00.000Z" },
];
const client = {
  agentInstances: async () => agents,
  conversations: async (agentId: string) => conversations[agentId] ?? [],
  getRun: async (runId: string) => {
    const run = runs[runId];
    if (!run) throw new Error("Foundry run was not found.");
    return run;
  },
  approvals: async (filter: { status?: string } = {}) => approvals.filter((item) => !filter.status || item.status === filter.status),
} as never;

async function rejects404(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => error instanceof HttpError && error.status === 404);
}

test("guards return a person's own records", async () => {
  assert.equal((await ownedAgent("maya", "maya-inbox", client)).id, "maya-inbox");
  assert.equal((await ownedConversation("maya", "maya-inbox", "maya-inbox-chat", client)).id, "maya-inbox-chat");
  assert.equal((await ownedRun("maya", "run-maya", client)).id, "run-maya");
  assert.equal((await ownedApproval("maya", "approval-maya", client)).id, "approval-maya");
  assert.deepEqual((await ownedAgents("maya", undefined, client)).map((agent) => agent.id), ["maya-inbox"]);
});

test("guards answer 404 for another workspace's records, the same as for missing ones", async () => {
  await rejects404(ownedAgent("maya", "sam-bot-1", client));
  await rejects404(ownedAgent("maya", "nobody", client));
  await rejects404(ownedConversation("maya", "sam-bot-1", "sam-bot-1-chat", client));
  await rejects404(ownedConversation("maya", "maya-inbox", "sam-bot-1-chat", client));
  await rejects404(ownedRun("maya", "run-sam", client));
  await rejects404(ownedRun("maya", "run-missing", client));
  await rejects404(ownedApproval("maya", "approval-sam", client));
});

test("pending approvals are the workspace's, with only the fields a person needs", async () => {
  const views = await pendingApprovals("maya", { client });
  assert.deepEqual(views.map((view) => view.id), ["approval-maya"]);
  const [view] = views;
  assert.deepEqual(view!.fields, [{ label: "To", value: "dan@contoso.example" }, { label: "Subject", value: "Re: Thursday" }]);
  assert.equal(view!.body, "Friday at 10?");
  assert.doesNotMatch(JSON.stringify(view), /routeId|maya-gmail-out|threadId|t-1/, "no other input");
  assert.equal(view!.canAlwaysAllow, false);
});
