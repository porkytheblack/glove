---
"glove-core": minor
"glove-foundry": minor
---

Durable, resumable approvals.

**glove-core.** A permission prompt can be deferred. A display manager that will not decide now throws `ToolPermissionDeferred` from `pushAndWait`. The turn stops at that tool call: calls before it in the same step keep their results, and no result is recorded for it or the calls after it. The request rejects with `TurnSuspended` (`deferral`, `completed`, `pending`). `glove.resumeToolCalls(signal?)` carries the turn on later: it runs the calls left without a result, with the decision the host saved through `store.setPermission`, then continues the loop. It returns `undefined` when the latest tool step has nothing pending or the conversation moved on. `Agent.pendingToolCalls()` reports what a resume would run. The permission prompt's input now includes `toolCallId`. `isToolPermissionDeferred` and `isTurnSuspended` work across copies of glove-core.

**glove-foundry.** Approvals are stored and outlive the run that asked.

- The data adapter keeps them: `putApproval`, `getApproval` and `listApprovals` (optional). `FileFoundryDataAdapter` and `MemoryFoundryDataAdapter` implement them. With these and the event journal, approvals are durable.
- The run waits `approvals.waitMs` (60 s by default) for a decision. If nobody decides, it suspends at that call: the run ends with `status: "suspended"` and `suspension: { kind: "approval", approvalId, toolName }`, and the conversation is free. The approval stays open for `approvals.expiresAfterMs` (7 days by default), through restarts.
- A decision made after the run suspended goes to the conversation as a durable event. The run that takes it resumes the turn at the waiting call: approved, it runs and its real result is saved; denied, it is refused. If the conversation moved on, the decision arrives as an event and the agent may call the tool again with the same input, which then runs or is refused without asking. A decision delivered twice does not run the call twice.
- Every approval has an address. `GET /api/approvals/:id` and `GET /v1/approvals/:id` return one; `client.approval(id)` reads it; the inspector shows it at `/approvals/:id`. `defineApplication({ approvals: { url } })` gives each approval a page in your app, kept as `approval.url`, so a message or an email can link straight to it.
- Cancelling or steering the run that asked cancels its open approvals. After a restart, open approvals are marked suspended and decisions not yet handed back are delivered.
- New fields on `FoundryApproval`: `toolCallId`, `url`, `suspendedAt`, `resumedAt`, `resumeRunId`, `settledInRun`. New events: `agent.foundry.approval.suspended`, `approval.resumed`.

Behaviour change: with the bundled adapters, an approval nobody answers no longer expires after 5 minutes with the call refused. The run suspends after 60 s and the approval stays open for 7 days. Set `approvals: { waitMs, expiresAfterMs }` to change either. A custom adapter without the approval methods keeps the old behaviour.
