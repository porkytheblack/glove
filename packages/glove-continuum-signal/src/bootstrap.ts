/**
 * Entrypoint for spawned agent subprocesses.
 *
 * Spawned by `ContinuumRunner` — not intended for direct use.
 *
 * Status authority: the PARENT runner is the single source of truth for run
 * status (H1 in station-signal). This child only emits IPC envelopes; the
 * parent translates them into adapter updates. The child never writes to
 * the adapter — it doesn't even reconstruct one.
 *
 * No child-side timeout (H5): the parent runner's `checkTimeouts()` is the
 * only authority for timeout enforcement.
 *
 * Two modes:
 *   - `triggered`: parse env input, run `processRequest` once, IPC the
 *     result, let the event loop drain (H4).
 *   - `concurrent`: send `ready`, then listen for `notify` envelopes — each
 *     drives a `processRequest`. Stays alive until `stop` IPC.
 */

import type {
  IGloveRunnable,
  SubscriberAdapter,
  SubscriberEvent,
  SubscriberEventDataMap,
} from "glove-core";
import type { AgentRuntimeControls, AnyAgent } from "./agent.js";
import { AgentNotFoundError, AgentValidationError } from "./errors.js";
import { sendIPC, type ParentToChildMessage } from "./ipc.js";
import { errMessage, isAgent, nowISO } from "./util.js";

const agentName = process.env.CONTINUUM_AGENT_NAME;
const agentFile = process.env.CONTINUUM_AGENT_FILE;
const mode = process.env.CONTINUUM_MODE as
  | "triggered"
  | "concurrent"
  | undefined;
const runId = process.env.CONTINUUM_RUN_ID;
const rawInput = process.env.CONTINUUM_INPUT_JSON;

if (!agentName || !agentFile || !mode) {
  console.error(
    "[glove-continuum-signal] Missing required env vars (CONTINUUM_AGENT_NAME, CONTINUUM_AGENT_FILE, CONTINUUM_MODE)",
  );
  process.exit(1);
}

if (mode === "triggered" && (!runId || rawInput === undefined)) {
  console.error(
    "[glove-continuum-signal] Triggered bootstrap requires CONTINUUM_RUN_ID and CONTINUUM_INPUT_JSON",
  );
  process.exit(1);
}

let currentRunId: string | null = mode === "triggered" ? runId! : null;

function promptOf(input: unknown): string {
  return typeof input === "string" ? input : JSON.stringify(input);
}

async function main(): Promise<void> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(agentFile!)) as Record<string, unknown>;
  } catch (err) {
    await sendIPC({
      type: mode === "triggered" ? "run:failed" : "notify:failed",
      runId: currentRunId ?? "unknown",
      agentName: agentName!,
      error: `Failed to import agent file ${agentFile}: ${errMessage(err)}`,
      retryable: false,
      timestamp: nowISO(),
    } as never);
    process.exit(1);
  }

  let agent: AnyAgent | undefined;
  for (const value of Object.values(mod)) {
    if (isAgent(value) && value.name === agentName) {
      agent = value;
      break;
    }
  }

  if (!agent) {
    const err = new AgentNotFoundError(agentName!, agentFile);
    await sendIPC({
      type: mode === "triggered" ? "run:failed" : "notify:failed",
      runId: currentRunId ?? "unknown",
      agentName: agentName!,
      error: err.message,
      retryable: false,
      timestamp: nowISO(),
    } as never);
    process.exit(1);
  }

  if (agent.mode !== mode) {
    await sendIPC({
      type: mode === "triggered" ? "run:failed" : "notify:failed",
      runId: currentRunId ?? "unknown",
      agentName: agentName!,
      error: `Agent "${agentName}" is registered as "${agent.mode}" but bootstrap was launched in "${mode}" mode`,
      retryable: false,
      timestamp: nowISO(),
    } as never);
    process.exit(1);
  }

  // Build the persistent store, if the agent registered a factory for one.
  const store = agent.storeFactory ? await agent.storeFactory(agent.name) : null;

  // IPC-forwarding subscriber: every Glove event becomes an `agent:event`
  // envelope upstream, tagged with the run id currently being processed.
  const subscriber: SubscriberAdapter = {
    async record<T extends SubscriberEvent["type"]>(
      event_type: T,
      data: SubscriberEventDataMap[T],
    ): Promise<void> {
      await sendIPC({
        type: "agent:event",
        agentName: agent!.name,
        runId: currentRunId,
        event_type,
        data: data as unknown,
        timestamp: nowISO(),
      });
    },
  };

  // Abort signal that fires on graceful stop / restart / terminal failure.
  const ac = new AbortController();
  const controls: AgentRuntimeControls = {
    emit: (event) => {
      void sendIPC({
        type: "agent:event",
        agentName: agent!.name,
        runId: currentRunId,
        // Custom event types are carried through verbatim — wrappers branch
        // on `envelope.event_type` and ignore unknown types.
        event_type: event.type as SubscriberEvent["type"],
        data: (event.data ?? {}) as unknown,
        timestamp: nowISO(),
      });
    },
    signal: ac.signal,
  };

  // Build the Glove via the agent's factory.
  let glove: IGloveRunnable;
  try {
    glove = await agent.factory({
      name: agent.name,
      runId: currentRunId ?? "warmup",
      mode: agent.mode,
      store,
      subscriber,
      controls,
    });
  } catch (err) {
    await sendIPC({
      type: mode === "triggered" ? "run:failed" : "notify:failed",
      runId: currentRunId ?? "unknown",
      agentName: agent.name,
      error: `Factory threw: ${errMessage(err)}`,
      retryable: false,
      timestamp: nowISO(),
    } as never);
    process.exit(1);
  }

  // Defensive re-attach in case the factory forgot. `addSubscriber` is
  // idempotent in practice — `removeSubscriber` exists if needed.
  glove.addSubscriber(subscriber);

  if (agent.mode === "triggered") {
    await runTriggered(agent, glove, rawInput!);
    return;
  }

  await runConcurrent(agent, glove, ac);
}

