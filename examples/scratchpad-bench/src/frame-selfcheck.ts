/**
 * Frame plumbing selfcheck (NO API). Validates everything the frame bench relies
 * on before a single model token is spent:
 *
 *   1. Naming — each language's eval tool is named for its frame
 *      (execute_* / execute_*_program / execute_*_workflow), and the explain
 *      companion (lisp) shares the frame.
 *   2. Framing — the workflow/program preambles DE-REPL the priming (no "REPL",
 *      the one-shot target is named) while repl stays the classic preamble.
 *   3. Mount wiring — mounting an arm with a frame folds exactly that eval tool
 *      and primes with its framing (via a fake runnable — no model needed).
 *   4. Single-call ceiling — for a representative task in every language, the
 *      hand-authored ONE-shot program (one eval call) passes the same verifier
 *      the live bench uses. This is what makes "single-call rate" a meaningful
 *      target: 100% is achievable; the bench measures how close a model gets.
 *
 *   pnpm --filter glove-scratchpad-bench frame-selfcheck
 */
import { JsSession, mountJs, jsToolName, buildExecuteJsTool, buildJsPreambleBody, JS_PREAMBLE } from "glove-js";
import { PySession, mountPy, pyToolName, buildExecutePythonTool, buildPyPreambleBody, PY_PREAMBLE } from "glove-python";
import {
  LispSession,
  mountLisp,
  lispToolName,
  lispExplainName,
  buildExecuteLispTool,
  buildExplainLispTool,
  buildLispFnPreamble,
  LISP_FN_PREAMBLE,
} from "glove-lisp";
import type { Frame } from "glove-js";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";
import type { ToolFn } from "glove-scratchpad/fns";
import { buildMockOrg } from "./mcp/index";
import { SCENARIOS } from "./scenarios";

