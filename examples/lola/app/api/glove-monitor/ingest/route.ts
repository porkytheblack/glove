import { createMonitorRouteHandler } from "glove-monitor-client/server"

export const POST = process.env.GLOVE_MONITOR_URL
  ? createMonitorRouteHandler({
      url: process.env.GLOVE_MONITOR_URL,
      registrationToken: process.env.GLOVE_MONITOR_REG_TOKEN!,
      app: "lola",
      getUserId: async () => "lola-demo-user",
      subscriberOverrides: { onError: (err) => console.warn("[glove-monitor relay]", err) },
    })
  : async () => new Response(JSON.stringify({ ok: true, accepted: 0, skipped: "monitor not configured" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
