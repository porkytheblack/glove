# glove-mcp-sse-stub

A minimal MCP server that **only** speaks the deprecated HTTP+SSE transport,
plus a smoke test that connects to it through `glove-mcp` — both with explicit
`transport: "sse"` and with the default `"auto"` fallback path.

Use this as a reference shape for talking to legacy / embedded MCP servers
(robot controllers, lab equipment, older self-hosted servers) that haven't
migrated to Streamable HTTP yet.

## Layout

- `stub-server.ts` — SSE MCP server exposing `get_status` and `move(x, y, z)`.
- `smoke-test.ts` — starts the stub in-process, runs `connectMcp` against it
  twice (explicit SSE, then auto-fallback), and asserts the tool round-trip.

## Run

```sh
# end-to-end smoke (default)
pnpm test

# standalone server, e.g. to poke at it with curl or another MCP client
PORT=4444 pnpm start:server
```