let failures = 0;
function check(label: string, pass: boolean, detail = ""): void {
  console.log(`  ${pass ? "OK ✓" : "FAIL ✗"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

const FRAMES: Frame[] = ["repl", "program", "workflow"];

/** A minimal IGloveRunnable stand-in capturing only what the mounts touch. */
function fakeRunnable() {
  const folded: string[] = [];
  let prompt = "";
  const g = {
    fold(args: { name: string }) {
      folded.push(args.name);
      return g;
    },
    getSystemPrompt() {
      return prompt;
    },
    setSystemPrompt(p: string) {
      prompt = p;
    },
  };
  return { g, folded, sys: () => prompt };
}

function scenario(id: string) {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
}

async function main() {
  // ── 1 + 2: naming + framing, per language ──────────────────────────────────
  console.log("\n[1+2] tool naming + de-REPL framing");

  check("js names", jsToolName("repl") === "execute_js" && jsToolName("program") === "execute_js_program" && jsToolName("workflow") === "execute_js_workflow");
  check("py names", pyToolName("repl") === "execute_python" && pyToolName("program") === "execute_python_program" && pyToolName("workflow") === "execute_python_workflow");
  check("lisp names", lispToolName("workflow") === "execute_lisp_workflow" && lispExplainName("workflow") === "explain_lisp_workflow");

  check("js repl preamble is the exported constant", buildJsPreambleBody("repl") === JS_PREAMBLE);
  check("py repl preamble is the exported constant", buildPyPreambleBody("repl") === PY_PREAMBLE);
  check("lisp fn repl preamble is the exported constant", buildLispFnPreamble("repl") === LISP_FN_PREAMBLE);

  for (const [name, wf, banned, needle] of [
    ["js", buildJsPreambleBody("workflow"), /persistent JavaScript REPL/, "execute_js_workflow"],
    ["py", buildPyPreambleBody("workflow"), /persistent Python REPL/, "execute_python_workflow"],
    ["lisp", buildLispFnPreamble("workflow"), /LISP REPL/, "execute_lisp_workflow"],
  ] as const) {
    check(
      `${name} workflow framing de-REPLs`,
      wf.includes("WORKFLOWS") && wf.includes(needle) && !banned.test(wf) && wf.includes("ONE workflow per task"),
    );
  }

  check("js tool name follows frame", buildExecuteJsTool(JsSession.create(), { frame: "workflow" }).name === "execute_js_workflow");
  check("py tool name follows frame", buildExecutePythonTool(PySession.create(), { frame: "program" }).name === "execute_python_program");
  {
    const s = LispSession.create({ policy: { writes: true } });
    check(
      "lisp eval + explain names follow frame",
      buildExecuteLispTool(s, { frame: "workflow" }).name === "execute_lisp_workflow" &&
        buildExplainLispTool(s, { frame: "workflow" }).name === "explain_lisp_workflow",
    );
  }

  // ── 3: mount wiring folds the right eval tool + primes its framing ──────────
  console.log("\n[3] mount wiring (fake runnable — no model)");
  const fns0 = (await buildMockOrgFns()).slice(0, 3);
  for (const frame of FRAMES) {
    {
      const { g, folded, sys } = fakeRunnable();
      const s = JsSession.create();
      s.registerAll(fns0);
      mountJs(g as never, { session: s, frame, discovery: "full" });
      const tool = jsToolName(frame);
      check(`js mount folds ${tool}`, folded.includes(tool) && sys().includes(tool));
    }
    {
      const { g, folded, sys } = fakeRunnable();
      const s = PySession.create();
      s.registerAll(fns0);
      mountPy(g as never, { session: s, frame, discovery: "full" });
      const tool = pyToolName(frame);
      check(`py mount folds ${tool}`, folded.includes(tool) && sys().includes(tool));
    }
    {
      const { g, folded, sys } = fakeRunnable();
      const s = LispSession.create({ policy: { writes: true } });
      s.registerFns(fns0);
      mountLisp(g as never, { session: s, frame, allowWrites: true, discovery: "full" });
      const tool = lispToolName(frame);
      check(`lisp mount folds ${tool} (+ ${lispExplainName(frame)})`, folded.includes(tool) && folded.includes(lispExplainName(frame)) && sys().includes(tool));
    }
  }

  // ── 4: single-call ceiling — one eval call passes the verifier, per language ─
  console.log("\n[4] single-call ceiling — one program does the whole task");
  {
    const org = await buildMockOrg({ scale: 1 });
    const fns = (await Promise.all(org.connections.map((c) => fnsFromMcp(c)))).flat();

    // JS — read-compose join in one program.
    {
      const s = JsSession.create();
      s.registerAll(fns);
      const r = await s.execute(
        `const done = linear.list_issues().filter(i => i.state === "done").map(i => i.id);
         const hits = github.list_pull_requests({ state: "merged" }).filter(p => p.closes_linear && !done.includes(p.closes_linear));
         \`\${hits.length} PRs: \${hits.map(p => \`PR \${p.number} closes \${p.closes_linear}\`).join("; ")}\``,
      );
      const v = scenario("merged-prs-open-linear").verify(String(r.value), org.world);
      check("js: merged-prs-open-linear in one call", v.pass, String(r.value).slice(0, 60));
    }

    // Python — group-by + argmax in one program.
    {
      const s = PySession.create();
      s.registerAll(fns);
      const r = await s.execute(
        `rows = linear.list_issues(state="in_progress")
freq = {}
for x in rows:
    freq[x["assignee"]] = freq.get(x["assignee"], 0) + 1
who = sorted(freq.items(), key=lambda kv: kv[1], reverse=True)[0]
f"{who[0]} has {who[1]}"`,
      );
      const v = scenario("busiest-assignee").verify(String(r.value), org.world);
      check("py: busiest-assignee in one call", v.pass, String(r.value));
    }

    // Lisp (fn mode) — decide-and-act branch + write in one program.
    {
      const s = LispSession.create({ policy: { writes: true } });
      s.registerFns(fns);
      const r = await s.execute(
        `(let [live (pagerduty__list_incidents {:urgency "high" :status "triggered"})]
           (if (empty? live)
             (do (slack__post_message {:channel "incidents" :text "All clear."})
                 "Posted 'All clear.' to Slack; 0 high-urgency incidents.")
             (do (email__send_email {:to "oncall@acme.io" :subject "Triage" :body (join ", " (map :id live))})
                 (str "Emailed oncall Triage listing " (count live) " incident(s): " (join ", " (map :id live))))))`,
        { allowWrites: true },
      );
      const v = scenario("incident-branch").verify(String(r.value ?? ""), org.world);
      check("lisp: incident-branch decide-and-act in one call", v.pass, v.note ?? "");
    }

    await org.close();
  }

  console.log(`\n${failures === 0 ? "ALL FRAME SELFCHECKS PASS ✓" : `${failures} FRAME SELFCHECK(S) FAILED ✗`}`);
  if (failures > 0) process.exit(1);
}

/** A tiny catalog for the mount-wiring checks — no live effects fired. */
async function buildMockOrgFns(): Promise<ToolFn[]> {
  const org = await buildMockOrg({ scale: 1 });
  const fns = (await Promise.all(org.connections.map((c) => fnsFromMcp(c)))).flat();
  await org.close();
  return fns;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
