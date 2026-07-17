/** The three framings of the eval tool: repl (default) / program / workflow.
 *  Only the tool NAME and the priming change; the runtime is identical. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineFn } from "glove-scratchpad/fns";
import { PySession } from "../src/session";
import {
  mountPy,
  pyToolName,
  buildExecutePythonTool,
  buildPyPreambleBody,
  PY_PREAMBLE,
} from "../src/mount";

function session(): PySession {
  const s = PySession.create();
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

test("pyToolName maps each frame to its tool name", () => {
  assert.equal(pyToolName(), "execute_python");
  assert.equal(pyToolName("program"), "execute_python_program");
  assert.equal(pyToolName("workflow"), "execute_python_workflow");
});

test("the eval tool is named for its frame", () => {
  assert.equal(buildExecutePythonTool(session()).name, "execute_python");
  assert.equal(buildExecutePythonTool(session(), { frame: "program" }).name, "execute_python_program");
  assert.equal(buildExecutePythonTool(session(), { frame: "workflow" }).name, "execute_python_workflow");
});

test("repl framing is the exported preamble; workflow framing de-REPLs it", () => {
  assert.equal(buildPyPreambleBody("repl"), PY_PREAMBLE);
  const wf = buildPyPreambleBody("workflow");
  assert.match(wf, /execute_python_workflow/);
  assert.match(wf, /WORKFLOWS/);
  assert.doesNotMatch(wf, /persistent Python REPL/);
  assert.match(wf, /ONE workflow per task/);
  assert.match(wf, /RECOVERY aid/);
});

test("mounting a frame folds exactly that tool name and primes with its framing", () => {
  const { g, folded } = fakeRunnable();
  mountPy(g as never, { session: session(), frame: "workflow", discovery: "full" });
  assert.ok(folded.includes("execute_python_workflow"), `expected execute_python_workflow in ${folded.join(",")}`);
  assert.ok(!folded.includes("execute_python"), "plain execute_python should not be folded under the workflow frame");
  assert.match(g.getSystemPrompt(), /execute_python_workflow/);
});

test("the runtime is identical across frames — a workflow-framed tool still executes", async () => {
  const tool = buildExecutePythonTool(session(), { frame: "workflow" });
  const res = await tool.do(
    { code: "len(github.list_pull_requests(state='open'))" },
    undefined as never,
    undefined as never,
    undefined,
  );
  assert.equal(res.status, "success");
  assert.equal((res.data as { value: unknown }).value, 1);
});
