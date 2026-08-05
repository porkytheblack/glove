/**
 * Live check: a capability, a format adapter, and a hand-off, in one turn.
 *
 * The motivating request for `defineTools` was "slides of what was
 * accomplished this week, going over the merges" — a job that is two systems
 * (a source of records, a deck generator) unless they meet somewhere. This
 * proves they meet in a script.
 *
 * The records are real: `git log` on this repository, read host-side and
 * exposed through `defineTools` exactly as an MCP server or a Glove tool would
 * be. Nothing is stubbed except the network, and the assertions below are the
 * three claims worth holding —
 *
 *   1. the capability was called FROM A SCRIPT, not as a tool call per commit
 *   2. a real .pptx came out of it
 *   3. the agent handed it over with `present`, with a caption
 *
 * Not part of CI: it costs money and needs OPENROUTER_API_KEY.
 *
 *   pnpm --filter glove-analyst-desk exec tsx --env-file-if-exists=../../.env \
 *     src/livecheck-capabilities.ts
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createWorkingEnvironment,
  defineTools,
  type PresentedFile,
} from "glove-working-environment";
import { slides } from "glove-env-slides";
import { documents } from "glove-env-documents";
import { runAgent } from "./agent";

const run = promisify(execFile);
const MODEL = process.env.LIVE_MODEL ?? "z-ai/glm-4.6";
const SINCE = process.env.LIVE_SINCE ?? "3 weeks ago";

interface Merge {
  sha: string;
  date: string;
  author: string;
  subject: string;
  body: string;
}

/**
 * The repository's own history, as records.
 *
 * A host wiring GitHub's MCP server would pass `await fnsFromMcp(conn)` here
 * instead; the shape reaching the environment is the same either way, which
 * is the point of the structural `ToolFn`.
 */
async function readMerges(since: string, limit: number): Promise<Merge[]> {
  const SEP = "\u001f";
  const { stdout } = await run(
    "git",
    ["log", `--since=${since}`, `-n${limit}`, `--pretty=format:%H${SEP}%aI${SEP}%an${SEP}%s${SEP}%b${SEP}${SEP}`],
    { cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout
    .split(`${SEP}${SEP}\n`)
    .map((row) => row.split(SEP))
    .filter((parts) => parts.length >= 5 && parts[0].trim() !== "")
    .map(([sha, date, author, subject, body]) => ({
      sha: sha.trim().slice(0, 8),
      date,
      author,
      subject,
      body: body.trim(),
    }));
}

const github = defineTools({
  name: "github",
  description: "This repository's merge history.",
  fns: [
    {
      name: "list_merges",
      description: "List merged work in a time window, newest first.",
      inputSchema: {
        type: "object",
        properties: {
          since: { type: "string", description: "A git date expression, e.g. '1 week ago' or '2026-08-01'" },
          limit: { type: "integer", description: "Maximum records. Default 100." },
        },
        required: ["since"],
      },
      resultShape: "Array<{ sha: string; date: string; author: string; subject: string; body: string }>",
      readOnlyHint: true,
      async call(args) {
        const { since, limit } = args as { since?: string; limit?: number };
        if (!since) throw new Error("list_merges needs { since }");
        return await readMerges(since, Math.min(limit ?? 100, 300));
      },
    },
  ],
  docs:
    "`body` is the full commit message minus the subject line — it is where the reasoning lives, " +
    "and it is often long. Reduce it in the script; do not return it whole.",
});

const TASK =
  `Build me a deck of what was accomplished in this repository since ${SINCE}. ` +
  `Group the work into themes rather than listing every commit, one slide per theme, ` +
  `with a title slide that says how many changes it covers. Write it to /out and hand it to me.`;

const presented: PresentedFile[] = [];

const env = await createWorkingEnvironment({
  stdlib: [github, slides(), documents()],
  onPresent: (item) => void presented.push(item),
  limits: { runTimeoutMs: 60_000 },
});

console.log(`model    ${MODEL}`);
console.log(`window   ${SINCE}`);
console.log(`merges   ${(await readMerges(SINCE, 300)).length} available\n`);

try {
  const transcript = await runAgent({ env, model: MODEL, task: TASK, maxTurns: 24 });

  for (const e of transcript.events) {
    const mark = e.status === "error" ? "✗" : "·";
    console.log(`${mark} ${e.name.padEnd(12)} ${e.preview.split("\n")[0].slice(0, 96)}`);
  }
  console.log(`\n${transcript.finalText.trim()}\n`);

  // --- 1. the capability was reached from a script, not called per record ---
  const scripts = await env.export("/scripts/**");
  const sources = scripts
    .filter((f) => f.path.endsWith(".js"))
    .map((f) => new TextDecoder().decode(f.bytes));
  const importsCapability = sources.some((s) => /from\s+['"]env:github['"]/.test(s));

  // The environment offers no tool that calls a capability directly, so the
  // only way to reach it is a script — but assert it anyway, because the
  // failure this guards is the interesting one: an agent that never finds the
  // module and reports the task impossible.
  const deck = (await env.export("/out/**")).filter((f) => f.path.endsWith(".pptx"));

  console.log("─".repeat(72));
  console.log(`env:github imported by a script   ${importsCapability ? "yes" : "NO"}`);
  console.log(`.pptx in /out                     ${deck.length > 0 ? deck.map((d) => d.path).join(", ") : "NONE"}`);
  console.log(
    `presented                         ${
      presented.length > 0
        ? presented.map((p) => `${p.name} (${p.mediaType}) — ${p.caption}`).join("\n" + " ".repeat(34))
        : "NOTHING"
    }`,
  );
  console.log(
    `cost                              $${(transcript.usage.cost ?? 0).toFixed(4)}  ` +
      `${transcript.turns} turns, ${(transcript.wallMs / 1000).toFixed(1)}s`,
  );

  const failures: string[] = [];
  if (!importsCapability) failures.push("no script imported env:github");
  if (deck.length === 0) failures.push("no .pptx was produced");
  if (presented.length === 0) failures.push("nothing was presented");
  else if (!presented.some((p) => p.path.endsWith(".pptx"))) failures.push("the presented file was not the deck");

  if (failures.length > 0) {
    console.error(`\nFAILED: ${failures.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nOK — capability → script → deck → hand-off");
  }
} finally {
  await env.close();
}
