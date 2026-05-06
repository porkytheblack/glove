import { Hono } from "hono"

export function healthRoutes(): Hono {
  const app = new Hono()
  app.get("/", (c) => c.json({ data: { ok: true, version: "0.1.0" } }))
  return app
}
