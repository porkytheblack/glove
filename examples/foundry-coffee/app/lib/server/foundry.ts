import { createFoundryClient } from "glove-foundry/client";

// Foundry listens on loopback and has no per-person auth, so the browser
// never talks to it: these route handlers do.

export const FOUNDRY_URL = (process.env.FOUNDRY_URL ?? "http://127.0.0.1:4310").replace(/\/+$/, "");

let client: ReturnType<typeof createFoundryClient> | undefined;

export function foundry() {
  client ??= createFoundryClient({ baseUrl: FOUNDRY_URL });
  return client;
}

export function unavailable(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: `Foundry is not reachable at ${FOUNDRY_URL}: ${message}` }, { status: 503 });
}
