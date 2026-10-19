/**
 * Mini apps in Glove Foundry. `miniAppsLayer` returns the options for
 * Foundry's own `defineLayer`, so this module needs nothing from glove-foundry
 * at runtime (the pattern glove-classifier's Foundry helpers use):
 *
 * ```ts
 * // agents/assistant/layers/miniapps.layer.ts
 * import { defineLayer } from "glove-foundry";
 * import { miniAppsLayer } from "glove-miniapps/foundry";
 * import { host } from "../../../lib/miniapps";
 *
 * export default defineLayer(miniAppsLayer({ host }));
 * ```
 *
 * The agent then has the `glove_miniapps_*` tools and, before every turn, the
 * list of its apps. Apps belong to the agent instance by default
 * (`agent:<agentId>`), so they follow it from one conversation to the next.
 * The host can be local (`createAppHost`) or remote (`remoteAppHost`, e.g.
 * apps hosted on Kuiper) — the layer cannot tell.
 */

import { Effect } from "effect";
import type { AppHost } from "./host";
import { mountMiniApps, type MiniAppsMountable } from "./tools";
import type { Principal } from "./types";

/** The parts of Foundry's `FoundrySurfaceContext` this layer reads. */
export interface MiniAppsLayerContext {
  readonly agentId: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly glove: unknown;
}

export interface MiniAppsLayerOptions {
  host: AppHost;
  /** Who owns the apps this agent builds. Default `agent:<agentId>`. */
  principal?: (ctx: MiniAppsLayerContext) => Principal;
  /** One tool per method, for all apps or the named ones. Default false. */
  exposeMethods?: boolean | string[];
  description?: string;
}

export function miniAppsLayer(options: MiniAppsLayerOptions) {
  const principal = options.principal ?? ((ctx: MiniAppsLayerContext) => `agent:${ctx.agentId}`);
  return {
    description: options.description ?? "Mini apps: durable apps the agent builds for itself, as tools and runtime context",
    setup: (ctx: MiniAppsLayerContext) =>
      Effect.promise(async () => {
        const mounted = await mountMiniApps(ctx.glove as MiniAppsMountable, {
          host: options.host,
          as: principal(ctx),
          exposeMethods: options.exposeMethods,
        });
        return () => mounted.close();
      }),
  };
}
