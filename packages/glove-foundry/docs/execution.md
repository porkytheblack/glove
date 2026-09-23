# Execution daemon, browsers and sandboxes

Foundry's control process owns agent definitions, instances, conversations, applications, policy and inspection. Agent jobs now execute through Station 3 in a **separate managed daemon process**. Foundry no longer constructs a `SignalRunner` in its control process.

```text
Foundry control process
  definitions / instances / conversations / approvals / observability
            │ private process transport
            ▼
Managed Station daemon
  ├─ execution queue / schedules → agent job subprocesses
  └─ optional resource adapters ← scoped mounts in agent jobs
       ├─ browser provider (for example Steel)
       └─ sandbox provider (for example Docker)
```

An application can host resources on this same Station or connect its mounts to external workers. Hosting resources is optional.

Node 22+ is required by Station 3 (22.13+ for SQLite memory). Existing `glove foundry dev` and `start` commands start the managed execution daemon automatically. Its API uses ephemeral host credentials, and generated signal entrypoints live in a private temporary directory. Keys and backend configuration do not enter agent manifests. The independent Station dashboard is not embedded in Foundry; Foundry retains its inspector.

The daemon owns job processes, queue access and recurring schedule execution. Foundry receives lifecycle/log events across the process boundary and retains its existing run IDs, cancellation, approvals, callbacks, sleep and schedule semantics. Agent identity is passed explicitly when loading definitions, so discovery of several agents does not race on environment variables.

## Lifecycle and current boundary

This implementation manages a local daemon per Foundry runtime. Stopping Foundry gracefully stops its daemon and agent jobs; losing the parent connection also shuts down the managed daemon. It does **not** yet attach agent jobs to an independently administered remote daemon or leave jobs running after the Foundry control process exits. Approvals and core callbacks still use private shared local files. Do not treat this as distributed control-plane failover.

The execution queue remains in-memory, as before. Persist instances, conversations, activations and workspace state through the application adapters. Foundry reconstructs persisted activations on startup; it does not restore an interrupted live agent process. Browser/sandbox workers configured through adapters have independent persistence and ownership. Scope cleanup does not shut down those external daemons.

Station 3 owns its idle polling backoff; Foundry's legacy `idlePollIntervalMs` option is retained for source compatibility but is not forwarded by Station's daemon API. `pollIntervalMs`, concurrency, attempts and retry backoff are forwarded.

## One Station for jobs and resources

Configure the managed daemon in `foundry.application.ts`. Resource providers are optional, application-owned adapters; they do not become agent definition fields or core dependencies.

```ts
import { defineApplication } from "glove-foundry";
import { stationDaemon } from "glove-foundry/station";

export default defineApplication({
  name: "Assistant",
  daemon: stationDaemon({
    stationId: "assistant",
    // Optional: omit port to allocate a free loopback port.
    port: 4244,
    resources: async () => ({
      browser: await createBrowserManager(),
      sandbox: await createSandboxAdapter(),
    }),
    onReady: connection => savePrivateConnection(connection),
  }),
});
```

The factory helpers and private connection storage above belong to the application. See [Operator's application](../../../examples/foundry-operator/foundry.application.ts) and [resource factory](../../../examples/foundry-operator/lib/resources.ts) for a complete Steel/Docker implementation.

`glove foundry start` loads the application file inside the managed execution process, invokes the resource factory once, and starts **one** Station with agent jobs and resource endpoints. Agent runs continue using `mountBrowser` and `mountSandbox` with scoped adapters. Configuring providers on the daemon does not automatically grant agents access. Omit `daemon` to retain the jobs-only default, or supply either resource provider independently. Existing mounts can still connect to external workers.

`onReady` receives `{ url, stationId, token }` after Station starts. The callback runs inside the daemon; use private storage or another application-owned channel when the host needs the connection. This is a trusted operator connection: Station 3 requires admin scope for its operator resource API. Keep it out of model context, manifests, observability and client-side code. Provider credentials stay in the resource adapters. The callback should overwrite stale connection state on each startup.

Foundry stops Station and its resource adapters on shutdown, and cleans up on failed startup or a failed `onReady` callback. Resource factories must release partially acquired resources if they throw before returning. Mount cleanup retains its existing independent semantics; retaining a run scope does not promise a browser survives daemon shutdown. Persistent files and profiles depend on the chosen provider adapters.

Programmatic `FoundryRuntime.discover` calls using a daemon adapter must supply `applicationFilePath`; closures are loaded in the child process, never serialized from the parent. Each Foundry runtime owns its Station instance. A fixed port must be unique per instance; omitting it avoids manual port allocation.

## Optional capability mounts

Browser and sandbox support is opt-in through `glove-execution`. Neither `glove-core` nor Foundry depends on that package. Use the same explicit mounting pattern as other Glove extensions, inside Foundry's existing `configure` hook:

```ts
import { defineAgent } from "glove-foundry";
import { mountBrowser } from "glove-execution";
import { stationBrowserClient } from "glove-execution/station";

export default defineAgent({
  model: () => createConfiguredModel(),
  description: "Browser researcher",
  configure(agent, context) {
    const adapter = stationBrowserClient(
      browserConnectionFor(context.agentId),
      { maxSessions: 1, allowEvaluate: true },
    );
    let close = () => adapter.close();
    context.onCleanup(() => close());
    const browser = mountBrowser(agent, { adapter });
    close = () => browser.close();
  },
});
```

The host supplies the model factory and credential-bearing connection resolver. `mountBrowser` attaches tools and a transient context provider that delivers native screenshots after tool results, without wrapping or replacing the agent’s model. Mounting creates a workflow scope; it does not automatically open a browser. Models get `execute_browser`, a persistent, bounded script surface for composing observation, actions, browser evaluation and verification in one model call. `mountSandbox` similarly installs `execute_sandbox`. Existing `repl` selection sees tools mounted during `configure`.

The generic `context.onCleanup` hook registers teardown for any mounted capability. Callbacks run in reverse order on success, failure and cancellation, even if configuration fails. Keep returned mount handles in host code; browser/sandbox handles and fields are not part of Foundry's context or manifest. The portable mount entrypoint has no Node or Station imports; the separate Station adapter entrypoint owns backend integration.

See [glove-execution](../../glove-execution/README.md) for worker connections, resource grants, retained sandbox ownership, scripting, page evaluation, mounting outside Foundry and custom adapters.

## Station 2 consumers

Station retired `station-kit`. Existing room examples now import `defineConfig` from `station-daemon`, start with `stationd`, and use Station 3 dependency ranges. Run the dashboard separately using `station-dashboard@3`, `STATION_DAEMON_URL` and a separate `PORT`. Existing API consumers continue to target the daemon port.
