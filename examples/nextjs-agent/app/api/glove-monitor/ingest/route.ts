import { createMonitorRouteHandler } from "glove-monitor-client/server"

const url = process.env.GLOVE_MONITOR_URL
const registrationToken = process.env.GLOVE_MONITOR_REG_TOKEN

export const POST = url && registrationToken
  ? createMonitorRouteHandler({
      url,
      registrationToken,
      app: "nextjs-agent",
      getUserId: async () => "nextjs-demo-user",
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
