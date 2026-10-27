import "server-only";
import { devSignIn, foundry } from "glove-foundry-web-kit/server";
import { host } from "./host";

/**
 * Who the development sign-in offers: Rosa, and anyone else with a Muse on
 * this Foundry (`pnpm onboard`). Only in development with no
 * WEB_SESSION_SECRET; otherwise nobody, and invite links are the way in.
 */
export async function demoPeople(): Promise<ReadonlyArray<{ readonly id: string; readonly name: string }>> {
  if (!devSignIn()) return [];
  const { people } = await host();
  const others = await foundry().agentInstances("muse").catch(() => []);
  const found = new Map<string, string>([[people.ROSA.id, people.ROSA.name]]);
  for (const muse of others) {
    if (!found.has(muse.workspaceId)) found.set(muse.workspaceId, typeof muse.context.name === "string" ? muse.context.name : muse.workspaceId);
  }
  return [...found].map(([id, name]) => ({ id, name }));
}
