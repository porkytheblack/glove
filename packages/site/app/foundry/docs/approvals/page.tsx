import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Approvals & steering",
  description:
    "Permission-gated tools wait on an approval a person decides, through a link that leads straight to it. Approvals are stored, survive restarts and resume the run; steering redirects active work.",
};

export default function ApprovalsPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / Approvals &amp; steering</span>
      <h1>Approvals &amp; steering</h1>
      <p className="blog-lede">
        Keep a human in the loop for the calls that matter. A permission-gated tool call
        becomes an approval that a person decides from the inspector, your own app or a single
        HTTP call. Approvals are stored: when nobody decides at once, the run stops at that
        call, the approval waits (through restarts too), and the decision resumes the run where
        it stopped. Each approval has its own address, so a message or an email can link
        straight to it. When an agent heads the wrong way, steer it: Foundry stops the run at
        a safe boundary and restarts it in the same conversation with your new direction.
      </p>

      <h2 id="overview">How an approval works</h2>
      <ol>
        <li>A tool declares <code>requiresPermission</code>. For this call it evaluates to <code>true</code>.</li>
        <li>Glove asks the conversation store for a saved decision for this exact tool and input. None is saved.</li>
        <li>Foundry stores a <code>pending</code> approval, emits <code>agent.foundry.approval.requested</code>, and the run waits for a decision (it stays <code>running</code>) for <code>approvals.waitMs</code>, 60 seconds by default.</li>
        <li>Someone approves or denies it: the approval&apos;s page, the inspector, <code>client.resolveApproval</code>, or <code>POST /api/approvals/:id</code>.</li>
        <li><strong>Decided in time</strong>: approved, the tool runs with that input; denied, the model receives <code>Permission denied for tool &quot;…&quot;. The user has not granted permission to run this tool.</code> Either way the run carries on.</li>
        <li><strong>Not decided in time</strong>: the run stops at that tool call and ends as <code>suspended</code> (<code>suspension.kind: &quot;approval&quot;</code>), with no result recorded for the call. The approval stays open for 7 days by default. When someone decides it, Foundry resumes the conversation at that call. See <a href="#durable">Durable approvals</a>.</li>
      </ol>

      <h2 id="gate-a-tool">Gate a tool</h2>
      <p>
        <code>requiresPermission</code> is a standard Glove tool field (<code>GloveFoldArgs</code>),
        so it works on <code>defineAgent</code> <code>tools</code>, on the <code>tool</code> of a{" "}
        <code>defineSharedTool</code>, and on tools an application contributes. Use{" "}
        <code>true</code> to gate every call, or a function of the validated input: return{" "}
        <code>true</code> to require approval for this call, <code>false</code> to run it
        immediately.
      </p>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";
import { z } from "zod";

export default defineAgent({
  description: "Acme customer support",
  model: () => createAdapter({ provider: "openrouter", model: "openai/gpt-4.1-mini", stream: true }),
  systemPrompt: "You are Acme's support agent. Refunds over $50 need a human's approval.",
  tools: [
    {
      name: "issue_refund",
      description: "Refund part or all of an order to the customer's original payment method.",
      inputSchema: z.object({
        orderId: z.string(),
        amountUsd: z.number().positive(),
        reason: z.string(),
      }),
      // true for this call = ask a human first; false = run immediately.
      requiresPermission: ({ amountUsd }) => amountUsd > 50,
      async do({ orderId, amountUsd }) {
        // your code: await payments.refund(orderId, amountUsd)
        return { status: "success" as const, data: { orderId, refundedUsd: amountUsd } };
      },
    },
  ],
});`} />

      <h3 id="gate-outbound">Gate an outbound transmission</h3>
      <p>
        An installed application turns each outbound transmission into a tool. Set{" "}
        <code>outbound.requiresPermission</code> to a boolean or to a predicate (sync or
        async) over the schema-decoded payload, and that tool asks first. A payload that fails to decode, or a
        route the playbook did not select, never creates an approval — the tool rejects it
        instead.
      </p>
      <CodeBlock filename="agents/support/transmissions/tickets.transmission.ts" language="typescript" code={`import { Effect, Schema } from "effect";
import { defineTransmission } from "glove-foundry";

export const createTicket = {
  id: "tickets:create",
  description: "Open a helpdesk ticket",
  account: "required",
  effect: "write",
} as const;

