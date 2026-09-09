# Runtime-context migration: core 4, memory 2, voice 0.3

Upgrade `glove-core` to `4.0.0`, `glove-memory` to `2.0.0`, and, if used, `glove-voice-s2s` to `0.3.0`. These releases replace changing system-prompt memory sections with live runtime snapshots.

## Standard Glove applications

Keep the existing `useContext`, `useFormRunner`, and `useGoalRunner` mounting calls. Upgrade core and memory together. Model/storage adapters and stored facts, forms, goals, and conversation history need no data migration.

## Custom runnable and builder implementations

`IGloveRunnable` now requires:

```ts
import type { Message, RuntimeContextProvider } from "glove-core";

interface RuntimeContextMethods {
  addContextProvider(provider: RuntimeContextProvider): () => void;
  getRuntimeContext(signal?: AbortSignal): Promise<Message[]>;
}
```

`IGloveBuilder` also requires `addContextProvider`. A provider returns a string, null, or undefined, synchronously or asynchronously, and receives an optional abort signal. Registration returns an unregister function. Empty provider output contributes no message.

A custom execution loop must resolve providers before **every model iteration**, including iterations after tools. Append their output as user-role messages **after** saved history and complete tool results. Preserve provider registration order. Do not put snapshots into system instructions or persist them as conversation history. Propagate cancellation/read failures before calling the model. Keep registrations across rebuilds and store replacement, and expose resolved snapshots through the `runtime_context` subscriber event without allowing subscriber mutation to change model input.

## Wrappers around an existing Glove

Forward the APIs to the same underlying agent that executes requests. Add these methods to your existing wrapper; do not replace its other methods or fields:

```ts
addContextProvider: agent.addContextProvider.bind(agent),
getRuntimeContext: agent.getRuntimeContext.bind(agent),
```

Do not implement these as no-ops merely to satisfy the interface. Default memory mounting throws when `addContextProvider` is missing. Forms and goals support `injectStatus: false` if the host explicitly provides its own renderer; pinned context requires the provider API.

## Framework provenance and user-turn boundaries

Runtime snapshots carry optional `Message.framework_context: "runtime"`; synthetic inbox messages carry `"inbox"`. Preserve this metadata through custom processing and tracing. It records origin, not a new provider role or a higher instruction priority. No custom store schema change is required for transient snapshots.

Tool-result summarization uses the last actual user turn, ignoring framework context and existing skill/compaction markers. Pending inbox reminders are placed after complete tool-result bundles; their contents are still read once per request. Custom adapter code that merges adjacent user messages must concatenate structured content blocks without converting media arrays into strings.

## Reading and tracing memory state

`getSystemPrompt()` now returns host instructions without dynamic goals/forms/context. Read current snapshots with:

```ts
const messages = await agent.getRuntimeContext(signal);
```

Exhaustive subscriber-event handlers must accept `runtime_context`, whose payload contains `messages`. Getter calls also emit this event, so it means snapshots were resolved, not that a provider necessarily completed a model request.

Preparation and goal lifecycle synchronization still run before mounted `processRequest` calls. Reading runtime context does not run preparation, transition recovery, or host configuration. Custom loops that bypass `processRequest` must explicitly arrange that lifecycle work, for example using goal mounting's returned `refresh()` and a form runner's `prepare()` when preparation is configured.

## Realtime voice

`RealtimeAgent.refreshSession()` now returns `Promise<void>`. Await it and handle errors. It updates instructions/tools and then refreshes runtime context:

```ts
await realtime.refreshSession();
```

After external state changes, refresh memory without changing session instructions:

```ts
await realtime.refreshContext();
```

The bridge silently injects changed snapshots at startup and after successful tool calls. It does not poll external storage before every audio turn. Voice providers can retain old injected snapshots in their session; the latest snapshot supersedes them. Initial context failures reject startup and disconnect. A context failure after a successful tool emits an error while preserving that tool's successful result.

## Validation for downstream runtimes

- Confirm the system prompt stays identical as goals, forms, and pinned context change.
- Confirm the next model iteration sees tool-driven changes without another user request.
- Confirm snapshots follow complete tool results and never enter saved conversation history.
- Confirm providers survive rebuilds, and unregistering removes their output.
- Confirm cancellation/read failures stop the model call and tracing records resolved context.
- For voice, check silent refresh, awaited refresh errors, and external state updates.

This change preserves the stable system/history prefix. Actual cache hits and billing still depend on the model provider.
