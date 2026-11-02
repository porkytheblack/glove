---
"glove-execution": minor
---

A Kuiper backend: `glove-execution/kuiper` mounts Kuiper's browsers and sandboxes through `@kuiper-sh/sdk`.

- `kuiperBrowser({ browsers: kuiper.browsers, … })` is a `BrowserAdapter` for `mountBrowser`. Each session is a real Chrome, driven over CDP with `playwright-core`. Its operations are `open`, `sessions`, `navigate`, `back`, `observe`, `interact`, `screenshot` and `close`.
  - `observe` returns the accessibility tree or the text. `interact` takes role, label, text, placeholder, title, test-id or CSS targets.
  - `session` is passed to `kuiper.browsers.create()` as it is (profile, timeouts, hibernation, recording). The model never sets it.
- `guard` sees every request the browser makes while the run is connected, before it leaves: pages, form posts, a page's own fetches and WebSockets, with service workers bypassed. Returning false blocks a request. A blocked page load fails with `blocked`, and requests a click caused come back in that result's `blocked` list.
- `onHandOff` adds `handOff`. It gives Kuiper's interactive live view to host code, never to the model, for a person's sign-in or CAPTCHA, and keeps the run off that browser afterwards. `allowEvaluate` adds `evaluate`.
- Sessions belong to the Kuiper project, so they outlive the run. `sessionIds` grants the ones an earlier run kept. `cleanup` releases them (the default), hibernates them, or keeps them; connecting resumes a hibernated session.
- `kuiperSandbox({ sandboxes: kuiper.sandboxes, sandbox: { image } })` is the same `execute_sandbox` surface as Station's, on Kuiper's sandboxes. A hibernated sandbox resumes before work. `exec` returns when the command ends, with its output. `kuiperSandboxBackend` is the `SandboxBackend` behind it.
- A gateway refusal is definitive. A create that got no answer counts as an uncertain opening and stops further opens until the host reconciles it.

`@kuiper-sh/sdk` and `playwright-core` are optional peer dependencies, needed only for this entrypoint.
