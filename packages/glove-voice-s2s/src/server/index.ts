// Server-side helpers — API keys never reach the browser (the same token
// pattern as glove-voice/server), plus the server half of the tool bridge.

import type { S2STool } from "../types";
import type { S2SToolHost } from "../tool-host";

export {
  gloveToolHost,
  delegateToolHost,
  localToolHost,
  composeToolHosts,
  type S2SToolHost,
  type S2SCallOptions,
  type GloveToolHostOptions,
  type DelegateToolHostOptions,
  type LocalS2STool,
} from "../tool-host";

/** Tools as a plain list, or any host that can declare its own. */
export type S2SToolSource = S2STool[] | S2SToolHost;

async function resolveTools(source?: S2SToolSource): Promise<S2STool[]> {
  if (!source) return [];
  return Array.isArray(source) ? source : await source.listTools();
}

export interface RealtimeTokenConfig {
  /** Your OpenAI API key (server-side only). */
  apiKey: string;
  /** Realtime model (default "gpt-realtime"). */
  model?: string;
  /** System prompt baked into the session at mint time. */
  instructions?: string;
  /** Output voice (e.g. "marin", "cedar"). */
  voice?: string;
  /**
   * Function tools the model may call. Pass a `S2SToolHost` — e.g.
   * `gloveToolHost(glove)` or `delegateToolHost(worker)` — to DERIVE the
   * declarations from the agent that will actually run them, instead of
   * maintaining a second hand-written JSON-Schema list that drifts.
   */
  tools?: S2SToolSource;
  /**
   * Turn detection. Default: semantic VAD — the model decides from LISTENING
   * whether the speaker is done, replacing client-side endpointing entirely.
   */
  turnDetection?: Record<string, unknown>;
  /** Model for user-audio transcription events (default gpt-4o-mini-transcribe). */
  transcriptionModel?: string;
  /** API base (default https://api.openai.com/v1). */
  baseUrl?: string;
}

/**
 * Mint an ephemeral client secret for a browser Realtime session
 * (POST /v1/realtime/client_secrets). Session config is baked in at mint
 * time, so the client can't escalate its own permissions or prompt.
 */