async function runTriggered(
  agent: AnyAgent,
  glove: IGloveRunnable,
  rawInputJson: string,
): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(rawInputJson);
    const result = agent.inputSchema.safeParse(parsed);
    if (!result.success) {
      const err = new AgentValidationError(
        agent.name,
        result.error?.message ?? "Unknown validation error",
      );
      console.error(`[glove-continuum-signal] ${err.message}`);
      await sendIPC({
        type: "run:failed",
        runId: currentRunId!,
        agentName: agent.name,
        error: err.message,
        retryable: false,
        timestamp: nowISO(),
      });
      process.exit(1);
    }

    await sendIPC({
      type: "run:started",
      runId: currentRunId!,
      agentName: agent.name,
      timestamp: nowISO(),
    });

    const modelResult = await glove.processRequest(promptOf(result.data));
    const output = extractOutput(modelResult);
    const validated = agent.outputSchema
      ? validateOutput(agent, output)
      : output;
    const serialized =
      validated !== undefined ? JSON.stringify(validated) : undefined;

    if (agent.onCompleteHandler && validated !== undefined) {
      try {
        await agent.onCompleteHandler(validated, result.data);
      } catch (err) {
        await sendIPC({
          type: "onComplete:error",
          runId: currentRunId!,
          agentName: agent.name,
          error: errMessage(err),
        });
      }
    }

    await sendIPC({
      type: "run:completed",
      runId: currentRunId!,
      agentName: agent.name,
      output: serialized,
      timestamp: nowISO(),
    });
    // H4: let the event loop drain so IPC finishes flushing before exit.
  } catch (err) {
    const retryable = !(err instanceof AgentValidationError);
    await sendIPC({
      type: "run:failed",
      runId: currentRunId!,
      agentName: agent.name,
      error: errMessage(err),
      retryable,
      timestamp: nowISO(),
    });
    process.exit(1);
  }
}

