/**
 * Function mode, end to end, with NO API key and NO model — on BOTH REPL
 * surfaces over ONE shared function catalog.
 *
 *   npx tsx fn-repl.ts lisp     # the Clojure surface
 *   npx tsx fn-repl.ts js       # the JavaScript surface
 *   npx tsx fn-repl.ts both     # both, over the same functions
 *
 * The point: capabilities register as plain `ToolFn`s (no columns, no pushdown,
 * no volatility) and the SAME catalog mounts on glove-lisp's function mode and
 * glove-js. We drive `session.execute(...)` directly (instead of a model) so the
 * transcript is deterministic, and prove the load-bearing properties:
 *   - DISCOVERY in-band ((fns) / fns(), (describe :name) / describe("name"))
 *   - CALL a capability by name, arguments as one map/object — the tool fires
 *   - COMPOSE across capabilities in one program, off-context
 *   - BRANCH: decide-and-act in a single call
 *   - PERSIST: def / const keeps big intermediates in the session
 *
 * In a real agent you'd `mountLisp(glove, { session })` or `mountJs(glove,
 * { session })` and the model would write the very same programs.
 */
import { defineFn, type ToolFn } from "glove-scratchpad/fns";
import { z } from "zod";

// ── the shared world: four fake capabilities as ToolFns ──────────────────────
// A call counter so we can SEE that a call fires exactly once, when its form
// evaluates (and that a def'd/const'd result is reused, not re-fetched).
const calls = { prs: 0, issues: 0, email: 0, slack: 0 };

function catalog(): ToolFn[] {
  return [
    defineFn({
      name: "github__list_pull_requests",
      description: "List pull requests across all repos.",
      input: z.object({ state: z.enum(["open", "merged", "closed"]).optional().describe("open | merged | closed") }),
      readOnlyHint: true,
      handler: ({ state }) => {
        calls.prs++;
        const rows = [
          { number: 1, state: "open", title: "Fix login", closes: "LIN-1" },
          { number: 2, state: "merged", title: "Add SSO", closes: "LIN-2" },
          { number: 3, state: "open", title: "Bump deps", closes: null },
          { number: 4, state: "merged", title: "Refactor auth", closes: "LIN-3" },
        ];
        return state ? rows.filter((r) => r.state === state) : rows;
      },
    }),
    defineFn({
      name: "linear__list_issues",
      description: "List Linear issues.",
      input: z.object({ status: z.enum(["todo", "in_progress", "done"]).optional() }),
      readOnlyHint: true,
      handler: ({ status }) => {
        calls.issues++;
        const rows = [
          { id: "LIN-1", status: "done", title: "Login broken" },
          { id: "LIN-2", status: "done", title: "SSO support" },
          { id: "LIN-3", status: "in_progress", title: "Auth refactor" },
        ];
        return status ? rows.filter((r) => r.status === status) : rows;
      },
    }),
    defineFn({
      name: "email__send",
      description: "Send an email.",
      input: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
      readOnlyHint: false,
      handler: (args) => {
        calls.email++;
        return { sent: true, to: args.to };
      },
    }),
    defineFn({
      name: "slack__post_message",
      description: "Post a message to a Slack channel.",
      input: z.object({ channel: z.string(), text: z.string() }),
      readOnlyHint: false,
      handler: (args) => {
        calls.slack++;
        return { ok: true, channel: args.channel };
      },
    }),
  ];
}

function banner(title: string): void {
  console.log(`\n${"─".repeat(64)}\n  ${title}\n${"─".repeat(64)}`);
}

// ── the Lisp surface ─────────────────────────────────────────────────────────
async function runLisp(): Promise<void> {
  const { LispSession } = await import("glove-lisp");
  banner("glove-lisp — function mode");
  const s = LispSession.create();
  s.registerFns(catalog());

  const steps: Array<[string, string]> = [
    ["discover", `(map :name (fns))`],
    ["describe", `(describe :email__send)`],
    [
      "compose + persist (def keeps rows off-context)",
      `(def merged-open
         (->> (github__list_pull_requests {:state "merged"})
              (filter :closes)
              (map #(select-keys % [:number :closes]))))`,
    ],
    ["reuse the def without re-fetching", `(count merged-open)`],
    [
      "decide-and-act in ONE program",
      `(if (empty? (linear__list_issues {:status "todo"}))
         (slack__post_message {:channel "eng" :text "No todos — all clear."})
         (email__send {:to "pm@acme.io" :subject "Open todos" :body "see linear"}))`,
    ],
  ];
  for (const [label, code] of steps) {
    const r = await s.execute(code, { actor: "demo" });
    console.log(`\n> ${label}\n${code.trim()}`);
    console.log("=>", JSON.stringify(r.value));
    if (r.defined) console.log("   defined:", r.defined, r.defs ? JSON.stringify(r.defs) : "");
    if (r.message) console.log("   ", r.message);
  }
}

// ── the JS surface ───────────────────────────────────────────────────────────
async function runJs(): Promise<void> {
  const { JsSession } = await import("glove-js");
  banner("glove-js — the same catalog, JavaScript");
  const s = JsSession.create();
  s.registerAll(catalog());

  const steps: Array<[string, string]> = [
    ["discover", `fns().map(f => f.name)`],
    ["describe", `describe("email__send").params`],
    [
      "compose + persist (const keeps rows off-context)",
      `const mergedOpen = github.list_pull_requests({ state: "merged" })
         .filter(p => p.closes)
         .map(p => ({ number: p.number, closes: p.closes }));`,
    ],
    ["reuse the const without re-fetching", `mergedOpen.length`],
    [
      "decide-and-act in ONE program",
      `linear.list_issues({ status: "todo" }).length === 0
         ? slack.post_message({ channel: "eng", text: "No todos — all clear." })
         : email.send({ to: "pm@acme.io", subject: "Open todos", body: "see linear" })`,
    ],
  ];
  for (const [label, code] of steps) {
    const r = await s.execute(code, { actor: "demo" });
    console.log(`\n> ${label}\n${code.trim()}`);
    console.log("=>", JSON.stringify(r.value));
    if (r.defined) console.log("   defined:", r.defined, r.defs ? JSON.stringify(r.defs) : "");
    if (r.called?.length) console.log("   called:", JSON.stringify(r.called));
  }
}

const which = process.argv[2] ?? "both";
if (which === "lisp" || which === "both") await runLisp();
if (which === "js" || which === "both") await runJs();

banner("tool-call counts (each capability fired exactly when its form ran)");
console.log(JSON.stringify(calls, null, 2));
console.log(
  "\nNote: the merged/open PR rows never entered a model's context — only the counts and the final decision did.",
);