export async function createOpenAIRealtimeToken(
  cfg: RealtimeTokenConfig,
): Promise<{ token: string; expiresAt: number | null }> {
  const base = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const session: Record<string, unknown> = {
    type: "realtime",
    model: cfg.model ?? "gpt-realtime",
    audio: {
      input: {
        transcription: { model: cfg.transcriptionModel ?? "gpt-4o-mini-transcribe" },
        turn_detection: cfg.turnDetection ?? { type: "semantic_vad" },
      },
      ...(cfg.voice ? { output: { voice: cfg.voice } } : {}),
    },
  };
  if (cfg.instructions) session.instructions = cfg.instructions;
  const tools = await resolveTools(cfg.tools);
  if (tools.length) {
    session.tools = tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  const res = await fetch(`${base}/realtime/client_secrets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session }),
  });
  if (!res.ok) {
    throw new Error(
      `realtime client_secrets failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as {
    value?: string;
    client_secret?: { value?: string; expires_at?: number };
    expires_at?: number;
  };
  const token = data.value ?? data.client_secret?.value;
  if (!token) throw new Error("realtime client_secrets returned no token");
  return { token, expiresAt: data.expires_at ?? data.client_secret?.expires_at ?? null };
}

// ─── Tool bridge (server half) ───────────────────────────────────────────────

export interface S2SToolHandlerOptions {
  /**
   * Gate every request. Return `false` (or throw) to reject — the session is
   * driven from the browser, so this is the only place an untrusted caller
   * is stopped from invoking your agent's tools.
   */
  authorize?: (req: Request) => boolean | Promise<boolean>;
  /** Called on every executed tool call. Handy for timing metrics. */
  onCall?: (info: { name: string; input: unknown; ms: number; ok: boolean }) => void;
}

/**
 * The whole server side of an S2S tool bridge, as one fetch handler.
 *
 * `GET` returns the host's declarations (what `httpToolHost` publishes into
 * the session); `POST { name, input }` executes one call and returns
 * `{ result }`. Framework-agnostic — it takes a `Request` and returns a
 * `Response`, so a Next.js route handler is two exports:
 *
 * ```ts
 * // app/api/s2s/tools/route.ts
 * const handler = createS2SToolHandler(() => delegateToolHost(workerAgent()));
 * export const GET = handler;
 * export const POST = handler;
 * ```
 *
 * Pass a factory (as above) rather than a host when the agent is built
 * lazily — it is resolved once, on first use.
 */
export function createS2SToolHandler(
  host: S2SToolHost | (() => S2SToolHost | Promise<S2SToolHost>),
  opts: S2SToolHandlerOptions = {},
): (req: Request) => Promise<Response> {
  let resolved: Promise<S2SToolHost> | null = null;
  const getHost = () => {
    if (!resolved) resolved = Promise.resolve(typeof host === "function" ? host() : host);
    return resolved;
  };

  return async (req: Request): Promise<Response> => {
    if (opts.authorize) {
      let ok = false;
      try {
        ok = await opts.authorize(req);
      } catch {
        ok = false;
      }
      if (!ok) return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    if (req.method === "GET") {
      try {
        return Response.json({ tools: await (await getHost()).listTools() });
      } catch (err) {
        return Response.json({ error: (err as Error)?.message ?? "tool list failed" }, { status: 500 });
      }
    }

    if (req.method !== "POST") {
      return Response.json({ error: `method ${req.method} not allowed` }, { status: 405 });
    }

    let name: string;
    let input: unknown;
    try {
      const body = (await req.json()) as { name?: string; input?: unknown };
      name = String(body.name ?? "");
      input = body.input ?? {};
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (!name) return Response.json({ error: "name is required" }, { status: 400 });

    const t0 = Date.now();
    try {
      const result = await (await getHost()).callTool(name, input, { signal: req.signal });
      opts.onCall?.({ name, input, ms: Date.now() - t0, ok: true });
      return Response.json({ result });
    } catch (err) {
      opts.onCall?.({ name, input, ms: Date.now() - t0, ok: false });
      return Response.json(
        { error: (err as Error)?.message ?? `tool "${name}" failed` },
        { status: 500 },
      );
    }
  };
}

export interface S2STokenHandlerOptions extends Omit<RealtimeTokenConfig, "apiKey"> {
  /** Defaults to `process.env.OPENAI_API_KEY`. */
  apiKey?: string;
}

/**
 * Mint-a-token route, as one fetch handler:
 *
 * ```ts
 * // app/api/voice/s2s-token/route.ts
 * export const POST = createS2STokenHandler({
 *   instructions: NOVA_PERSONA,
 *   voice: "marin",
 *   tools: delegateToolHost(workerAgent()),
 * });
 * ```
 *
 * The session config is baked in at mint time, so a browser holding the
 * token can't rewrite its own persona or grant itself tools.
 */
export function createS2STokenHandler(
  opts: S2STokenHandlerOptions | (() => S2STokenHandlerOptions | Promise<S2STokenHandlerOptions>),
): (req?: Request) => Promise<Response> {
  return async (): Promise<Response> => {
    const cfg = typeof opts === "function" ? await opts() : opts;
    const apiKey =
      cfg.apiKey ?? (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env?.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "No OPENAI_API_KEY — the Realtime API needs one server-side." },
        { status: 501 },
      );
    }
    try {
      const { token, expiresAt } = await createOpenAIRealtimeToken({ ...cfg, apiKey });
      return Response.json({ token, expiresAt });
    } catch (err) {
      return Response.json({ error: (err as Error)?.message ?? "token mint failed" }, { status: 500 });
    }
  };
}