async function runConcurrent(
  agent: AnyAgent,
  glove: IGloveRunnable,
  ac: AbortController,
): Promise<void> {
  await sendIPC({ type: "ready", agentName: agent.name });

  // Serialize notify-runs within a single warm subprocess. Glove's
  // `processRequest` is not safe to run concurrently against the same
  // store (PromptMachine state is shared). Wrappers that want true
  // parallelism should run multiple warm subprocesses.
  let chain: Promise<void> = Promise.resolve();
  let stopping = false;

  const handleNotify = (msg: { runId: string; input: unknown }): void => {
    chain = chain.then(async () => {
      currentRunId = msg.runId;
      await sendIPC({
        type: "notify:started",
        runId: msg.runId,
        agentName: agent.name,
        timestamp: nowISO(),
      });

      try {
        const result = agent.inputSchema.safeParse(msg.input);
        if (!result.success) {
          const err = new AgentValidationError(
            agent.name,
            result.error?.message ?? "Unknown validation error",
          );
          await sendIPC({
            type: "notify:failed",
            runId: msg.runId,
            agentName: agent.name,
            error: err.message,
            timestamp: nowISO(),
          });
          return;
        }

        const modelResult = await glove.processRequest(promptOf(result.data));
        const output = extractOutput(modelResult);
        const validated = agent.outputSchema
          ? validateOutput(agent, output)
          : output;
        const serialized =
          validated !== undefined ? JSON.stringify(validated) : undefined;

        if (agent.onCompleteHandler && validated !== undefined) {
          try {
            await agent.onCompleteHandler(validated, result.data);
          } catch (err) {
            await sendIPC({
              type: "onComplete:error",
              runId: msg.runId,
              agentName: agent.name,
              error: errMessage(err),
            });
          }
        }

        await sendIPC({
          type: "notify:completed",
          runId: msg.runId,
          agentName: agent.name,
          output: serialized,
          timestamp: nowISO(),
        });
      } catch (err) {
        await sendIPC({
          type: "notify:failed",
          runId: msg.runId,
          agentName: agent.name,
          error: errMessage(err),
          timestamp: nowISO(),
        });
      } finally {
        currentRunId = null;
      }
    });
  };

  process.on("message", (raw: unknown) => {
    const msg = raw as ParentToChildMessage;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "stop") {
      stopping = true;
      ac.abort();
      // Give in-flight notify a moment to send its closing envelope, then exit.
      setTimeout(() => process.exit(0), 200);
      return;
    }
    if (msg.type === "notify") {
      // Reject notifies arriving after stop has been received — the chain
      // is being torn down. Without this, the late notify would either get
      // queued behind a chain link that's about to be aborted (producing a
      // confusing failure) or race the 200ms exit deadline.
      if (stopping) {
        void sendIPC({
          type: "notify:failed",
          runId: msg.runId,
          agentName: agent.name,
          error: "Warm subprocess is shutting down",
          timestamp: nowISO(),
        });
        return;
      }
      handleNotify(msg);
      return;
    }
  });

  // Keep the event loop alive even when no IPC is queued.
  process.on("SIGTERM", () => {
    ac.abort();
    process.exit(143);
  });
}

function extractOutput(result: unknown): unknown {
  if (result == null) return undefined;
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    // ModelPromptResult has `messages: Message[]` — pull the last assistant text.
    if (Array.isArray(obj.messages)) {
      const last = obj.messages[obj.messages.length - 1] as
        | { text?: string }
        | undefined;
      return last?.text ?? "";
    }
    // Direct Message
    if ("text" in obj) return obj.text;
  }
  return result;
}

function validateOutput(agent: AnyAgent, value: unknown): unknown {
  if (!agent.outputSchema) return value;
  const parsed = agent.outputSchema.safeParse(value);
  if (!parsed.success) {
    throw new AgentValidationError(
      agent.name,
      `Output validation failed: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

process.on("uncaughtException", async (err) => {
  console.error("[glove-continuum-signal] uncaughtException:", err);
  await sendIPC({
    type: mode === "triggered" ? "run:failed" : "notify:failed",
    runId: currentRunId ?? "unknown",
    agentName: agentName!,
    error: errMessage(err),
    retryable: true,
    timestamp: nowISO(),
  } as never);
  process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
  console.error("[glove-continuum-signal] unhandledRejection:", reason);
  await sendIPC({
    type: mode === "triggered" ? "run:failed" : "notify:failed",
    runId: currentRunId ?? "unknown",
    agentName: agentName!,
    error: errMessage(reason),
    retryable: true,
    timestamp: nowISO(),
  } as never);
  process.exit(1);
});

main().catch(async (err) => {
  await sendIPC({
    type: mode === "triggered" ? "run:failed" : "notify:failed",
    runId: currentRunId ?? "unknown",
    agentName: agentName!,
    error: errMessage(err),
    retryable: true,
    timestamp: nowISO(),
  } as never);
  process.exit(1);
});
