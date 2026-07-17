/** The three framings of the eval tool: repl (default) / program / workflow.
 *  Only the tool NAME and the priming change; the runtime is identical. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineFn } from "glove-scratchpad/fns";
import { JsSession } from "../src/session";
import {
  mountJs,
  jsToolName,
  buildExecuteJsTool,
  buildJsPreambleBody,
  JS_PREAMBLE,
} from "../src/mount";

function session(): JsSession {
  const s = JsSession.create();
  s.register(
    defineFn({
      name: "github__list_pull_requests",
      input: z.object({ state: z.string().optional() }),
      readOnlyHint: true,
      handler: () => [{ number: 1, state: "open" }],
    }),
  );
  return s;
}

/** A minimal IGloveRunnable stand-in capturing only what mountJs touches. */
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
  return { g, folded, get prompt() { return prompt; } };
}

test("jsToolName maps each frame to its tool name", () => {
  assert.equal(jsToolName(), "execute_js");
  assert.equal(jsToolName("repl"), "execute_js");
  assert.equal(jsToolName("program"), "execute_js_program");
  assert.equal(jsToolName("workflow"), "execute_js_workflow");
});

test("the eval tool is named for its frame", () => {
  assert.equal(buildExecuteJsTool(session()).name, "execute_js");
  assert.equal(buildExecuteJsTool(session(), { frame: "program" }).name, "execute_js_program");
  assert.equal(buildExecuteJsTool(session(), { frame: "workflow" }).name, "execute_js_workflow");
});

test("repl framing is the exported preamble; workflow framing de-REPLs it", () => {
  assert.equal(buildJsPreambleBody("repl"), JS_PREAMBLE);
  const wf = buildJsPreambleBody("workflow");
  assert.match(wf, /execute_js_workflow/);
  assert.match(wf, /WORKFLOWS/);
  assert.doesNotMatch(wf, /persistent JavaScript REPL/);
  // The one-shot framing names its own target and demotes cross-call state.
  assert.match(wf, /ONE workflow per task/);
  assert.match(wf, /RECOVERY aid/);
});

test("program framing renames the tool and calls it a program, not a REPL", () => {
  const pg = buildJsPreambleBody("program");
  assert.match(pg, /execute_js_program/);
  assert.match(pg, /COMPLETE JavaScript programs/);
  assert.doesNotMatch(pg, /persistent JavaScript REPL/);
});

test("mounting a frame folds exactly that tool name and primes with its framing", () => {
  const { g, folded } = fakeRunnable();
  mountJs(g as never, { session: session(), frame: "workflow", discovery: "full" });
  assert.ok(folded.includes("execute_js_workflow"), `expected execute_js_workflow in ${folded.join(",")}`);
  assert.ok(!folded.includes("execute_js"), "plain execute_js should not be folded under the workflow frame");
  assert.match(g.getSystemPrompt(), /execute_js_workflow/);
});

test("the runtime is identical across frames — a workflow-framed tool still executes", async () => {
  const tool = buildExecuteJsTool(session(), { frame: "workflow" });
  const res = await tool.do(
    { code: "github.list_pull_requests({ state: 'open' }).length" },
    undefined as never,
    undefined as never,
    undefined,
  );
  assert.equal(res.status, "success");
  assert.equal((res.data as { value: unknown }).value, 1);
});
