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
  // Only mentioned when the host actually wired a vision model. Priming a
  // model to use a verb that is not in its tool list buys a wasted call and
  // a confusing failure.
  const canSee = env.tools.some((t) => t.name.endsWith("view_image"));
  // Same rule as `view_image`: mentioned only when the verb is really there.
  // Priming a model to ask a question it has no way to ask produces a
  // hallucinated call or a reported blocker that does not exist.
  const canAsk = env.tools.some((t) => t.name.endsWith("ask_user"));
  const asking = canAsk
    ? `\n- Ask when only the person can decide: ask_user(question, options) puts a question in front of them and waits. For a choice between two plausible inputs, an overwrite, or what a term means in their data — never for something the tree can answer, so read, describe or grep first. Ask before the expensive step rather than after it, and include enough context that the question stands on its own.`
    : "";
  const seeing = canSee
    ? `\n- Look at what you made: view_image(path, prompt) answers a question about how a file LOOKS, rasterizing PDFs and decks for you (pass page for a later one). Reading text back cannot see a table running off the page, a chart with no bars, or a title overlapping its subtitle. Ask something falsifiable — state what you expected, then ask what is actually there — and do it before you report a deliverable finished.`
    : "";
  return `You have a persistent WORKING ENVIRONMENT — a sandboxed virtual filesystem you act on across many tool calls. State accumulates: files, scripts, and outputs persist between calls (and across sessions when the host snapshots the tree).

Layout conventions:
- /inbox — inputs mounted by the host
- /scripts — your persistent script library (shared utility modules go in /scripts/lib)
- /std — read-only docs for the stdlib modules scripts can import
- /tmp — intermediates and spilled outputs
- /out — deliverables; this is what the host exports
- /.env — run history (history.jsonl) and file versions, read-only

Start here, in this order:
1. read_file /skills/README.md — worked, copy-pasteable recipes for the tasks this environment is for, starting with the exact import lines. Guessing an import is the most common way a run is wasted here.
2. read_file /.env/orientation.md. It is regenerated on every read and tells you what is in the tree, what your scripts do, which modules they use, and what has run recently — in one call instead of four.

Operating discipline:
- Keep big data in files, not in your context. Redirect outputs to files, then read slices: read_file with start_line/end_line, grep with a narrow pattern.
- All execution goes through named scripts: write_file a script under /scripts, then run_script it. Every script must \`export default async function (args) { ... }\` — validation happens at write time and tells you exactly what to fix. Give each script a JSDoc block: it becomes the generated .d.ts and the description shown by ls.
- Scripts import capabilities — and each other: \`import { readFile, writeFile } from 'env:fs'\`, \`import { csv } from 'env:std'\`, \`import parse from './parse.js'\`. Nothing else is importable: no npm packages, no network, no host filesystem, no process — these do not exist in the sandbox.
- Discover before you build: ls /scripts is your capability catalog (one-line descriptions from JSDoc); ls /std lists stdlib modules; read_file /std/<name>/index.d.ts gives exact signatures; grep finds which script handles what.
- Orient before you parse: describe(path) summarises any file — page counts, sheet names, image dimensions — by routing to the module that understands the format. Use it on an unfamiliar input instead of guessing, and on your own output to check what you produced.${seeing}${asking}
- Iterate like a developer: generate, inspect the artifact (read_file a CSV, describe a binary), correct, re-run. undo/redo revert per-file mistakes; history shows recent runs or a file's versions.
- Before restructuring several files at once, checkpoint({action:'fork', name:'...'}). One restore puts the whole tree back — undo is per-file and linear, so a multi-file dead end is otherwise an error-prone reverse-order unwind.

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
