import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import { AgentBinding, OutboundRoute } from "../src/domain.js";
import { fileTopologyStore } from "../src/file-data.js";
import { TopologyStore } from "../src/services.js";

test("routes and bindings written at runtime survive a restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foundry-topology-"));
  const file = join(dir, "topology.json");
  const route = Schema.decodeUnknownSync(OutboundRoute)({
    id: "ada-gmail-out",
    transmissionId: "gmail",
    accountId: "ada-gmail",
    direction: "outbound",
    visibility: "private",
    enabled: true,
    config: {},
  });
  const binding = Schema.decodeUnknownSync(AgentBinding)({
    id: "ada-main-gmail",
    agentId: "ada-main",
    transmissionId: "gmail",
    accountId: "ada-gmail",
    routeId: route.id,
    capabilities: ["gmail:send"],
    enabled: true,
  });
  const run = <A>(program: Effect.Effect<A, unknown, TopologyStore>) =>
    Effect.runPromise(Effect.provide(program, fileTopologyStore(file)));
  try {
    await run(Effect.gen(function* () {
      const topology = yield* TopologyStore;
      yield* topology.putRoute(route);
      yield* topology.putBinding(binding);
    }));
    assert.equal((await stat(file)).mode & 0o777, 0o600, "the file is private to the process owner");

    const restored = await run(Effect.gen(function* () {
      const topology = yield* TopologyStore;
      return {
        routes: yield* topology.listRoutes({ accountId: "ada-gmail" }),
        bindings: yield* topology.listBindings({ agentId: "ada-main" }),
      };
    }));
    assert.deepEqual(restored.routes, [route]);
    assert.deepEqual(restored.bindings, [binding]);

    await run(Effect.gen(function* () {
      const topology = yield* TopologyStore;
      yield* topology.removeBinding(binding.id);
      yield* topology.removeRoute(route.id);
    }));
    const emptied = await run(Effect.gen(function* () {
      const topology = yield* TopologyStore;
      return [...(yield* topology.listRoutes()), ...(yield* topology.listBindings())];
    }));
    assert.deepEqual(emptied, []);
    await assert.rejects(run(Effect.gen(function* () {
      yield* (yield* TopologyStore).removeRoute(route.id);
    })), /RouteNotFound/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
