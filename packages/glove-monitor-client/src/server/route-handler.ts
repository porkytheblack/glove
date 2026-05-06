import { MonitorSubscriber, type MonitorSubscriberOptions } from "../subscriber.js"
import type { IngestEvent } from "../shared/types.js"

// Re-export so consumers don't need a second import for the event shape.
export type { IngestEvent }

export interface MonitorRouteHandlerOptions {
  url: string
  registrationToken: string
  /** Default app namespace for events that don't carry one (or to override the browser's value). */
  app?: string
  /**
   * Resolve the authenticated user's id from the request. Returning `null`
   * causes the handler to respond 401. The returned value overrides any
   * `user_id` supplied in the body.
   */
  getUserId: (req: Request) => Promise<string | null> | string | null
  /** Optional override of the underlying MonitorSubscriber knobs (testing). */
  subscriberOverrides?: Partial<MonitorSubscriberOptions>
  /** Optional async hook called for each ingested event for server-side audit / shadow logging. */
  onEvent?: (info: { userId: string; conversationId: string; event: IngestEvent }) => void
}

interface RelayBody {
  app?: string
  conversation_id?: string
  events?: IngestEvent[]
}

/**
 * Singleton MonitorSubscriber per (url+registrationToken+app), stashed on
 * `globalThis` so Next.js dev hot-reloads (which throw away module-level
 * state) reuse the existing DCR'd credentials and queue rather than
 * re-registering on every save.
 */
const SUBS_KEY = Symbol.for("glove-monitor-client.subscribers")
type SubsCache = Map<string, MonitorSubscriber>
function getCache(): SubsCache {
  const g = globalThis as unknown as Record<symbol, SubsCache | undefined>
  if (!g[SUBS_KEY]) g[SUBS_KEY] = new Map()
  return g[SUBS_KEY]!
}

function getOrCreateSubscriber(opts: MonitorRouteHandlerOptions): MonitorSubscriber {
  const cache = getCache()
  const key = `${opts.url}::${opts.registrationToken}::${opts.app ?? ""}`
  const existing = cache.get(key)
  if (existing) return existing
  const sub = new MonitorSubscriber({
    url: opts.url,
    registrationToken: opts.registrationToken,
    app: opts.app ?? "default",
    // The relay handler is the only thing that touches this MonitorSubscriber;
    // user_id and conversation_id are supplied per-call via sendDirect(), not
    // via the constructor's getUserId/conversationId factories.
    ...(opts.subscriberOverrides ?? {}),
  })
  cache.set(key, sub)
  return sub
}

/**
 * Web-standard `Request` → `Response` handler. Works in:
 *   - Next.js App Router route handlers (export const POST = createMonitorRouteHandler(...))
 *   - Hono / Cloudflare Workers / Bun / Deno
 *
 * Behaviour:
 *   - Validates body shape; 400 on malformed.
 *   - Calls `getUserId(req)`; 401 if it returns null/undefined.
 *   - Always overrides `user_id` with the server-resolved value (browser is
 *     not trusted).
 *   - Forwards events to a singleton MonitorSubscriber (credential cache +
 *     queue + DCR are reused across requests).
 *   - 503 if the upstream is unreachable.
 */
export function createMonitorRouteHandler(opts: MonitorRouteHandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 })
    }

    let body: RelayBody
    try {
      body = await req.json() as RelayBody
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 })
    }

    if (!body.conversation_id || !Array.isArray(body.events) || body.events.length === 0) {
      return Response.json({ error: "invalid_request" }, { status: 400 })
    }

    const userId = await opts.getUserId(req)
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401 })
    }

    const subscriber = getOrCreateSubscriber(opts)
    try {
      await subscriber.sendDirect({
        app: opts.app ?? body.app ?? "default",
        conversation_id: body.conversation_id,
        user_id: userId,
        events: body.events,
      })
      if (opts.onEvent) {
        for (const event of body.events) opts.onEvent({ userId, conversationId: body.conversation_id, event })
      }
      return Response.json({ ok: true, accepted: body.events.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return Response.json({ error: "upstream_failed", error_description: message }, { status: 503 })
    }
  }
}

// ─── Hono adapter ─────────────────────────────────────────────────────

/**
 * Convenience wrapper for Hono apps. Same options as
 * `createMonitorRouteHandler` but returns a Hono-shaped `(c) => Response`
 * handler so existing Hono routes can mount it directly:
 *
 *     app.post("/api/glove-monitor/ingest", createMonitorHonoHandler({ ... }))
 *
 * Internally this just unwraps the Hono context to a Web Request and
 * delegates to the Web-standard handler.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMonitorHonoHandler(opts: MonitorRouteHandlerOptions): (c: any) => Promise<Response> {
  const handler = createMonitorRouteHandler(opts)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (c: any) => handler(c.req.raw as Request)
}
