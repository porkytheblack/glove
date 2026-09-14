import { Context, Effect, Layer } from "effect";
import {
  GrantResolutionError,
  type AccountId,
  type AgentId,
  type CapabilityId,
  type ReplyPolicy,
  type Route,
  type RouteId,
  type RunGrant,
  type RunId,
} from "./domain.js";
import { TopologyStore } from "./services.js";

export interface ResolveGrantRequest {
  readonly runId: RunId;
  readonly agentId: AgentId;
  /** The inbound route that caused the run, when one exists. */
  readonly originRouteId?: RouteId;
}

export class GrantResolver extends Context.Tag("@glove-foundry/GrantResolver")<
  GrantResolver,
  {
    readonly resolve: (
      request: ResolveGrantRequest,
    ) => Effect.Effect<RunGrant, GrantResolutionError>;
  }
>() {}

const replyKey = (policy: ReplyPolicy): string =>
  policy.mode === "route" ? `route:${policy.routeId}` : policy.mode;

/**
 * Resolve desired bindings into immutable authority for exactly one run.
 * Agents consume the resulting grant; they never query the topology directly.
 */
export const grantResolverLive: Layer.Layer<
  GrantResolver,
  never,
  TopologyStore
> = Layer.effect(
  GrantResolver,
  Effect.gen(function* () {
    const topology = yield* TopologyStore;
    return {
      resolve: (request) =>
        Effect.gen(function* () {
          const bindings = yield* topology.listBindings({
            agentId: request.agentId,
            enabled: true,
          });
          if (bindings.length === 0) {
            return yield* Effect.fail(
              new GrantResolutionError({
                runId: request.runId,
                agentId: request.agentId,
                reason: "agent has no enabled bindings",
              }),
            );
          }

          const routes = yield* topology.listRoutes({ enabled: true });
          const routeById = new Map<RouteId, Route>(
            routes.map((route) => [route.id, route]),
          );
          const accountIds = new Set<AccountId>();
          const capabilities = new Set<CapabilityId>();
          const outboundRouteIds = new Set<RouteId>();
          const replyPolicies = new Map<string, ReplyPolicy>();

          for (const binding of bindings) {
            if (binding.accountId) accountIds.add(binding.accountId);
            binding.capabilities.forEach((capability) =>
              capabilities.add(capability),
            );
            if (binding.routeId) {
              const route = routeById.get(binding.routeId);
              if (!route) {
                return yield* Effect.fail(
                  new GrantResolutionError({
                    runId: request.runId,
                    agentId: request.agentId,
                    reason: `binding "${binding.id}" references a missing or disabled route`,
                  }),
                );
              }
              if (route.accountId) accountIds.add(route.accountId);
              if (route.direction === "outbound") {
                outboundRouteIds.add(route.id);
              }
            }
            if (binding.reply) {
              replyPolicies.set(replyKey(binding.reply), binding.reply);
            }
          }

          if (replyPolicies.size > 1) {
            return yield* Effect.fail(
              new GrantResolutionError({
                runId: request.runId,
                agentId: request.agentId,
                reason: "enabled bindings declare conflicting reply policies",
              }),
            );
          }

          const explicitReply = replyPolicies.values().next().value as
            | ReplyPolicy
            | undefined;
          const reply: ReplyPolicy =
            explicitReply ??
            (request.originRouteId ? { mode: "origin" } : { mode: "none" });
          if (reply.mode === "route") {
            const route = routeById.get(reply.routeId);
            if (!route || route.direction !== "outbound") {
              return yield* Effect.fail(
                new GrantResolutionError({
                  runId: request.runId,
                  agentId: request.agentId,
                  reason: `reply route "${reply.routeId}" is missing, disabled, or not outbound`,
                }),
              );
            }
            outboundRouteIds.add(route.id);
            if (route.accountId) accountIds.add(route.accountId);
          }

          return {
            runId: request.runId,
            agentId: request.agentId,
            accountIds: [...accountIds].sort(),
            outboundRouteIds: [...outboundRouteIds].sort(),
            capabilities: [...capabilities].sort(),
            reply,
          } satisfies RunGrant;
        }).pipe(
          Effect.withSpan("foundry.grant.resolve", {
            attributes: {
              "foundry.run.id": request.runId,
              "foundry.agent.id": request.agentId,
            },
          }),
        ),
    };
  }),
);
