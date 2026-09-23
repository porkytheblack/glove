import type { IncomingMessage, ServerResponse } from "node:http";
export function allowedRequest(request: IncomingMessage, port: number) {
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host ?? "")) return false;
  const origin = request.headers.origin;
  if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) return false;
  return request.method === "GET" || request.method === "HEAD" || Boolean(origin);
}
export async function jsonBody(request: IncomingMessage) {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new Error("Expected JSON");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 65536) throw new Error("Request is too large"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
}
export function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value));
}
export function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }
