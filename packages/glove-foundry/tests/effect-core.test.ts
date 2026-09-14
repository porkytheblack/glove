import assert from "node:assert/strict";
import { test } from "node:test";
import { Context, Effect, Layer, Schema } from "effect";
import {
  AccountDirectory,
  AccountReference,
  AgentBinding,
  GrantResolver,
  OutboundRoute,
  TopologyStore,
  compileApplicationManifest,
  defineTransmission,
  grantResolverLive,
  memoryAccountDirectory,
  memoryTopologyStore,
  type AccountSessionAdapter,
  type InferInboundEvent,
} from "../src/index.js";

const account = Schema.decodeUnknownSync(AccountReference)({
  id: "account-1",
  transmissionId: "mail",
  externalAccountId: "external-1",
  label: "Support inbox",
  accessRef: "vault://tenant/accounts/1",
  metadata: { address: "support@example.test" },
});

test("account directory exposes metadata without credential lifecycle methods", async () => {
  const program = Effect.gen(function* () {
    const directory = yield* AccountDirectory;
    const found = yield* directory.get(account.id);
    const missing = yield* Effect.flip(
      directory.get(Schema.decodeUnknownSync(AccountReference.fields.id)("missing")),
    );
    return { directory, found, missing };
  }).pipe(Effect.provide(memoryAccountDirectory([account])));

  const result = await Effect.runPromise(program);
  assert.equal(result.found.label, "Support inbox");
  assert.equal(result.missing._tag, "AccountNotFound");
  assert.deepEqual(Object.keys(result.directory).sort(), ["get", "list"]);
});

class MailSession extends Context.Tag("test/MailSession")<
  MailSession,
  { readonly address: string }
>() {}

test("account sessions are adapter-owned, operation-scoped Effect layers", async () => {
  let acquired = 0;
  let released = 0;
  const adapter: AccountSessionAdapter<MailSession> = {
    layer: ({ account: selected }) =>
      Layer.scoped(
        MailSession,
        Effect.acquireRelease(
          Effect.sync(() => {
            acquired += 1;
            return { address: String(selected.metadata.address) };
          }),
          () =>
            Effect.sync(() => {
              released += 1;
            }),
        ),
      ),
  };

  const address = await Effect.runPromise(
    Effect.gen(function* () {
      return (yield* MailSession).address;
    }).pipe(
      Effect.provide(
        adapter.layer({ account, operation: "mail:send" }),
      ),
    ),
  );

  assert.equal(address, "support@example.test");
  assert.equal(acquired, 1);
  assert.equal(released, 1);
  assert.deepEqual(Object.keys(adapter), ["layer"]);
});

test("enabled bindings compile into deterministic, immutable run grants", async () => {
  const route = Schema.decodeUnknownSync(OutboundRoute)({
    id: "route-1",
    transmissionId: "mail",
    accountId: account.id,
    direction: "outbound",
    visibility: "private",
    enabled: true,
    config: { mailbox: "support" },
  });
  const binding = Schema.decodeUnknownSync(AgentBinding)({
    id: "binding-1",
    agentId: "support/triage",
    transmissionId: "mail",
    accountId: account.id,
    routeId: route.id,
    capabilities: ["mail:send"],
    reply: { mode: "route", routeId: route.id },
    enabled: true,
  });
  const layer = Layer.merge(
    memoryTopologyStore,
    grantResolverLive.pipe(Layer.provide(memoryTopologyStore)),
  );
  const grant = await Effect.runPromise(
    Effect.gen(function* () {
      const topology = yield* TopologyStore;
      yield* topology.putRoute(route);
      yield* topology.putBinding(binding);
      return yield* (yield* GrantResolver).resolve({
        runId: Schema.decodeUnknownSync(
          Schema.NonEmptyTrimmedString.pipe(Schema.brand("FoundryRunId")),
        )("run-1"),
        agentId: binding.agentId,
      });
    }).pipe(Effect.provide(layer)),
  );

  assert.deepEqual(grant.accountIds, [account.id]);
  assert.deepEqual(grant.outboundRouteIds, [route.id]);
  assert.deepEqual(grant.capabilities, ["mail:send"]);
  assert.deepEqual(grant.reply, { mode: "route", routeId: route.id });
});

const mail = defineTransmission({
  id: "mail",
  name: "Mail",
  description: "Mail transport",
  account: {
    required: true,
    metadata: Schema.Struct({ address: Schema.String }),
  },
  capabilities: [
    {
      id: "mail:send",
      description: "Send a message",
      account: "required",
      effect: "write",
    },
  ],
  inbound: {
    config: Schema.Struct({ mailbox: Schema.String }),
    event: Schema.Struct({ subject: Schema.String, body: Schema.String }),
  },
});

type MailEvent = InferInboundEvent<typeof mail>;
const inferredEvent: MailEvent = { subject: "Hello", body: "World" };

test("transmission definitions preserve schema inference and compile leak-free manifests", async () => {
  assert.equal(inferredEvent.subject, "Hello");
  const manifest = await Effect.runPromise(compileApplicationManifest([mail]));
  const serialized = JSON.stringify(manifest);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.transmissions[0]?.shape, "inbound-only");
  assert.equal(serialized.includes("accessRef"), false);
  assert.equal(serialized.includes("vault://"), false);
});

test("transmission schemas cannot smuggle credential material into Foundry", () => {
  assert.throws(
    () =>
      defineTransmission({
        id: "unsafe",
        name: "Unsafe",
        description: "Invalid integration",
        account: {
          required: true,
          metadata: Schema.Struct({ accessToken: Schema.String }),
        },
      }),
    /opaque accessRef/,
  );
});
