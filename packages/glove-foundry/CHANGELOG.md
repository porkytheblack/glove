# glove-foundry

## 0.3.0

### Minor Changes

- [#157](https://github.com/porkytheblack/glove/pull/157) [`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Introduce Glove Foundry, the Effect-native, file-routed framework for typed and observable agent applications.

  - Publish the first `glove-foundry` release with composable code definitions, persisted instances, context-aware lazy assembly, applications and transmissions, dynamic playbooks and schedules, conversations, agent working environments, multi-agent composition, and the Foundry inspection workbench.
  - Add Gemini native image generation and editing to `glove-image`.
  - Refresh the Gemini model catalogue in `glove-core`.
  - Move Gemini Live runtime text onto the realtime input protocol and update its default live model.
  - Deprecate the Glovebox package family in favor of Glove Foundry. Existing Glovebox deployments remain supported as a legacy compatibility surface, while new agent runtimes should use Foundry.

### Patch Changes

- [#159](https://github.com/porkytheblack/glove/pull/159) [`4050224`](https://github.com/porkytheblack/glove/commit/40502241f16621bde4696fb6357006951b121c13) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Rework `glove foundry init` so a new project is complete, correct, and runnable on the first command.

  - **Dependency versions are resolved from the CLI's own manifest** rather than hardcoded. The pinned ranges had drifted: a scaffold asking for `glove-js@^0.3.0` while `glove-foundry@0.1.0` requires `0.4.0` made the package manager install a second copy, and the generated project failed `tsc` before its author wrote a line.
  - **A worked travel-concierge example is the default template.** It searches flights, installs a calendar application, replies over a Telegram/WhatsApp-shaped transmission, remembers the traveller, wakes on a schedule, and owns a sandboxed VFS and REPL — one example per convention. `--template minimal` still gives one agent and one tool.
  - **It runs with no API key.** A deterministic demo model answers until `OPENROUTER_API_KEY` is set, so the first run produces a real trace with real tool calls.
  - **A full README ships with the project**: the definition/instance model, a map of every generated file, the convention table, how to add a tool or install an application, how to wire a real chat provider, and links to every Glove package.
  - **`--target nextjs` adds Foundry to an existing Next.js app**, detected automatically. Agents land under `foundry/`, the app gets a typed `lib/foundry.ts` client and an example route handler, and its `package.json` keeps everything it had. A nested `foundry/package.json` and a `.mts` config scope ESM to the agent tree, without which Node loads the agents through the CommonJS resolver and fails on Foundry's ESM-only export map.
  - `glove foundry dev` now watches the configured `agentsDir` instead of assuming `agents/` at the root, so hot restart works in the Next.js layout.
  - The CLI gains `--template`, `--target`, and `--package-manager`, reports what it created and what to run next, and reports a bad flag as a usage error rather than a stack trace.

- [#159](https://github.com/porkytheblack/glove/pull/159) [`c74845d`](https://github.com/porkytheblack/glove/commit/c74845d4c02269301b4e02bcfcd3b366821f4692) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Rework the Foundry inspector around the questions an operator actually asks of a run.

  - Live events are coalesced into one refresh instead of repainting the page per event, and a refresh now preserves scroll position, expanded events, open output panels, and the text and caret in a filter box. Previously any runtime event wiped what you were typing.
  - Runs carry a duration and a relative start time that tick every second, so an in-flight run reads as in-flight without a reload.
  - Run filters live in the query string. `/runs?status=failed&q=invoice` is a link you can send, and the status tabs carry live counts.
  - A failed run states its error above the spine rather than only inside the recorded output; the event trace adds per-event offsets from the start of the run, category filters, and payload copy.
  - Every truncated identifier has a copy button, lists take `j`/`k`/`Enter`, `/` focuses the run filter, `c` opens the run drawer, and `Command-Enter` submits it.
  - Drop the webfont import the server's own content security policy has always blocked, which removes a guaranteed console error on every page load.

- Updated dependencies [[`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8), [`ee591da`](https://github.com/porkytheblack/glove/commit/ee591da42305661339913bca8f967a9f8c0fecbf)]:
  - glove-core@3.7.0
  - glove-js@0.4.1
  - glove-lisp@0.4.1
  - glove-mcp@1.1.1
  - glove-memory@1.1.1
  - glove-mesh@0.1.2
  - glove-python@0.3.1
  - glove-working-environment@0.6.0
