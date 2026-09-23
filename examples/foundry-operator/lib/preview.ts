import { createServer } from "node:http";
import type { Resources } from "./resource-client.js";
import { shellQuote } from "./http.js";
import { port } from "./settings.js";
/** HTTP GET bridge: execute a bounded fetch inside the container. No published Docker ports or host mounts. */
export function previewServer(resources: Resources) {
  return createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("content-security-policy", "sandbox allow-scripts; default-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'");
    if (![ `127.0.0.1:${port + 3}`, `localhost:${port + 3}` ].includes(request.headers.host ?? "") || request.method !== "GET") { response.writeHead(403).end(); return; }
    try {
      const box = (await resources.sandbox.list())[0];
      if (!box) throw new Error("No workspace");
      const path = new URL(request.url ?? "/", "http://preview").pathname + new URL(request.url ?? "/", "http://preview").search;
      // Host fixes the destination; sandbox-supplied HTML cannot turn this into a host proxy.
      const source = `const r=await fetch(${JSON.stringify(`http://127.0.0.1:3000${path}`)},{redirect:'error',signal:AbortSignal.timeout(5000)});const reader=r.body.getReader();const parts=[];let n=0;while(true){const x=await reader.read();if(x.done)break;n+=x.value.length;if(n>262144)throw Error('Preview too large');parts.push(x.value)}console.log(JSON.stringify({status:r.status,type:r.headers.get('content-type'),body:Buffer.concat(parts).toString('base64')}));`;
      let command = await resources.sandbox.exec(box.id, { command: `node --input-type=module -e ${shellQuote(source)}`, timeoutMs: 8000 });
      const deadline = Date.now() + 10000;
      while (command.status === "running" && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 100)); command = await resources.sandbox.command(box.id, command.id); }
      if (command.status !== "completed" || command.exitCode !== 0 || command.truncated) throw new Error("Preview unavailable");
      const result = JSON.parse(command.stdout) as { status: number; type: string | null; body: string };
      response.writeHead(result.status, { "content-type": result.type ?? "application/octet-stream" }); response.end(Buffer.from(result.body, "base64"));
    } catch { response.writeHead(503, { "content-type": "text/plain" }); response.end("No server is responding on workspace port 3000 yet. Ask Operator to build and start one."); }
  });
}
