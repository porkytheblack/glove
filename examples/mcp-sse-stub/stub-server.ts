import { createServer } from "node:http";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export function buildRobotServer(): McpServer {
  const server = new McpServer({ name: "robot-stub", version: "0.0.1" });

  server.registerTool(
    "get_status",
    {
      description: "Get the robot's current status, battery, and position.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "Robot OK. Battery 87%. Position (1.20, 3.40, 5.60).",
        },
      ],
    }),
  );

  server.registerTool(
    "move",
    {
      description: "Move the robot arm to absolute (x, y, z) coordinates in meters.",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        z: z.number(),
      },
    },
    async ({ x, y, z }) => ({
      content: [
        {
          type: "text",
          text: `Moved to (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}).`,
        },
      ],
    }),
  );

  return server;
}

export interface StubServerHandle {
  url: string;
  close: () => Promise<void>;
}

export async function startRobotServer(port = 0): Promise<StubServerHandle> {
  const server = buildRobotServer();
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/sse") {
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      res.on("close", () => transports.delete(transport.sessionId));
      try {
        await server.connect(transport);
      } catch (err) {
        console.error("[stub] connect failed:", err);
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/messages") {
      const sessionId = url.searchParams.get("sessionId");
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Unknown sessionId");
        return;
      }
      try {
        await transport.handlePostMessage(req, res);
      } catch (err) {
        console.error("[stub] post failed:", err);
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", () => resolve());
  });

  const address = httpServer.address();
  const actualPort =
    typeof address === "object" && address !== null ? address.port : port;

  return {
    url: `http://127.0.0.1:${actualPort}/sse`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of transports.values()) {
          try {
            t.close?.();
          } catch {
            // ignore
          }
        }
        httpServer.close(() => resolve());
      }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4444);
  const handle = await startRobotServer(port);
  console.log(`[stub] robot MCP server (SSE) listening at ${handle.url}`);
  process.on("SIGINT", async () => {
    await handle.close();
    process.exit(0);
  });
}
