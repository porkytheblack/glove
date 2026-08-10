/**
 * Asking the person a question mid-task.
 *
 * There was no channel at all, and the observed behaviour was not "the agent
 * asks in prose": models invented an `ask_user` tool and spent turns on "no
 * such tool", or — in a turn-capped loop, where ending the turn to ask *is*
 * failing the run — guessed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkingEnvironment, buildPreamble } from "../src/index";
import { call, callOk } from "./helpers";

test("ask_user is absent until the host wires onAsk", async () => {
  const env = await createWorkingEnvironment({});
  try {
    assert.equal(env.tools.some((t) => t.name === "ask_user"), false);
    // …and nothing primes the model for a verb it does not have.
    assert.doesNotMatch(buildPreamble(env), /ask_user/);
    assert.equal(await env.fs.exists("/skills/asking.md"), false);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("ask_user returns the host's answer to the model", async () => {
  const asked: Array<{ question: string; options?: string[] }> = [];
  const env = await createWorkingEnvironment({
    onAsk: async (q) => {
      asked.push(q);
      return "  Q2 (512 rows)  ";
    },
  });
  try {
    assert.ok(env.tools.some((t) => t.name === "ask_user"));
    const answer = await callOk(env, "ask_user", {
      question: "Two sheets are named Revenue. Which should the report use?",
      options: ["Q1 (480 rows)", "Q2 (512 rows)"],
    });
    assert.equal(answer, "Q2 (512 rows)", "the answer did not reach the model verbatim");
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0].options, ["Q1 (480 rows)", "Q2 (512 rows)"]);

    // The skill and the preamble line appear only now.
    assert.match(await env.fs.readFile("/skills/asking.md"), /ask_user/);
    assert.match(await env.fs.readFile("/skills/README.md"), /asking/);
    assert.match(buildPreamble(env), /ask_user\(question, options\)/);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("an empty answer is reported as no answer, not as consent", async () => {
  const env = await createWorkingEnvironment({ onAsk: async () => "   " });
  try {
    const result = await call(env, "ask_user", { question: "Overwrite /out/report.pdf?" });
    assert.equal(result.status, "error");
    assert.match(String(result.message), /did not respond/);
    // It tells the model what to do instead of asking again.
    assert.match(String(result.message), /assumption/);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("a host that throws does not take the run down with it", async () => {
  const env = await createWorkingEnvironment({
    onAsk: async () => {
      throw new Error("the prompt timed out after 60s");
    },
  });
  try {
    const result = await call(env, "ask_user", { question: "Which sheet?" });
    assert.equal(result.status, "error");
    assert.match(String(result.message), /timed out after 60s/);
  } finally {
    await env.close({ graceMs: 100 });
  }
});

test("ask_user validates its input", async () => {
  const env = await createWorkingEnvironment({ onAsk: async () => "yes" });
  try {
    assert.match(String((await call(env, "ask_user", {})).message), /non-empty string/);
    assert.match(String((await call(env, "ask_user", { question: "  " })).message), /non-empty string/);
    assert.match(
      String((await call(env, "ask_user", { question: "Which?", options: "a" })).message),
      /array of strings/,
    );
    // An options array that is empty after trimming is the same as no options.
    assert.equal(await callOk(env, "ask_user", { question: "Which?", options: ["", "  "] }), "yes");
  } finally {
    await env.close({ graceMs: 100 });
  }
});
