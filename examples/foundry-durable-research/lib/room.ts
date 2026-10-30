import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { RealtimeSession } from "glove-realtime";

/** Local, single-session text transport. RealtimeSession still owns the model loop. */
export async function openRoom(session: Pick<RealtimeSession, "say">, token: string, end: () => void, port = 8787) {
  const page = await readFile(new URL("./room.html", import.meta.url));
  const streams = new Set<ServerResponse>();
  const publish = (role: string, text: string) => {
    for (const stream of streams) stream.write(`${JSON.stringify({ role, text })}\n`);
  };
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(page); return;
      }
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401); response.end(); return;
      }
      if (request.method === "GET" && request.url === "/events") {
        response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
        response.flushHeaders(); streams.add(response);
        response.write(`${JSON.stringify({ role: "system", text: "Connected. Ask for vendor research, then keep chatting." })}\n`);
        request.on("close", () => streams.delete(response)); return;
      }
      if (request.method === "POST" && request.url === "/say") {
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 16_000) { response.writeHead(413); response.end(); return; }
        }
        const { text } = JSON.parse(body) as { text?: unknown };
        if (typeof text !== "string" || !text.trim()) { response.writeHead(400); response.end(); return; }
        await session.say(text);
        response.writeHead(202); response.end(); return;
      }
      if (request.method === "POST" && request.url === "/end") {
        response.writeHead(200); response.end(); end(); return;
      }
      response.writeHead(404); response.end();
    })().catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500);
      response.end("The request failed.");
      publish("error", error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    port: (server.address() as import("node:net").AddressInfo).port,
    publish,
    async close() {
      for (const stream of streams) stream.end();
      streams.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
      });
    },
  };
}
