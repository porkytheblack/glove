import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Shared facts and preparation",
  description: "Retain early evidence and prepare goals and forms with scoped, source-linked model inference.",
};

export default function FactsPage() {
  return <div className="docs-content">
    <h1>Shared facts and preparation</h1>
    <p><code>glove-facts</code> retains information, document observations and completed outcomes before their consuming step is active. Goals and forms share the evidence, keep separate links, and use their own validation and commit rules.</p>
    <CodeBlock language="typescript" code={`import {
  FactStore, InMemoryFactAdapter, FactPreparation,
  useFacts,
} from "glove-facts";

const facts = new FactStore(new InMemoryFactAdapter(), {
  scope: { subject: "tenant:1/client:2", context: "matter:3" },
  onUrgent: fact => alertConversation(fact),
});

useFacts(glove, facts, () => ({
  source: { kind: "message", id: currentMessageId },
  operationId: currentMessageId,
}));

const preparer = new FactPreparation(facts, {
  agent: preparationAgent, // Dedicated, built IGloveRunnable with your store/subscribers.
});`} />
    <p>Supplying a preparation agent enables automatic preparation; omit it to disable preparation. The library mounts a structured submission tool and calls <code>agent.processRequest</code>, preserving message history, tool results, token accounting and subscriber events. Use a dedicated agent and store per fact scope, separate from the conversational agent. Both workflows may share it within that scope.</p>
    <h2>Prepare before progression</h2>
    <p>Pass the same preparer to <code>useGoalRunner</code> and <code>useFormRunner</code>. A host-owned rule opts each requirement in. Omitted rules stay manual. Preparation runs the supplied Glove agent through its normal execution loop and tracing, synthesizes candidate answers with exact evidence revisions, validates them, and commits through the runner before returning actionable context. Conditional gates still decide eligibility.</p>
    <CodeBlock language="typescript" code={`import { useGoalRunner, useFormRunner } from "glove-memory/tools";

useGoalRunner(glove, goalAdapter, {
  scope: { subject: "tenant:1/client:2", key: "intake" },
  preparation: {
    preparer,
    rule: (_goal, item) => item.key === "email"
      ? { kind: "information", criteria: "Preferred contact email" }
      : undefined,
  },
});

useFormRunner(glove, formAdapter, {
  registry, subject: "tenant:1/client:2",
  preparation: {
    preparer,
    rule: field => field.id === "email"
      ? { kind: "information", criteria: "Preferred contact email" }
      : undefined,
  },
});`} />
    <h2>Evidence does not bypass workflow rules</h2>
    <p>The model-facing <code>record_fact</code> tool records unverified text with host-bound provenance. Host code can record verified evidence, including action/outcome success for an exact <code>evidenceKey</code>. Approvals also require an actor in <code>authorizedActors</code>. Intention does not prove an action happened, and preference does not grant approval. Information rules can explicitly allow unverified statements; ambiguity and conflict still require clarification.</p>
    <h2>Corrections and toggling</h2>
    <p>Corrections append revisions and retain history. A changed source or contrary proposal puts an existing completion or answer into review. This release preserves completed work and requires an explicit ordinary runner revision or reopening. Disabling preparation skips automatic inference, claims and prefill while preserving all captured evidence and workflow state. Call <code>runner.prepare()</code> to reconcile immediately; mounted runners do so before model turns.</p>
    <h2>Persistence and recovery</h2>
    <p>The in-memory adapter lasts one process. A durable FactAdapter must serialize each scope across workers. Proposed links are saved before the consumer commit; accepted links are acknowledged from claim receipts persisted with the answer or goal progress. Prepared form effects use a durable pending batch and can resume through <code>resumeHooks()</code>. External effects remain at least once and must deduplicate the supplied idempotency key.</p>
    <p>See the <a href="https://github.com/porkytheblack/glove/tree/main/packages/glove-facts">package guide</a> for the storage contract, correction API, urgency delivery, and rules for recognizing already completed form effects.</p>
  </div>;
}
