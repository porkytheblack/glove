# glove-execution

Optional browser scripting and persistent sandbox mounts for Glove. Like `mountJs` and other capability packages, `mountBrowser` and `mountSandbox` attach to an existing agent. `glove-core` has no browser, sandbox or Station dependency. The default entrypoint uses portable JavaScript and Web APIs; Station 3 adapters live separately in `glove-execution/station`.

```sh
pnpm add glove-execution station-browser-use station-client
```

## Foundry

Install this package in the consuming application and mount capabilities explicitly in the existing `configure` hook:

```ts
import { defineAgent } from "glove-foundry";
import { mountBrowser, mountSandbox } from "glove-execution";
import { stationBrowserClient, stationSandbox } from "glove-execution/station";
import { StationClient } from "station-client";

export default defineAgent({
  model: () => createConfiguredModel(),
  description: "Researches in a browser and works in a persistent shell workspace",
  async configure(agent, context) {
    const browserAdapter = stationBrowserClient({
      baseUrl: process.env.STATION_URL!,
      stationId: process.env.STATION_WORKER!,
      apiKey: process.env.STATION_EXECUTION_KEY!,
      access: "tenant",
    }, { maxSessions: 2, allowEvaluate: true });
    // Register immediately so a later setup failure also releases the scope.
    let closeBrowser = () => browserAdapter.close();
    context.onCleanup(() => closeBrowser());
    const browser = mountBrowser(agent, {
      adapter: browserAdapter,
    });
    closeBrowser = () => browser.close();

    const sandboxAdapter = await stationSandbox({
      client: new StationClient({
        url: process.env.STATION_URL!,
        token: process.env.STATION_EXECUTION_KEY!,
        tenant: true,
      }),
      stationId: process.env.STATION_WORKER!,
      sandboxIds: await loadSandboxGrants(context.agentId),
      cleanup: "retain",
    });
    let closeSandbox = () => sandboxAdapter.close();
    context.onCleanup(() => closeSandbox());
    const sandbox = mountSandbox(agent, { adapter: sandboxAdapter });
    closeSandbox = () => sandbox.close();
  },
});
```

The consumer supplies `createConfiguredModel`, credentials and resource-grant storage. The agent owns its model. Browser mounting only attaches tools and a transient context provider for native image observations; it never wraps or replaces the model. Backend clients stay in host closures, outside prompts, manifests and instance records. Station owns worker placement, provider credentials, network policy and live resources. Use one adapter scope per run/workflow; never share one agent's scope with another.

Foundry has no browser/sandbox definition fields or dependency on this package. Its generic `context.onCleanup` hook runs registered callbacks in reverse order on success, failure or cancellation, including failed configuration. Mounts installed in `configure` are available before `build` and general REPL selection. Keep the returned handles in host code to inspect `resourceIds()`, `uncertainCreations()`, `functions` or `session`. Save retained resource IDs in a private, owner-scoped store; do not turn arbitrary model-supplied IDs into grants.

