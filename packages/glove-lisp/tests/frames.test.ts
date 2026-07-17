/** The three framings of the eval tool: repl (default) / program / workflow.
 *  Only the tool NAMES and the priming change; the runtime is identical. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineFn } from "glove-scratchpad/fns";
import { LispSession } from "../src/session";
import {
  mountLisp,
  lispToolName,
  lispExplainName,
  buildExecuteLispTool,
  buildExplainLispTool,
  buildLispFnPreamble,
  LISP_FN_PREAMBLE,
} from "../src/mount";

function session(): LispSession {
  const s = LispSession.create({ policy: { writes: true } });
  s.registerFns([
    defineFn({
      name: "github__list_pull_requests",
      input: z.object({ state: z.string().optional() }),
      readOnlyHint: true,
      handler: () => [{ number: 1, state: "open" }],
    }),
  ]);
  return s;
}

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
  return { g, folded };
}

test("lispToolName / lispExplainName map each frame to its tool names", () => {
  assert.equal(lispToolName(), "execute_lisp");
  assert.equal(lispToolName("program"), "execute_lisp_program");
  assert.equal(lispToolName("workflow"), "execute_lisp_workflow");
  assert.equal(lispExplainName("workflow"), "explain_lisp_workflow");
});

test("the eval + explain tools are named for their frame", () => {
  assert.equal(buildExecuteLispTool(session()).name, "execute_lisp");
  assert.equal(buildExecuteLispTool(session(), { frame: "workflow" }).name, "execute_lisp_workflow");
  assert.equal(buildExplainLispTool(session(), { frame: "workflow" }).name, "explain_lisp_workflow");
});

test("repl fn framing is the exported preamble; workflow framing de-REPLs it", () => {
  assert.equal(buildLispFnPreamble("repl"), LISP_FN_PREAMBLE);
  const wf = buildLispFnPreamble("workflow");
  assert.match(wf, /execute_lisp_workflow/);
  assert.match(wf, /WORKFLOWS/);
  assert.doesNotMatch(wf, /LISP REPL/);
  assert.match(wf, /ONE workflow per task/);
});

test("mounting a frame folds exactly those tool names and primes with its framing", () => {
  const { g, folded } = fakeRunnable();
  mountLisp(g as never, { session: session(), frame: "workflow", allowWrites: true, discovery: "full" });
  assert.ok(folded.includes("execute_lisp_workflow"), `expected execute_lisp_workflow in ${folded.join(",")}`);
  assert.ok(folded.includes("explain_lisp_workflow"), "explain companion should share the frame");
  assert.ok(!folded.includes("execute_lisp"), "plain execute_lisp should not be folded under the workflow frame");
  assert.match(g.getSystemPrompt(), /execute_lisp_workflow/);
});

test("the runtime is identical across frames — a workflow-framed tool still executes", async () => {
  const tool = buildExecuteLispTool(session(), { frame: "workflow" });
  const res = await tool.do(
    { code: '(count (github__list_pull_requests {:state "open"}))' },
    undefined as never,
    undefined as never,
    undefined,
  );
  assert.equal(res.status, "success");
  assert.equal((res.data as { value: unknown }).value, 1);
});
