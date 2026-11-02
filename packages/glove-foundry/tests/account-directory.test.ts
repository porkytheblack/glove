import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Effect, Layer, Schema } from "effect";
import { defineApplication } from "../src/application.js";
import { defineAgentApplication, install } from "../src/capabilities.js";
import { composeAgent } from "../src/composition.js";
import { defineConnection } from "../src/connection.js";
import { discoverAgents } from "../src/discovery.js";
import { AccountReference, InboundRoute } from "../src/domain.js";
import { defineTransmission, defineTransmissionEvent } from "../src/integration.js";
import {
  composePlaybook,
  composedPlaybookRevision,
  definePlaybookAction,
  materializeComposedPlaybook,
} from "../src/playbook.js";
import { MemoryFoundryDataAdapter, createAgentInstance } from "../src/primitives.js";
import { FoundryRuntime } from "../src/runtime.js";
import {
  AccountDirectory,
  AccountNotFound,
  memoryEventStore,
  memoryTopologyStore,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");
const agentsDir = resolve(rootDir, "agents");

test("an account the application's own directory adds at runtime gets its connection", async () => {
  const mailArrived = defineTransmissionEvent({ id: "mail-arrived", direction: "inbound" });
  const triage = definePlaybookAction({ id: "triage" });
  const mail = defineTransmission({
    id: "mail",
    name: "Mail",
    description: "New mail in a person's mailbox",
    account: { required: true, metadata: Schema.Struct({ email: Schema.String }) },
    events: [mailArrived],
    inbound: {
      config: Schema.Struct({}),
      event: Schema.Struct({ type: Schema.String, subject: Schema.String }),
      classify: () => Effect.succeed(mailArrived),
    },
  });
  const opened: string[] = [];
  const watcher = defineConnection({
    id: "watcher",
    description: "Watches one mailbox",
    transmissions: [mail],
    connect: (context) => Effect.gen(function* () {
      opened.push(`${context.account?.id}:${context.account?.metadata.email}`);
      yield* context.ready();
      yield* Effect.never;
    }),
  });
  const mailApp = defineAgentApplication({
    id: "mail-app",
    description: "Mail",
    inbound: [mail],
    connections: [watcher],
  });

  // The application's own account store, filled by its OAuth flow. Foundry
  // only reads it.
  const accounts = new Map<string, AccountReference>();
  const directory = Layer.succeed(AccountDirectory, {
    get: (id) => {
      const account = accounts.get(id);
      return account ? Effect.succeed(account) : Effect.fail(new AccountNotFound({ accountId: id }));
    },
    list: () => Effect.succeed([...accounts.values()]),
  });

  const route = Schema.decodeUnknownSync(InboundRoute)({
    id: "ada-mail",
    transmissionId: "mail",
    accountId: "ada-google",
    direction: "inbound",
    visibility: "private",
    enabled: true,
    config: {},
  });
  const composed = composePlaybook({
    name: "ada-mail",
    transmission: mail,
    match: { event: mailArrived, routes: [route] },
    directives: [{ action: triage, instruction: "Triage the new mail." }],
    applications: [mailApp],
  });
  const playbook = materializeComposedPlaybook(composed, "ada-mail", composedPlaybookRevision(composed));
  const [base] = await discoverAgents({ agentsDir });
  const definition = Object.freeze({ ...base!.definition, components: composeAgent(mailApp) });
  const instance = createAgentInstance(base!.route, {
    id: "ada-assistant",
    workspaceId: "ada",
    installations: [{ ...install(mailApp), accountId: "ada-google" }],
    playbooks: [playbook],
  });
  const runtime = new FoundryRuntime({
    rootDir,
    agents: [{ ...base!, definition }],
    application: defineApplication({
      name: "Account directory test",
      data: new MemoryFoundryDataAdapter({ agents: [instance] }),
      services: Layer.mergeAll(directory, memoryTopologyStore, memoryEventStore),
    }),
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
  });

  // Ada connects her mailbox after the application started.
  accounts.set("ada-google", Schema.decodeUnknownSync(AccountReference)({
    id: "ada-google",
    transmissionId: "mail",
    externalAccountId: "ada@example.com",
    accessRef: "tokens://ada/google",
    metadata: { email: "ada@example.com" },
  }));
  await runtime.putRoute(route);
  await runtime.start();
  try {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    assert.deepEqual(opened, ["ada-google:ada@example.com"]);
    assert.equal(runtime.listApplicationConnections()[0]?.accountId, "ada-google");
  } finally {
    await runtime.stop();
  }
});
