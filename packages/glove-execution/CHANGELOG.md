# glove-execution

## 0.3.0

### Minor Changes

- [#200](https://github.com/porkytheblack/glove/pull/200) [`2faacc0`](https://github.com/porkytheblack/glove/commit/2faacc060fff8e576b90db9c42d2da2c30392720) Thanks [@porkytheblack](https://github.com/porkytheblack)! - A Kuiper backend: `glove-execution/kuiper` mounts Kuiper's browsers and sandboxes through `@kuiper-sh/sdk`.

  - `kuiperBrowser({ browsers: kuiper.browsers, … })` is a `BrowserAdapter` for `mountBrowser`. Each session is a real Chrome, driven over CDP with `playwright-core`. Its operations are `open`, `sessions`, `navigate`, `back`, `observe`, `interact`, `screenshot` and `close`.
    - `observe` returns the accessibility tree or the text. `interact` takes role, label, text, placeholder, title, test-id or CSS targets.
    - `session` is passed to `kuiper.browsers.create()` as it is (profile, timeouts, hibernation, recording). The model never sets it.
  - `guard` sees every request the browser makes while the run is connected, before it leaves: pages, form posts, a page's own fetches and WebSockets, with service workers bypassed. Returning false blocks a request. A blocked page load fails with `blocked`, and requests a click caused come back in that result's `blocked` list.
  - `onHandOff` adds `handOff`. It gives Kuiper's interactive live view to host code, never to the model, for a person's sign-in or CAPTCHA, and keeps the run off that browser afterwards. `allowEvaluate` adds `evaluate`.
  - Sessions belong to the Kuiper project, so they outlive the run. `sessionIds` grants the ones an earlier run kept. `cleanup` releases them (the default), hibernates them, or keeps them; connecting resumes a hibernated session.
  - `kuiperSandbox({ sandboxes: kuiper.sandboxes, sandbox: { image } })` is the same `execute_sandbox` surface as Station's, on Kuiper's sandboxes. A hibernated sandbox resumes before work. `exec` returns when the command ends, with its output. `kuiperSandboxBackend` is the `SandboxBackend` behind it.
  - A gateway refusal is definitive. A create that got no answer counts as an uncertain opening and stops further opens until the host reconciles it.

  `@kuiper-sh/sdk` and `playwright-core` are optional peer dependencies, needed only for this entrypoint.

### Patch Changes

- Updated dependencies [[`dbc7e0f`](https://github.com/porkytheblack/glove/commit/dbc7e0fcb44cd1ee57d389a83c92b00fd6d9be3c), [`d51fc4b`](https://github.com/porkytheblack/glove/commit/d51fc4ba6f775960ee09825b15b5b9ff81e36599), [`5b24bf7`](https://github.com/porkytheblack/glove/commit/5b24bf7b559684fb28c18c231e67014b167842a3)]:
  - glove-core@4.7.0
  - glove-js@0.5.6

## 0.2.4

### Patch Changes

- Updated dependencies [[`ca88985`](https://github.com/porkytheblack/glove/commit/ca8898526d5baeabe0469921658977451dab921c), [`ca88985`](https://github.com/porkytheblack/glove/commit/ca8898526d5baeabe0469921658977451dab921c)]:
  - glove-core@4.6.0
  - glove-js@0.5.5

## 0.2.3

### Patch Changes

- Updated dependencies [[`6f04d7e`](https://github.com/porkytheblack/glove/commit/6f04d7e1db19b30676254753c6a2a68c04d427cb)]:
  - glove-core@4.5.0
  - glove-js@0.5.4

## 0.2.2

### Patch Changes

- Updated dependencies [[`d1d9508`](https://github.com/porkytheblack/glove/commit/d1d95086ce5738619e3eddaa66dfbd1abfe4d2e1), [`c6f6cb4`](https://github.com/porkytheblack/glove/commit/c6f6cb4bb1c81357ca16f9fa043890cc0a9ff325)]:
  - glove-core@4.4.0
  - glove-js@0.5.3

## 0.2.1

### Patch Changes

- Updated dependencies [[`109e40d`](https://github.com/porkytheblack/glove/commit/109e40dddafe3bfe1ac2dd113ca325f440613ad8)]:
  - glove-core@4.3.0
  - glove-js@0.5.2

## 0.2.0

### Minor Changes

- [#184](https://github.com/porkytheblack/glove/pull/184) [`0fb8e0b`](https://github.com/porkytheblack/glove/commit/0fb8e0b8725cbf09e283c00438f2b35dc5faab5b) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Add adapter-backed browser scripting and persistent sandbox mounts, with Station 3 as the first backend. These optional capabilities use the existing mount approach without adding browser, sandbox or Station dependencies to glove-core. Foundry adds generic mount cleanup registration and moves agent jobs into a separate managed Station daemon process. Foundry requires Node 22+; the capability mount entrypoint remains portable. The daemon remains local and managed by Foundry; external browser/sandbox workers retain their own lifecycles.

  Add retained browser scopes, a portable UTF-8 sandbox writeText operation, and a general-purpose Foundry Operator example with real browser/server verification and illustrated site documentation.

  Runtime context providers now accept portable native content parts as well as text. Browser mounts use this transient channel without accepting or replacing the agent model; media bytes and URLs are omitted from runtime-context telemetry.

  Add optional application-level stationDaemon configuration. The managed Station can host browser and sandbox provider adapters alongside agent jobs, with one resource factory per daemon, private connection delivery, and startup/shutdown cleanup. Operator now uses this single-instance path.

  Serialize scheduled activation transitions across daemon acknowledgements and asynchronous storage so pause, update and cancellation cannot be overwritten by stale dispatch or completion writes.

### Patch Changes

- Updated dependencies [[`0fb8e0b`](https://github.com/porkytheblack/glove/commit/0fb8e0b8725cbf09e283c00438f2b35dc5faab5b)]:
  - glove-core@4.2.0
  - glove-js@0.5.1
