import { createMonitorRouteHandler } from "glove-monitor-client/server"

/**
 * Relay endpoint for the browser-side `BrowserMonitorSubscriber`. Holds the
 * DCR'd credentials server-side and forwards events upstream with a
 * server-trusted `user_id` (browser-supplied user_id is ignored).
 *
 * Skips silently if `GLOVE_MONITOR_URL` is not configured — keeps the demo
 * runnable without standing up the monitor.
 */
export const POST = process.env.GLOVE_MONITOR_URL
  ? createMonitorRouteHandler({
      url: process.env.GLOVE_MONITOR_URL,
      registrationToken: process.env.GLOVE_MONITOR_REG_TOKEN!,
      app: "coffee",
      // Demo build has no real auth — return a stable id so the dashboard
      // can group sessions per "user". Replace with `getServerSession(req)`
      // wiring in a real deployment.
      getUserId: async () => "coffee-demo-user",
      subscriberOverrides: { onError: (err) => console.warn("[glove-monitor relay]", err) },
    })
  : async () => new Response(JSON.stringify({ ok: true, accepted: 0, skipped: "monitor not configured" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
