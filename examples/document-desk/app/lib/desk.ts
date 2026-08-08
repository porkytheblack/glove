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
  defineTools,
  mountWorkingEnvironment,
  type WorkingEnvironment,
} from "glove-working-environment";
import { documents } from "glove-env-documents";
import { spreadsheets } from "glove-env-spreadsheets";
import { images } from "glove-env-images";
import { slides } from "glove-env-slides";
import { archives } from "glove-env-archives";
import { render } from "glove-env-render";
import { motion, MOTION_LIMITS } from "glove-env-motion";
import { visionAdapter } from "./vision";
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
  | { type: "presented"; path: string; name: string; mediaType: string; size: number; caption: string }
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

/**
 * The vision model as an importable function, via `defineTools`.
 *
 * The distinction this example is here to show: `view_image` is a *verb*, and
 * every answer it gives lands in the context window. Checking forty rendered
 * pages that way costs forty round trips and buries the conversation. The same
 * model as a *capability* is a loop —
 *
 * ```js
 * const { pages } = await rasterize('/out/report.pdf', '/tmp/pages');
 * const bad = [];
 * for (const p of pages) {
 *   const answer = await look({ path: p.path, prompt: 'Is any text cut off at the page edge?' });
 *   if (/yes/i.test(answer)) bad.push(p.page);
 * }
 * return bad.length ? `pages with clipped text: ${bad.join(', ')}` : 'all pages clean';
 * ```
 *
 * — and only that last line comes back. Bytes are read inside the call, so
 * images never cross the worker boundary either.
 *
 * The `envRef` holder exists because the module has to be listed in `stdlib`
 * before the environment it reads from exists. A capability that needs the
 * tree is the one case where `defineTools` needs this indirection; one that
 * only calls out to a service (an MCP server, an API) does not.
 */
function visionModule(
  vision: NonNullable<ReturnType<typeof visionAdapter>>,
  envRef: { current?: WorkingEnvironment },
) {
  return defineTools({
    name: "vision",
    description: "Ask a vision model about an image, from inside a script.",
    fns: [
      {
        name: "look",
        description:
          "Answer a question about how an image LOOKS. Give a specific question, not 'describe this'. " +
          "Takes a path to a raster image (PNG/JPEG) — rasterize a PDF or deck with env:render first.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute VFS path of a PNG or JPEG" },
            prompt: { type: "string", description: "The specific question to answer about it" },
          },
          required: ["path", "prompt"],
        },
        resultShape: "string",
        readOnlyHint: true,
        async call(args) {
          const { path, prompt } = args as { path?: string; prompt?: string };
          if (!path || !prompt) throw new Error("look needs { path, prompt }");
          if (!envRef.current) throw new Error("the environment is not ready yet");
          const bytes = await envRef.current.fs.readBytes(path);
          const lower = path.toLowerCase();
          const mediaType = lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : "image/png";
          return await vision.describe({ bytes, mediaType, prompt });
        },
      },
    ],
    docs:
      "One call, one image, one question. For a whole document: rasterize with `env:render` " +
      "into `/tmp`, then loop. Keep the question narrow — an open-ended look costs the same " +
      "and answers less.",
  });
}

export async function getDesk(id: string): Promise<Desk> {
  const existing = registry.get(id);
  if (existing) return existing;

  const vision = visionAdapter();

  // Declared before the environment because `onPresent` fires from inside a
  // tool call — the desk object that owns this set does not exist yet.
  const listeners = new Set<(event: DeskEvent) => void>();
  const broadcast = (event: DeskEvent) => {
    for (const listen of listeners) listen(event);
  };
  const envRef: { current?: WorkingEnvironment } = {};

  const env = await createWorkingEnvironment({
    stdlib: [
      documents(),
      spreadsheets(),
      images(),
      slides(),
      archives(),
      render(),
      // The desk can make things that move. A scene is a React component and
      // the browser is the drawing surface, so the same capability covers an
      // animated explainer, a title card and a chart PNG — which is why it is
      // `env:motion` and not `env:video`.
      //
      // Mounted unconditionally on purpose: if this host has no browser, the
      // adapter says so in its own `/std/motion/README.md` and in
      // `capabilities()`, rather than the agent discovering it by burning a
      // render. `glove-motion-doctor` answers the same question from a shell.
      motion(),
      // The fourth authoring route: a capability, not a library. `view_image`
      // is one look per tool call, which is right for spot-checking and wrong
      // for a forty-page document — so the same vision model is mounted as a
      // function a script can loop over. The per-page answers land in a
      // variable; only the summary comes back.
      ...(vision ? [visionModule(vision, envRef)] : []),
    ],
    // Wire a vision model and the agent gains `view_image`, so it can check
    // its own output by LOOKING at it — the one defect class that reading the
    // text back cannot catch. Absent a key, the verb is simply not offered.
    ...(vision ? { vision } : {}),
    // And `present`: writing a file to /out is not the same as handing it
    // over, because /out also accumulates drafts and intermediates.
    onPresent: ({ path, name, mediaType, bytes, caption }) => {
      broadcast({ type: "presented", path, name, mediaType, size: bytes.byteLength, caption });
    },
    limits: {
      // A generous script budget: rendering a deck or a hundred-page PDF is
      // real work, and a timeout here reads to the user as "the agent broke".
      //
      // Video needs more than that again — a few hundred screenshots through a
      // browser — so the ceiling comes from `env:motion` itself. Leave it at
      // 60s and renders are refused *before* they start, with this exact line
      // named as the fix; that is better than a generic timeout four minutes
      // in, but it is still a refusal.
      ...MOTION_LIMITS,
      // Room for what people actually drop in. The 32MB default turns a
      // scanned contract or a photo library into a refused upload, and "any
      // file I want to work on" is the whole premise of the inbox.
      maxFileBytes: 96 * 1024 * 1024,
      maxVfsBytes: 512 * 1024 * 1024,
    },
    execution: {
      // One warm worker per session. The browser drives one request at a time.
      size: 1,
      onWarning: (message) => console.warn(`[desk:${id}] ${message}`),
    },
  });

  envRef.current = env;

  const desk: Desk = {
    id,
    env,
    agent: undefined as unknown as IGloveRunnable,
    listeners,
    createdAt: Date.now(),
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
