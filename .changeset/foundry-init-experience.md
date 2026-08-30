---
"glove-foundry": patch
---

Rework `glove foundry init` so a new project is complete, correct, and runnable on the first command.

- **Dependency versions are resolved from the CLI's own manifest** rather than hardcoded. The pinned ranges had drifted: a scaffold asking for `glove-js@^0.3.0` while `glove-foundry@0.1.0` requires `0.4.0` made the package manager install a second copy, and the generated project failed `tsc` before its author wrote a line.
- **A worked travel-concierge example is the default template.** It searches flights, installs a calendar application, replies over a Telegram/WhatsApp-shaped transmission, remembers the traveller, wakes on a schedule, and owns a sandboxed VFS and REPL — one example per convention. `--template minimal` still gives one agent and one tool.
- **It runs with no API key.** A deterministic demo model answers until `OPENROUTER_API_KEY` is set, so the first run produces a real trace with real tool calls.
- **A full README ships with the project**: the definition/instance model, a map of every generated file, the convention table, how to add a tool or install an application, how to wire a real chat provider, and links to every Glove package.
- **`--target nextjs` adds Foundry to an existing Next.js app**, detected automatically. Agents land under `foundry/`, the app gets a typed `lib/foundry.ts` client and an example route handler, and its `package.json` keeps everything it had. A nested `foundry/package.json` and a `.mts` config scope ESM to the agent tree, without which Node loads the agents through the CommonJS resolver and fails on Foundry's ESM-only export map.
- `glove foundry dev` now watches the configured `agentsDir` instead of assuming `agents/` at the root, so hot restart works in the Next.js layout.
- The CLI gains `--template`, `--target`, and `--package-manager`, reports what it created and what to run next, and reports a bad flag as a usage error rather than a stack trace.
