// ─────────────────────────────────────────────────────────────────────────────
// Tool hosts — where a realtime model's tool calls actually run.
//
// A speech-to-speech session has a split brain by construction: the model
// lives at the provider, the browser holds the microphone, and the agent
// with the API keys and the database lives on your server. The one thing
// that crosses all three is a tool call.
//
// `S2SToolHost` is that seam. It answers two questions — "what tools does
// this session have?" and "run this one" — and every wiring option is an
// implementation of it:
//
//   gloveToolHost(glove)     the agent's own folded tools, one-for-one
//   delegateToolHost(glove)  the whole agent as ONE tool (layered pattern)
//   localToolHost([...])     browser-side tools (navigate, scroll, fill)
//   httpToolHost({endpoint}) browser → your route → a host on the server
//   composeToolHosts(a, b)   any combination of the above
//
// Because the declarations are DERIVED from the agent, folding a tool into
// a Glove is all it takes for the voice model to gain it — there is no
// second JSON-Schema list to keep in sync.
// ─────────────────────────────────────────────────────────────────────────────

import { getToolJsonSchema } from "glove-core/core";
import type { IGloveRunnable } from "glove-core/glove";
import { extractAgentText } from "glove-core/utils";
import type { S2STool } from "./types";

/** Options common to every `callTool` implementation. */
export interface S2SCallOptions {
  signal?: AbortSignal;
}

/**
 * The execution seam between a realtime model and whatever actually runs
 * its tools. Implement this to bridge a transport we don't ship.
 */
export interface S2SToolHost {
  /** Tool declarations to publish into the realtime session. */
  listTools(): S2STool[] | Promise<S2STool[]>;
  /**
   * Run one call. The resolved value is sent back to the model as the tool
   * result, so it should be something the model can read out loud or reason
   * over (a string, or JSON that serializes small).
   *
   * Throwing is allowed — `GloveS2S` converts a thrown error into an error
   * result the model can level with the user about, rather than dropping the
   * call and leaving the model waiting.
   */
  callTool(name: string, input: unknown, opts?: S2SCallOptions): Promise<unknown>;
}

// ─── Glove-backed hosts ──────────────────────────────────────────────────────

export interface GloveToolHostOptions {
  /** Only publish these tools (by name). Defaults to all of them. */
  include?: string[];
  /** Publish everything except these. Applied after `include`. */
  exclude?: string[];
  /**
   * Rewrite a declaration before it reaches the model — voice tools often
   * want terser descriptions than a text agent's ("say the hull id out
   * loud"). Return `null` to drop the tool.
   */
  describe?: (tool: S2STool) => S2STool | null;
}

/**
 * Publish an agent's tools to the realtime model ONE FOR ONE, and run each
 * call through that agent's executor — same permission gate, same schema
 * validation, same `tool_use_result` events its subscribers already see.
 *
 * Use this when the voice model should act with the agent's own hands: the
 * latency is a single tool round trip, so it suits fast, well-scoped tools
 * (lookups, state changes). For multi-step research, prefer
 * {@link delegateToolHost} — one call, the full agent loop behind it.
 *
 * ```ts
 * const s2s = new GloveS2S({ adapter, tools: gloveToolHost(glove) });
 * ```
 */
export function gloveToolHost(
  glove: IGloveRunnable,
  opts: GloveToolHostOptions = {},
): S2SToolHost {
  return {
    listTools() {
      const declared: S2STool[] = [];
      for (const tool of glove.tools) {
        if (opts.include && !opts.include.includes(tool.name)) continue;
        if (opts.exclude?.includes(tool.name)) continue;
        const base: S2STool = {
          name: tool.name,
          description: tool.description,
          parameters: getToolJsonSchema(tool),
        };
        const shaped = opts.describe ? opts.describe(base) : base;
        if (shaped) declared.push(shaped);
      }
      return declared;
    },
    async callTool(name, input, callOpts) {
      const result = await glove.invokeTool(name, input, { signal: callOpts?.signal });
      if (result.status === "success") {
        return result.data ?? result.message ?? "done";
      }
      return {
        error: result.message ?? `Tool "${name}" ${result.status}.`,
        status: result.status,
      };
    },
  };
}

export interface DelegateToolHostOptions {
  /** Tool name the model calls. Default `"delegate_to_worker"`. */
  name?: string;
  /** Tool description. Defaults to a generic research/action framing. */
  description?: string;
  /** Description of the single `request` argument. */
  requestDescription?: string;
  /**
   * Wrap the model's request before it reaches the agent. The default frames
   * it as a delegated request whose final message IS the reply, which is what
   * keeps the worker from trying to "respond" through a tool it doesn't have.
   */
  framing?: (request: string) => string;
  /** Text returned when the agent produced no usable answer. */
  emptyResult?: string;
}

const DEFAULT_FRAMING = (request: string) =>
  `[Delegated request from the voice front desk] ${request}\n\n` +
  `Handle this with your tools, then state your findings as plain text — ` +
  `your final message IS the reply and will be read out loud.`;

