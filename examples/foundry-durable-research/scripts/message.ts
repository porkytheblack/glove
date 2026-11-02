import { createFoundryClient } from "glove-foundry/client";

const client = createFoundryClient({ baseUrl: "http://127.0.0.1:4143" });
const worker = client.subagent("demo-front", "research");
const instance = await worker.ensure();
const receipt = await worker.send(
  "Review the vendor briefs for EU hosting. Notify parent in conversation demo-live if a finding needs attention.",
  { id: "vendor-review-v1", whenIdle: "wake" },
);
console.log(receipt);

// A precise address: this updates the same default worker conversation.
await client.emitEvent(
  { agentId: instance.id, conversationId: receipt.conversationId },
  { id: "budget-v1", source: "app:preferences", kind: "budget.changed", content: "The budget is $50/user/month." },
  { whenIdle: "defer", deferTimeoutMs: 60_000 },
);
console.log((await worker.data()).events.map(({ event, status }) => ({ id: event.id, status })));