export default defineTransmission({
  name: "Tickets",
  description: "Helpdesk ticket queue",
  account: { required: true, metadata: Schema.Struct({ workspace: Schema.String }) },
  capabilities: [createTicket],
  outbound: {
    config: Schema.Struct({ queue: Schema.String }),
    input: Schema.Struct({
      subject: Schema.String,
      priority: Schema.Literal("low", "normal", "urgent"),
    }),
    output: Schema.Struct({ ticketId: Schema.String }),
    // Decoded payload in, boolean out: only urgent tickets wait for a human.
    requiresPermission: (input) => input.priority === "urgent",
    adapter: {
      // your code: call the helpdesk API
      deliver: (input) => Effect.succeed({ ticketId: \`T-\${input.subject.length}-\${Date.now()}\` }),
    },
  },
});`} />
      <p>
        How applications and transmissions are installed is covered in{" "}
        <Link href="/foundry/docs/applications">Apps &amp; transmissions</Link>.
      </p>

      <h2 id="approval-record">The approval record</h2>
      <table>
        <thead><tr><th>FoundryApproval field</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>id</code></td><td><code>approval_&lt;uuid&gt;</code></td></tr>
          <tr><td><code>runId</code>, <code>definitionId</code>, <code>agentId</code>, <code>conversationId</code>, <code>workspaceId</code></td><td>Exactly which run, instance and conversation is asking.</td></tr>
          <tr><td><code>toolName</code>, <code>toolInput</code>, <code>toolCallId?</code></td><td>The tool, the JSON-serialized input that will run if approved, and the model&apos;s id for the waiting call.</td></tr>
          <tr><td><code>status</code></td><td>See below.</td></tr>
          <tr><td><code>requestedAt</code>, <code>expiresAt</code>, <code>resolvedAt?</code></td><td>ISO timestamps. <code>expiresAt</code> is <code>approvals.expiresAfterMs</code> (7 days) after <code>requestedAt</code>.</td></tr>
          <tr><td><code>url?</code></td><td>Where a person decides it, from your <code>approvals.url</code>.</td></tr>
          <tr><td><code>suspendedAt?</code></td><td>When the run stopped waiting. A decision after this resumes the conversation.</td></tr>
          <tr><td><code>resumedAt?</code>, <code>resumeRunId?</code></td><td>When the decision was handed back, and the run that took it.</td></tr>
          <tr><td><code>mesh?</code></td><td><code>{"{ threadId, messageId }"}</code> when the application&apos;s mesh gate <Link href="/foundry/docs/multi-agent#mesh-application">drafted a message</Link>. Approved, the message is committed and delivered; denied or expired, it is dropped. No run resumes and the sending agent is not told.</td></tr>
        </tbody>
      </table>
      <table>
        <thead><tr><th>Status</th><th>When</th><th>Tool runs?</th></tr></thead>
        <tbody>
          <tr><td><code>pending</code></td><td>Waiting for a decision: the run waits, or it has suspended.</td><td>Not yet</td></tr>
          <tr><td><code>approved</code></td><td>Resolved with <code>&quot;approve&quot;</code>.</td><td>Yes</td></tr>
          <tr><td><code>denied</code></td><td>Resolved with <code>&quot;deny&quot;</code>.</td><td>No</td></tr>
          <tr><td><code>expired</code></td><td>Nobody decided before <code>expiresAt</code>.</td><td>No</td></tr>
          <tr><td><code>cancelled</code></td><td>The run that asked was cancelled or steered.</td><td>No</td></tr>
        </tbody>
      </table>
      <ul>
        <li><strong>Exact-input identity.</strong> One record per gated call, bound to its run, instance, conversation, tool and serialized input. Approving <code>{"{ amountUsd: 80 }"}</code> never approves <code>{"{ amountUsd: 800 }"}</code>.</li>
        <li><strong>First decision wins.</strong> Resolution is an atomic create; a second <code>resolveApproval</code> on the same id fails with <code>Foundry approval &quot;…&quot; is already approved.</code> (HTTP <code>400</code>). So does resolving an expired one.</li>
        <li><strong>Stored.</strong> Approvals live in the application&apos;s data adapter, next to its agents and conversations. <code>FileFoundryDataAdapter</code> keeps them in its JSON file, so they survive a restart.</li>
        <li><strong>Configurable timing.</strong> <code>{"defineApplication({ approvals: { waitMs, expiresAfterMs } })"}</code>.</li>
      </ul>

      <h3 id="fail-closed">Fail-closed</h3>
      <p>
        Only an explicit <code>approve</code> runs the tool. Foundry denies when the approval
        channel is unavailable (<code>agent.foundry.approval.unavailable</code>), when the record
        cannot be written or read (<code>agent.foundry.approval.failed</code>), on expiry, and when
        the run is cancelled. <code>GET /v1/capabilities</code> advertises this as{" "}
        <code>approvals.default: &quot;deny&quot;</code>.
      </p>
      <div className="docs-note"><span className="docs-note-icon">!</span><p>
        Foundry routes permission prompts through its own display manager. If you set{" "}
        <code>displayManager</code> on <code>defineAgent</code>, you replace it: prompts go to
        your display manager and no approval records are created.
      </p></div>

      <h3 id="remembered">Remembered decisions</h3>
      <p>
        After a decision, Glove saves it with{" "}
        <code>store.setPermission(toolName, &quot;granted&quot; | &quot;denied&quot;, input)</code>.
        Whether it is reused depends on your conversation store:
      </p>
      <ul>
        <li>Stores that implement <code>getPermission</code>/<code>setPermission</code> (glove-core <code>MemoryStore</code>, glove-sqlite <code>SqliteStore</code>) answer later identical calls from the saved decision — a denial included — without a new approval record. <code>SqliteStore</code> persists it per store identifier (typically one per conversation), so it holds across runs.</li>
        <li>Stores without those methods are wrapped by Foundry with <code>withFoundryPermissions</code>: an in-memory, exact-input map that lasts for the current run only.</li>
      </ul>
      <p>
        <code>withFoundryPermissions(store)</code> and <code>FoundryApprovalDisplayManager</code>{" "}
        are exported, but Foundry already applies both to every agent run; you only need them
        when hosting a Glove agent outside the Foundry runtime.
      </p>

      <h2 id="resolve">Resolve approvals</h2>
      <h3 id="resolve-client">From your code</h3>
      <CodeBlock filename="scripts/approve.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";

const foundry = createFoundryClient();
const handle = await foundry.send("support-acme", "conversation-1042", "Refund the full order 1042.");

// Later, or from another process:
const pending = await foundry.approvals({ runId: handle.id, status: "pending" });
for (const approval of pending) {
  console.log(approval.toolName, approval.toolInput); // issue_refund { orderId: "1042", amountUsd: 129, … }
  await foundry.resolveApproval(approval.id, "approve"); // or "deny"
}`} />
      <h3 id="resolve-http">Over HTTP</h3>
      <table>
        <thead><tr><th>Endpoint</th><th>Input</th><th>Result</th></tr></thead>
        <tbody>
          <tr><td><code>GET /api/approvals</code>, <code>GET /v1/approvals</code></td><td><code>?runId=</code> (or <code>run_id</code>), <code>?status=</code> one of the five statuses</td><td><code>FoundryApproval[]</code>, oldest first; an unknown status is <code>400</code></td></tr>
          <tr><td><code>GET /api/approvals/:id</code>, <code>GET /v1/approvals/:id</code></td><td>—</td><td>One <code>FoundryApproval</code>, or <code>404</code></td></tr>
          <tr><td><code>POST /api/approvals/:id</code>, <code>POST /v1/approvals/:id</code></td><td><code>{"{ \"decision\": \"approve\" | \"deny\" }"}</code></td><td>The resolved <code>FoundryApproval</code></td></tr>
        </tbody>
      </table>
      <CodeBlock filename="terminal" language="bash" code={`curl -s 'http://127.0.0.1:4141/v1/approvals?status=pending'

curl -s -X POST http://127.0.0.1:4141/v1/approvals/APPROVAL_ID \\
  -H 'content-type: application/json' -d '{"decision":"deny"}'`} />
      <h3 id="resolve-inspector">In the inspector</h3>
      <p>
        The overview page shows a <strong>Decision required</strong> rail listing every pending
        request — tool name, the exact input, a link to the run, when it was requested and when
        it expires — with <strong>Deny</strong> and <strong>Approve this input</strong> buttons.
        The waiting run&apos;s detail page shows the same rail for that run, and the
        &ldquo;Attention needed&rdquo; metric counts waiting effects. Each approval also has its
        own page, <code>/approvals/:id</code>, with its status, the run that asked and the run
        that resumed it. See{" "}
        <Link href="/foundry/docs/observability">Inspector &amp; WebChat</Link>.
      </p>
      <h3 id="approval-events">Events</h3>
      <table>
        <thead><tr><th>Event type</th><th>data</th></tr></thead>
        <tbody>
          <tr><td><code>agent.foundry.approval.requested</code></td><td>The full <code>FoundryApproval</code></td></tr>
          <tr><td><code>agent.foundry.approval.settled</code></td><td><code>{"{ approvalId, toolName, status }"}</code> — the run read the decision itself</td></tr>
          <tr><td><code>agent.foundry.approval.suspended</code></td><td><code>{"{ approvalId, toolName }"}</code> — the run stopped waiting and suspended</td></tr>
          <tr><td><code>approval.resumed</code></td><td><code>{"{ approvalId, toolName, status }"}</code> — a decision was handed back to the conversation</td></tr>
          <tr><td><code>approval.resolved</code></td><td><code>{"{ approvalId, toolName, decision, status }"}</code> — written when someone resolves via the API</td></tr>
          <tr><td><code>agent.foundry.approval.unavailable</code> / <code>.failed</code></td><td>Fail-closed denials</td></tr>
        </tbody>
      </table>
      <p>
        Subscribe with <code>GET /api/events</code> and <code>Accept: text/event-stream</code>{" "}
        (<Link href="/foundry/docs/runtime#events">details</Link>) to push notifications instead
        of polling.
      </p>

      <h2 id="durable">Durable approvals</h2>
      <p>
        Approvals are durable when the data adapter stores approvals and the event journal.
        <code>FileFoundryDataAdapter</code> and <code>MemoryFoundryDataAdapter</code> do. A
        person does not have to answer while the run waits: they can answer from a link
        hours later, after a deploy, on another device.
      </p>
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`export default defineApplication({
  name: "Muse",
  data: new FileFoundryDataAdapter({ file: "/data/foundry.json" }),
  approvals: {
    waitMs: 60_000,                        // how long the run waits before it suspends
    expiresAfterMs: 7 * 24 * 60 * 60_000,  // how long the approval stays open
    url: (approval) => \`https://muse.example.com/approvals/\${approval.id}\`,
  },
});`} />
      <ol>
        <li><strong>The run waits</strong> <code>waitMs</code>. A decision in that time works as above.</li>
        <li><strong>The run suspends.</strong> The turn stops at the waiting call. Calls the model made before it in the same step keep their results; no result is recorded for the waiting call or any after it. The run ends with <code>status: &quot;suspended&quot;</code> and <code>{'suspension: { kind: "approval", approvalId, toolName }'}</code>, and the conversation is free for new messages.</li>
        <li><strong>The approval waits</strong> until it is decided or <code>expiresAfterMs</code> passes. A restart changes nothing.</li>
        <li><strong>The decision resumes it.</strong> Foundry hands the decision to the conversation as a durable event, and the run that takes it carries on from the waiting call: approved, the call runs and its real result is saved; denied, it is refused. Then the turn continues as if it had never stopped. The approval records <code>resumedAt</code> and <code>resumeRunId</code>.</li>
      </ol>
      <h3 id="durable-moved-on">When the conversation moved on</h3>
      <p>
        If the person kept talking before deciding, the waiting call is no longer the end of
        the conversation, so it cannot resume in place. The decision then arrives as an event
        the agent reads (&ldquo;The person approved your earlier request to run send_email. It
        has not run yet&hellip;&rdquo;). The decision is saved for that exact input, so if the
        agent calls the tool again with the same input it runs, or is refused, without asking
        again.
      </p>
      <h3 id="durable-link">Link straight to an approval</h3>
      <p>
        <code>approvals.url</code> gives each approval the address of a page in your app, kept
        on the record as <code>url</code>. Whatever tells the person (a WhatsApp message, an
        email, a push) can link there. The page reads the approval with{" "}
        <code>client.approval(id)</code> (<code>GET /api/approvals/:id</code>) and answers with{" "}
        <code>client.resolveApproval</code>. Check that the approval belongs to the signed-in
        person before showing it.
      </p>
      <h3 id="durable-details">Details</h3>
      <ul>
        <li><strong>Cancelling or steering</strong> the run that asked cancels its open approvals. Nothing resumes them.</li>
        <li><strong>Expiry.</strong> An approval still pending at <code>expiresAt</code> becomes <code>expired</code> and resumes nothing.</li>
        <li><strong>At least once.</strong> Decisions travel on the event journal, which can deliver twice after a crash. A decision whose call already has its result starts no turn, so an approved call does not run twice.</li>
        <li><strong>Without durable storage</strong> (a custom adapter without <code>putApproval</code>, <code>getApproval</code>, <code>listApprovals</code> and the event journal), approvals live in the Foundry process: the run waits up to <code>waitMs</code> (5 minutes by default, at most 10), then the approval expires and the call is refused.</li>
        <li><strong>Custom handlers.</strong> A resume goes through <code>ctx.defaultRun()</code>. A <code>run</code> or <code>handler</code> that never calls it gets the decision as a normal event.</li>
      </ul>
      <p>
        Outside Foundry, the same building blocks are in Glove core: a display manager throws{" "}
        <code>ToolPermissionDeferred</code> to stop a turn at a call, the turn rejects with{" "}
        <code>TurnSuspended</code>, and <code>glove.resumeToolCalls()</code> carries on once the
        decision is saved with <code>store.setPermission</code>.
      </p>

      <h2 id="approval-inbox">Recipe: an approval inbox</h2>
      <p>
        Put approvals where your reviewers already are. Three functions cover a web page or a
        chat bot; the loop at the bottom is a minimal notifier.
      </p>
      <CodeBlock filename="src/approval-inbox.ts" language="typescript" code={`import type { FoundryApproval } from "glove-foundry";
import { createFoundryClient } from "glove-foundry/client";

const foundry = createFoundryClient({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141",
});

/** Everything waiting for a human, oldest first. */
export function pendingApprovals(): Promise<ReadonlyArray<FoundryApproval>> {
  return foundry.approvals({ status: "pending" });
}

/** One line a reviewer can act on. Show the exact input: that is what gets approved. */
export function describeApproval(approval: FoundryApproval): string {
  const secondsLeft = Math.max(0, Math.round((Date.parse(approval.expiresAt) - Date.now()) / 1000));
  return \`\${approval.toolName} for instance \${approval.agentId} \` +
    \`(run \${approval.runId}, \${secondsLeft}s left): \${JSON.stringify(approval.toolInput)}\`;
}

/** Returns null when someone else decided first or the request expired. */
export async function decide(
  approvalId: string,
  decision: "approve" | "deny",
): Promise<FoundryApproval | null> {
  try {
    return await foundry.resolveApproval(approvalId, decision);
  } catch (error) {
    console.warn(\`approval \${approvalId}: \${(error as Error).message}\`);
    return null;
  }
}

// Notify reviewers once per request. Poll well inside the 5-minute expiry.
const notified = new Set<string>();
setInterval(async () => {
  for (const approval of await pendingApprovals()) {
    if (notified.has(approval.id)) continue;
    notified.add(approval.id);
    console.log(describeApproval(approval)); // your code: post to Slack/email with approve and deny actions
  }
}, 2_000);`} />
      <p>
        The <code>FoundryApproval</code> import is type-only, so a browser bundle pulls in only
        the client. If the inbox runs on another machine, Foundry must be reachable there — and a
        non-loopback Foundry requires <code>requestAuthorization</code>, so pass{" "}
        <code>authorization</code> to <code>createFoundryClient</code>.
      </p>

      <h2 id="programmatic-tools">Programmatic tools cannot bypass approvals</h2>
      <p>
        When a REPL exposes tools to a sandboxed program (<code>defineRepl</code> with{" "}
        <code>programmaticTools</code>), Foundry evaluates <code>requiresPermission</code> on the
        validated input before each call. If it is <code>true</code>, the call throws{" "}
        <code>Tool &quot;…&quot; requires interactive approval and cannot run inside a programmatic workflow. Call it directly so the approval can be shown.</code>{" "}
        and emits <code>agent.foundry.repl.programmatic-tool.denied</code>. The model then calls the
        tool normally and the approval flow above applies. See{" "}
        <Link href="/foundry/docs/working-environments">Working environments</Link>.
      </p>

      <h2 id="steering">Steering</h2>
      <p>
        Redirect an agent mid-task — &ldquo;stop, only refund the shipping fee&rdquo; — without
        leaving it half-way through a side effect. Foundry calls this{" "}
        <strong>interrupt-and-restart</strong>:
      </p>
      <ol>
        <li>If the source run is <code>pending</code> or <code>running</code>, Foundry cancels it through the execution daemon: the run is marked <code>cancelled</code> and its agent process is told to stop, which fires the run&apos;s abort signal — a pending approval resolves as <code>cancelled</code> (denied).</li>
        <li>It waits for the run to reach a terminal status, for at most the run&apos;s <code>timeoutMs</code> clamped to 1–30 s. If it does not get there, steering fails with <code>Foundry could not reach a safe steering boundary for run &quot;…&quot;.</code> and no new run starts.</li>
        <li>It waits for the cancelled run&apos;s process to let go of the conversation. The run reads <code>cancelled</code> as soon as the stop is sent, but its process finishes an <code>unAbortable</code> tool and its cleanup before exiting. Foundry waits for that, for at most 10 s (the execution daemon kills the process 5 s after the stop), so the replacement never reads history while the old process is still writing it.</li>
        <li>It sends your message as a new run on the same instance and conversation, with <code>request.context</code> containing <code>protocol: &quot;foundry-control&quot;</code>, <code>steeredFromRunId</code> and <code>steeringMode: &quot;interrupt-and-restart&quot;</code>.</li>
        <li>It records a <code>run.steered</code> event on the new run with <code>fromRunId</code>, <code>toRunId</code> and <code>interrupted</code>.</li>
      </ol>
      <p>
        Foundry never injects text into an in-flight model call or tool. If the source run had
        already finished, nothing is cancelled (<code>interrupted: false</code>) and the message
        is simply the next turn. The replacement run loads the history the conversation store
        holds once the interrupted process has finished, including the result of a tool that
        could not be interrupted.
      </p>
      <CodeBlock filename="scripts/steer.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";

const foundry = createFoundryClient();
const handle = await foundry.send("support-acme", "conversation-1042", "Refund the full order 1042.");

// Changed your mind while the run is still working:
const steered = await handle.steer("Stop. Refund only the $12 shipping fee, not the whole order.");
console.log(steered.fromRunId === handle.id); // true
console.log(steered.interrupted);             // true if an active run was cancelled
const result = await steered.run.wait({ timeoutMs: 120_000 }); // steered.run is a new FoundryRunHandle
console.log(result.status, result.output?.value);`} />
      <p>
        <code>handle.steer(message)</code> resolves a <code>FoundrySteerHandleResult</code>:{" "}
        <code>{"{ fromRunId, interrupted, run: FoundryRunHandle }"}</code>.{" "}
        <code>client.steerRun(runId, message)</code> returns the same shape with a plain{" "}
        <code>FoundryRun</code> record. Over HTTP, <code>POST /api/runs/:id/steer</code> and{" "}
        <code>POST /v1/runs/:id/steer</code> take <code>message</code>, <code>input</code> or{" "}
        <code>guidance</code> (a string or content parts) and answer <code>202</code>; an unknown
        run is <code>404</code>.
      </p>
      <h3 id="steering-prompt">Tell the agent it was redirected</h3>
      <p>
        Lazy assembly sees the steering context, so the prompt can stop the model from resuming
        the abandoned plan:
      </p>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`systemPrompt: (_agent, { request }) => [
  "You are Acme's support agent. Refunds over $50 need a human's approval.",
  request.context?.steeredFromRunId
    ? "The user redirected you mid-task. Follow their latest message instead of resuming the abandoned plan."
    : "",
].filter(Boolean).join("\\n"),`} />
      <h3 id="webchat-redirect">Redirect in WebChat</h3>
      <p>
        In the inspector&apos;s <strong>Chat</strong> page, while a run is active the send button
        becomes <strong>Redirect</strong>: your message goes to{" "}
        <code>POST /api/runs/:id/steer</code> and the page shows &ldquo;Direction
        updated&rdquo;. <strong>Stop</strong> cancels without a new run.
      </p>
      <h3 id="cancel-vs-steer">Cancel or steer?</h3>
      <table>
        <thead><tr><th></th><th>Cancel / stop</th><th>Steer</th></tr></thead>
        <tbody>
          <tr><td>Calls</td><td><code>handle.cancel()</code>, <code>POST /api/runs/:id/cancel</code>, <code>POST /v1/runs/:id/stop</code></td><td><code>handle.steer(msg)</code>, <code>POST /api/runs/:id/steer</code>, <code>POST /v1/runs/:id/steer</code></td></tr>
          <tr><td>Active run</td><td>Ends <code>cancelled</code>; pending approvals become <code>cancelled</code></td><td>Same, then a replacement run starts</td></tr>
          <tr><td>Already finished run</td><td>Nothing to cancel (<code>false</code>)</td><td>Your message becomes a follow-up turn</td></tr>
          <tr><td>Returns</td><td><code>boolean</code> (<code>{"{ cancelled }"}</code> / <code>{"{ id, stopped }"}</code> over HTTP)</td><td><code>{"{ fromRunId, interrupted, run }"}</code></td></tr>
        </tbody>
      </table>
    </article>
  );
}
