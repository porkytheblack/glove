/**
 * The desk: one working environment + one agent per session, held server-side.
 *
 * The environment cannot live in the browser. Scripts execute in worker
 * threads with a real Node heap, and the format adapters wrap libraries
 * (pdf-lib, exceljs, sharp, pptxgenjs) that only exist on the server. So the
 * agent runs here and the browser sees a stream of events — the inverse of
 * the usual `glove-react` arrangement, where tools execute in the client.
 *
 * That inversion is the whole point of this example: the model is not calling
 * a bag of pre-built document verbs. It has a filesystem, a script runtime and
 * a standard library, and it writes code against them.
 */
import { Displaymanager, Glove, MemoryStore, createAdapter } from "glove-core";
import type { IGloveRunnable, SubscriberAdapter } from "glove-core";
import {
  createWorkingEnvironment,
  mountWorkingEnvironment,
  type WorkingEnvironment,
} from "glove-working-environment";
import { documents } from "glove-env-documents";
import { spreadsheets } from "glove-env-spreadsheets";
import { images } from "glove-env-images";
import { slides } from "glove-env-slides";
import { archives } from "glove-env-archives";
import { SYSTEM_PROMPT } from "./prompt";

export interface Desk {
  id: string;
  env: WorkingEnvironment;
  agent: IGloveRunnable;
  /** Subscribers attached for the lifetime of one request. */
  listeners: Set<(event: DeskEvent) => void>;
  createdAt: number;
}

/** What the browser sees. A narrowed projection of Glove's subscriber stream. */
export type DeskEvent =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; status: "success" | "error"; output: string }
  | { type: "tree_changed" }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Sessions live in a module-global rather than a plain module variable.
 *
 * Next's dev server re-evaluates route modules on edit, which would otherwise
 * drop every environment mid-conversation — including the worker threads they
 * own. Hanging them off `globalThis` survives the reload.
 */
const registry: Map<string, Desk> = ((globalThis as Record<string, unknown>).__deskRegistry ??=
  new Map()) as Map<string, Desk>;

/** Verbs that change the tree, so the browser knows when to refresh it. */
const MUTATING = new Set([
  "write_file",
  "edit_file",
  "rm",
  "mv",
  "cp",
  "run_script",
  "run_tests",
  "undo",
  "redo",
  "checkpoint",
]);

export async function getDesk(id: string): Promise<Desk> {
  const existing = registry.get(id);
  if (existing) return existing;

  const env = await createWorkingEnvironment({
    stdlib: [documents(), spreadsheets(), images(), slides(), archives()],
    limits: {
      // A generous script budget: rendering a deck or a hundred-page PDF is
      // real work, and a timeout here reads to the user as "the agent broke".
      runTimeoutMs: 60_000,
    },
    execution: {
      // One warm worker per session. The browser drives one request at a time.
      size: 1,
      onWarning: (message) => console.warn(`[desk:${id}] ${message}`),
    },
  });

  const desk: Desk = {
    id,
    env,
    agent: undefined as unknown as IGloveRunnable,
    listeners: new Set(),
    createdAt: Date.now(),
  };

  const broadcast = (event: DeskEvent) => {
    for (const listen of desk.listeners) listen(event);
  };

  /**
   * Glove's event stream, narrowed to what the UI actually renders.
   *
   * Note the field names: a tool *call* carries `id` and `name`, its *result*
   * carries `call_id` and `tool_name`. They are not the same two keys, and
   * matching results to calls on the wrong one produces a UI where every verb
   * spins forever.
   */
  const subscriber: SubscriberAdapter = {
    record: async (eventType, data) => {
      const d = data as Record<string, unknown>;
      switch (eventType) {
        case "text_delta":
          broadcast({ type: "text", text: String(d.text ?? "") });
          break;
        case "tool_use":
          broadcast({
            type: "tool",
            id: String(d.id ?? ""),
            name: String(d.name ?? ""),
            input: d.input,
          });
          break;
        case "tool_use_result": {
          const result = d as {
            call_id?: string;
            tool_name?: string;
            result?: { status?: string; data?: unknown; message?: string };
          };
          const inner = result.result ?? {};
          const status = inner.status === "error" ? "error" : "success";
          const output = inner.status === "error" ? String(inner.message ?? "") : String(inner.data ?? "");
          broadcast({ type: "tool_result", id: String(result.call_id ?? ""), status, output });
          // A tree-changed ping after any mutating verb, so the file explorer
          // can stay live without polling.
          if (result.tool_name && MUTATING.has(result.tool_name)) broadcast({ type: "tree_changed" });
          break;
        }
      }
    },
  };

  const agent = new Glove({
    store: new MemoryStore(id),
    model: createAdapter({
      // Any provider glove-core knows. The default reads ANTHROPIC_API_KEY;
      // DESK_PROVIDER=openrouter + DESK_MODEL=<slug> swaps it without a code
      // change, which is how this example gets exercised cheaply.
      provider: process.env.DESK_PROVIDER ?? "anthropic",
      ...(process.env.DESK_MODEL ? { model: process.env.DESK_MODEL } : {}),
      stream: true,
    }),
    displayManager: new Displaymanager(),
    systemPrompt: SYSTEM_PROMPT,
    // Headless: nothing in this agent asks the browser for permission, and
    // the working environment's verbs are not permission-gated.
    serverMode: true,
    compaction_config: {
      compaction_instructions:
        "Summarise what the user asked for, what files were produced in /out, and which scripts under /scripts " +
        "already exist and what they do — the script library is the agent's accumulated capability and must survive.",
    },
  })
    .addSubscriber(subscriber)
    .build();

  // The verb set, plus a preamble telling the model what the tree is for.
  mountWorkingEnvironment(agent, { env });

  desk.agent = agent;
  registry.set(id, desk);
  return desk;
}

/** For the upload route — mount without needing the agent. */
export async function deskFor(id: string): Promise<Desk> {
  return getDesk(id);
}

export function peekDesk(id: string): Desk | undefined {
  return registry.get(id);
}

/**
 * Drop the oldest sessions once there are too many.
 *
 * Each desk owns a worker thread and an in-memory tree; an example left open
 * in a tab for a day should not accumulate them without bound.
 */
export async function reapOldDesks(keep = 12): Promise<void> {
  if (registry.size <= keep) return;
  const oldest = [...registry.values()].sort((a, b) => a.createdAt - b.createdAt).slice(0, registry.size - keep);
  for (const desk of oldest) {
    registry.delete(desk.id);
    await desk.env.close().catch(() => {});
  }
}
