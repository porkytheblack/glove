import { createMonitorRouteHandler } from "glove-monitor-client/server"

/**
 * Relay endpoint for the browser-side `BrowserMonitorSubscriber`. Holds the
 * DCR'd credentials server-side and forwards events upstream with a
 * server-trusted `user_id` (browser-supplied user_id is ignored).
 *
 * Skips silently when telemetry isn't fully configured — both `GLOVE_MONITOR_URL`
 * and `GLOVE_MONITOR_REG_TOKEN` must be set, or the relay returns a 200 stub
 * so the demo stays runnable. Half-configured states (URL set but token
 * missing) would otherwise crash the relay on first ingest.
 */
const url = process.env.GLOVE_MONITOR_URL
const registrationToken = process.env.GLOVE_MONITOR_REG_TOKEN

export const POST = url && registrationToken
  ? createMonitorRouteHandler({
      url,
      registrationToken,
      app: "coffee",
      // Demo build has no real auth — return a stable id so the dashboard
      // can group sessions per "user". Replace with `getServerSession(req)`
      // wiring in a real deployment.
      getUserId: async () => "coffee-demo-user",
      subscriberOverrides: { onError: (err) => console.warn("[glove-monitor relay]", err) },
    })
  : async () => {
      if (url && !registrationToken) {
        console.warn("[glove-monitor relay] GLOVE_MONITOR_URL is set but GLOVE_MONITOR_REG_TOKEN is missing — relay disabled")
      }
      return new Response(JSON.stringify({ ok: true, accepted: 0, skipped: "monitor not configured" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