Foundry can host these providers on its existing managed Station: configure `daemon: stationDaemon({ stationId, resources, onReady })` in the application, importing the helper from `glove-foundry/station`. The resource factory returns browser and/or sandbox provider adapters once per daemon; `onReady` gives trusted host code the private connection. Agent mounts stay the same. See [the shared-daemon setup](../glove-foundry/docs/execution.md#one-station-for-jobs-and-resources).

## Browser scripts

The default model tool is **`execute_browser({ code })`**, backed by Glove's persistent, bounded JavaScript interpreter. Compose a complete observation/action loop in one model call:

```js
const page = browser.open({});
browser.navigate({ sessionId: page.id, url: "https://example.com/form" });
const initial = browser.observe({ sessionId: page.id });
browser.interact({
  sessionId: page.id,
  command: { op: "fill", target: { by: "label", value: "Name" }, value: "Ada" }
});
browser.interact({
  sessionId: page.id,
  command: { op: "click", target: { by: "role", role: "button", name: "Submit" } }
});
const confirmation = browser.observe({ sessionId: page.id });
browser.screenshot({ sessionId: page.id });
confirmation;
```

Calls resolve automatically (`await` is optional). Bindings persist within this run, and large intermediate data stays inside the interpreter. `fns("browser")` and `describe("browser__interact")` discover exact schemas inside the same script. Conditionals and bounded loops can inspect and act without asking the model for each click. Programs have no ambient Node, filesystem or network access. Overlapping programs are refused. Effects execute immediately; a failed script is never automatically replayed.

Station provides `open`, `sessions`, `navigate`, `observe`, `interact`, `screenshot`, `checkpoint`, `resume` and `close`. `interact` exposes Station's structured command schema: semantic targets, frames, tabs, uploads/downloads, diagnostics and other backend-supported operations. `allowedCommands` restricts this structured command surface. Capabilities vary by worker; unsupported operations return errors.

With the explicit host grant `allowEvaluate: true`, `browser.evaluate({ sessionId, expression })` evaluates JavaScript **inside the selected web page**. This is separate from the workflow interpreter and is not covered by `allowedCommands`; leave it disabled when only structured commands should be available. It remains subject to session ownership and Station's control leases and browser policies.

Screenshots are delivered as native image content in the next model request, after all tool results. Base64 never becomes script output or ordinary tool-result text. The newest image is retained transiently, bounded to 4 MiB by default. A script can manipulate DOM observations immediately; visual reasoning over a screenshot needs the next model turn. Images do not accumulate in persisted history or runtime-context telemetry. The native loop consumes an observation after a successful model iteration; failures retain it for retry, and closing the mount removes its context provider and subscriber. Custom execution loops must append `getRuntimeContext()` and report the standard `token_consumption` event after accepting a response to consume images.

Station browser adapters close granted and newly opened sessions by default. Set `cleanup: "retain"` when the host owns a longer-lived browser across runs; closing the mount stops admission and settles pending calls but leaves live sessions on the worker. Save `resourceIds()` privately and grant them to the next scope. Explicit `browser.close` still closes a session. The host must enforce idle/provider expiry and release sessions at shutdown; unresolved openings still fail cleanup.

Page content is untrusted evidence. Human takeover and challenges stop automation. Unknown opening outcomes block further opens, and cleanup reports unresolved resources for host reconciliation. Checkpoints/profiles can persist; live page state and script bindings are not restored after a run or worker restart.

## Sandbox scripts

**`execute_sandbox({ code })`** mounts the same scripting model over sandbox lifecycle, files, commands, terminals and services:

```js
const box = sandbox.create({});
const started = sandbox.exec({ id: box.id, command: "node --version" });
sandbox.command({ id: box.id, runId: started.id });
```

`exec` starts a command; inspect `status`/`finishedAt` before claiming completion. `cancel` stops a command. `list` shows only granted or newly created sandboxes, never every workspace on a worker. File operations expose bounded base64 chunks. `sandbox.writeText({ id, path, text, createParents? })` writes UTF-8 source code directly when the backend supports files; the adapter performs encoding outside the interpreter. Terminal and service functions mount only when supported by the backend. Discover their complete input schemas with `describe("sandbox__startService")`, etc.

Closing a scope defaults to **retaining** workspace files and services. `cleanup: "destroy-created"` deletes only sandboxes created by that scope; host-granted workspaces are retained. Explicit `destroy` can delete any sandbox granted to the scope. The scope never closes a shared provider backend. Network cancellation stops a request, not necessarily the remote command: reconcile unknown mutations and use `cancel` when the run ID is known.

For a host-configured local Station workspace:

```ts
import { HostSandboxAdapter } from "station-sandbox";
import { stationLocalSandbox } from "glove-execution/station";
const backend = new HostSandboxAdapter({ rootDir: "/data/trusted-workspaces" });
const adapter = await stationLocalSandbox(backend, { maxSandboxes: 2 });
// The application owns backend.close(). Host processes are for trusted code.
```

Use Station's container backend and operator-enforced policies when isolation is required.

## Mount on any Glove

```ts
import { mountBrowser, mountSandbox } from "glove-execution";
const browser = mountBrowser(glove, { adapter: browserAdapter });
const sandbox = mountSandbox(glove, { adapter: sandboxAdapter });
try {
  await glove.processRequest("Complete the task");
} finally {
  await Promise.allSettled([browser.close(), sandbox.close()]);
}
```

Pass `surface: "tools"` to expose individual `glove_browser_*` / `glove_sandbox_*` tools. Scripts are the default. `prime: false` disables prompt guidance. Browser mounting wraps the supplied model; mount after selecting that model and re-mount if the host replaces it. Each mounted handle also exposes `functions`, compatible with Glove's existing JS/Python/Lisp catalogues.

## Another backend

Implement `BrowserAdapter` / `SandboxAdapter` with a validated operation catalogue, resource IDs, uncertain-creation accounting and `close()`. Each operation has a JSON schema and returns data, a typed error (including `outcome: "unknown"`), and optionally native images. Provider-specific capabilities remain discoverable through that catalogue; no Station types are required by the mount API.

For a sandbox backend, implement `SandboxBackend` and pass it to `createSandboxAdapter`. The shared scope wrapper validates schemas, checks resource grants, reserves concurrent creation capacity, bounds results and handles retain/destroy cleanup. Backend invocation must classify definitive failures with `ExecutionError`; unexpected transport errors are conservatively treated as unknown outcomes. Never automatically retry mutations.

## Verification

`pnpm --filter glove-execution test` runs scoped adapter, scripting, image and real host-sandbox tests. The Chromium integration is opt-in:

```sh
GLOVE_BROWSER_INTEGRATION=1 pnpm --filter glove-execution test
```

Install Station's optional Playwright peer and its Chromium browser first, or set `GLOVE_BROWSER_EXECUTABLE` to an existing Chromium executable. The test uses a local form and no model key. It verifies navigation, DOM observation, fill/click, page evaluation, native screenshot delivery and session cleanup in one script.
