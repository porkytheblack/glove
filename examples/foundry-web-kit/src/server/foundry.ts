import { createFoundryClient, type FoundryClient } from "glove-foundry/client";
import type { FoundryRouteMap } from "glove-foundry";

// The app's server is Foundry's only caller. Foundry listens on loopback in
// the same unit and takes one operator token, so the token stays here and the
// browser never talks to Foundry.

export type Foundry = FoundryClient<FoundryRouteMap>;

/** Where Foundry is and how to authorize: FOUNDRY_URL (default 127.0.0.1:4141) and FOUNDRY_TOKEN. */
export function foundryConnection(): { readonly baseUrl: string; readonly headers: Readonly<Record<string, string>> } {
  const token = process.env.FOUNDRY_TOKEN;
  return {
    baseUrl: (process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141").replace(/\/$/, ""),
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

let client: Foundry | undefined;

/** The typed Foundry client, with the operator token. Server only. */
export function foundry(): Foundry {
  if (client) return client;
  const { baseUrl, headers } = foundryConnection();
  client = createFoundryClient({
    baseUrl,
    ...(headers.authorization ? { authorization: { identifier: "web", headers: () => headers } } : {}),
  });
  return client;
}