/**
 * Expose an ENTIRE agent as a single tool — the layered-agents pattern.
 *
 * The realtime model keeps the parts that must be instant (persona,
 * addressing judgment, turn-taking, the voice) and hands anything that needs
 * real work to a heavy text agent running its own loop behind one call. The
 * model acknowledges out loud while the worker researches, then relays the
 * result — the same shape as the mesh wakeup, with the tool result as the
 * reply channel.
 *
 * Runs are SERIALIZED: a Glove is single-threaded over its own history, and
 * a realtime model will happily fire a second delegation while the first is
 * still running.
 */
export function delegateToolHost(
  glove: IGloveRunnable,
  opts: DelegateToolHostOptions = {},
): S2SToolHost {
  const name = opts.name ?? "delegate_to_worker";
  const framing = opts.framing ?? DEFAULT_FRAMING;
  let queue: Promise<unknown> = Promise.resolve();

  return {
    listTools() {
      return [
        {
          name,
          description:
            opts.description ??
            "Send a request to the capability worker — anything needing data, " +
              "research, or a multi-step action. Returns its findings.",
          parameters: {
            type: "object",
            properties: {
              request: {
                type: "string",
                description:
                  opts.requestDescription ??
                  "The request, restated clearly and self-contained (include any id, " +
                    "name, or detail you heard — the worker cannot hear the conversation).",
              },
            },
            required: ["request"],
          },
        },
      ];
    },
    callTool(toolName, input, callOpts) {
      if (toolName !== name) {
        return Promise.reject(new Error(`delegateToolHost only serves "${name}", got "${toolName}"`));
      }
      const request = String((input as { request?: unknown } | undefined)?.request ?? "").trim();
      if (!request) return Promise.resolve({ error: "No request was supplied." });

      const run = queue.then(async () => {
        const result = await glove.processRequest(framing(request), callOpts?.signal);
        return extractAgentText(result) || (opts.emptyResult ?? "The worker produced no findings.");
      });
      // Keep the chain alive on failure so one bad delegation doesn't wedge
      // every later one, while still surfacing THIS error to the caller.
      queue = run.catch(() => {});
      return run;
    },
  };
}

// ─── Local + remote hosts ────────────────────────────────────────────────────

/** A tool declared and executed in the same process as the session. */
export interface LocalS2STool extends S2STool {
  run(input: any, opts?: S2SCallOptions): Promise<unknown> | unknown;
}

/**
 * Tools that run right where the session does — in the browser, that means
 * things the server physically cannot do: navigate, scroll to an element,
 * fill a field, read the current selection.
 */
export function localToolHost(tools: LocalS2STool[]): S2SToolHost {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    listTools() {
      return tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
    },
    async callTool(name, input, opts) {
      const tool = byName.get(name);
      if (!tool) throw new Error(`No local tool named "${name}"`);
      return await tool.run(input, opts);
    },
  };
}

export interface HttpToolHostOptions {
  /** Your route, served by `createS2SToolHandler` (or an equivalent). */
  endpoint: string;
  /** Extra headers (auth, session id) on every request. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Override `fetch` (tests, custom retry, non-browser runtimes). */
  fetchImpl?: typeof fetch;
  /**
   * Skip the GET and use these declarations instead. Handy when the token
   * was minted with the tools already baked in and you only need the
   * execution half of the bridge.
   */
  tools?: S2STool[];
}

/**
 * The browser half of the bridge: tool calls travel over HTTP to a host
 * living on your server (where the agent, the keys, and the database are).
 *
 * Pair with `createS2SToolHandler` from `glove-voice-s2s/server` — that's
 * the whole route.
 */
export function httpToolHost(opts: HttpToolHostOptions): S2SToolHost {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = async (): Promise<Record<string, string>> => ({
    "Content-Type": "application/json",
    ...(typeof opts.headers === "function" ? await opts.headers() : opts.headers ?? {}),
  });

  return {
    async listTools() {
      if (opts.tools) return opts.tools;
      const res = await doFetch(opts.endpoint, { method: "GET", headers: await headers() });
      const data = (await res.json().catch(() => ({}))) as { tools?: S2STool[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `tool list failed (${res.status})`);
      return data.tools ?? [];
    },
    async callTool(name, input, callOpts) {
      const res = await doFetch(opts.endpoint, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({ name, input }),
        signal: callOpts?.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
      if (!res.ok) throw new Error(data.error ?? `tool call failed (${res.status})`);
      if (data.error) throw new Error(data.error);
      return data.result;
    },
  };
}

/**
 * Merge hosts into one. Declarations concatenate (first wins on a name
 * collision) and calls route to whichever host declared the name — so a
 * browser-side `scroll_to` and a server-side worker delegation coexist
 * without the session knowing they live in different places.
 */
export function composeToolHosts(...hosts: S2SToolHost[]): S2SToolHost {
  let routes: Map<string, S2SToolHost> | null = null;

  const resolve = async () => {
    const seen = new Map<string, S2SToolHost>();
    const declared: S2STool[] = [];
    for (const host of hosts) {
      for (const tool of await host.listTools()) {
        if (seen.has(tool.name)) continue;
        seen.set(tool.name, host);
        declared.push(tool);
      }
    }
    routes = seen;
    return declared;
  };

  return {
    listTools: resolve,
    async callTool(name, input, opts) {
      if (!routes) await resolve();
      const host = routes?.get(name);
      if (!host) throw new Error(`No tool named "${name}" in any composed host`);
      return await host.callTool(name, input, opts);
    },
  };
}
