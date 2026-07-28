/**
 * Fold the working-environment verbs onto a Glove agent and prime it with
 * the operating discipline. `MountableAgent` is structural — any
 * IGloveRunnable / IGloveBuilder qualifies — so the package stays
 * zero-dependency.
 */
import type { MountableAgent } from "../types";
import type { WorkingEnvironment } from "../index";

export interface MountWorkingEnvironmentConfig {
  env: WorkingEnvironment;
  /** Prepend the environment preamble to the system prompt. Default true. */
  prime?: boolean;
  /** Optional prefix for every verb name (e.g. "env_") to avoid collisions. */
  toolPrefix?: string;
}

export function buildPreamble(env: WorkingEnvironment): string {
  const mods = [...env.moduleDescriptions.entries()].map(([n, d]) => `env:${n} (${d})`).join(", ");
  return `You have a persistent WORKING ENVIRONMENT — a sandboxed virtual filesystem you act on across many tool calls. State accumulates: files, scripts, and outputs persist between calls (and across sessions when the host snapshots the tree).

Layout conventions:
- /inbox — inputs mounted by the host
- /scripts — your persistent script library (shared utility modules go in /scripts/lib)
- /std — read-only docs for the stdlib modules scripts can import
- /tmp — intermediates and spilled outputs
- /out — deliverables; this is what the host exports
- /.env — run history (history.jsonl) and file versions, read-only

Operating discipline:
- Keep big data in files, not in your context. Redirect outputs to files, then read slices: read_file with start_line/end_line, grep with a narrow pattern.
- All execution goes through named scripts: write_file a script under /scripts, then run_script it. Every script must \`export default async function (args) { ... }\` — validation happens at write time and tells you exactly what to fix. Give each script a JSDoc block: it becomes the generated .d.ts and the description shown by ls.
- Scripts import capabilities — and each other: \`import { readFile, writeFile } from 'env:fs'\`, \`import { csv } from 'env:std'\`, \`import parse from './parse.js'\`. Nothing else is importable: no npm packages, no network, no host filesystem, no process — these do not exist in the sandbox.
- Discover before you build: ls /scripts is your capability catalog (one-line descriptions from JSDoc); ls /std lists stdlib modules; read_file /std/<name>/index.d.ts gives exact signatures; grep finds which script handles what.
- Iterate like a developer: generate, inspect the artifact (read_file a CSV, or call an adapter's describe() from a script for binaries), correct, re-run. undo/redo revert per-file mistakes; history shows recent runs or a file's versions.

Environment modules available to scripts: ${mods || "(none)"}.`;
}

export function mountWorkingEnvironment<G extends MountableAgent>(glove: G, config: MountWorkingEnvironmentConfig): G {
  const { env, prime, toolPrefix } = config;
  const tools = toolPrefix ? env.toolsWithPrefix(toolPrefix) : env.tools;
  for (const tool of tools) glove.fold(tool);
  if (prime !== false && glove.getSystemPrompt && glove.setSystemPrompt) {
    const existing = glove.getSystemPrompt();
    const preamble = buildPreamble(env);
    glove.setSystemPrompt(existing ? `${preamble}\n\n${existing}` : preamble);
  }
  return glove;
}
