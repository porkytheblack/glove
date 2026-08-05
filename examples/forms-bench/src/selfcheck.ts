/**
 * Exercise the whole harness against a scripted fake model — no network, no
 * spend.
 *
 * This is not a test of any model. It is a test of the *bench*: that the tool
 * bridge produces schemas a provider will accept, that the graders pass when
 * handed a perfect run and fail when handed a broken one, and that the context
 * ledger adds up. Running it before `pnpm bench` is the difference between a
 * failed cell meaning "the model struggled" and meaning "the harness is wrong".
 *
 *   pnpm selfcheck
 */
import { runAgent } from "./agent";
import { makeCell } from "./harness";
import { SCENARIOS } from "./scenarios";
import { bridgeFormTools } from "./tools";
import { discoveryTokens, formSurfaceTokens } from "./tokens";
import type { Completion, CompleteOpts, ToolCall } from "./openrouter";

let failures = 0;

function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/**
 * A fake model that plays back a fixed script of tool calls, one entry per
 * completion, then answers with text. Deterministic by construction.
 */
function scriptedModel(script: Array<{ tool?: string; args?: unknown; say?: string }>) {
  let i = 0;
  return async (_opts: CompleteOpts): Promise<Completion> => {
    const step = script[i++] ?? { say: "All done." };
    const toolCalls: ToolCall[] = step.tool
      ? [
          {
            id: `call_${i}`,
            type: "function",
            function: { name: step.tool, arguments: JSON.stringify(step.args ?? {}) },
          },
        ]
      : [];
    return {
      content: step.say ?? null,
      toolCalls,
      finishReason: toolCalls.length ? "tool_calls" : "stop",
      usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0 },
    };
  };
}

async function main(): Promise<void> {
  console.log("Tool bridge\n");
  {
    const cell = await makeCell();
    const tools = bridgeFormTools(cell.runner);
    check("seven verbs exposed", tools.length === 7, tools.map((t) => t.name).join(", "));
    for (const t of tools) {
      const params = t.schema.function.parameters as Record<string, unknown>;
      check(
        `${t.name} has an object schema`,
        params.type === "object" && typeof params.properties === "object",
      );
      check(`${t.name} carries no $schema`, !("$schema" in params));
      const json = JSON.stringify(params);
      const props = (params.properties ?? {}) as Record<string, any>;
      check(
        `${t.name} has no empty sub-schemas`,
        Object.values(props).every((v) => v && Object.keys(v).length > 0),
        json.slice(0, 120),
      );
      // The no-argument verb must stay no-argument — an over-eager normaliser
      // can invent a property here and every model will dutifully fill it in.
      if (t.name === "glove_form_list") {
        check("glove_form_list takes no arguments", Object.keys(props).length === 0, json);
      }
    }
  }

  console.log("\nTier 0\n");
  {
    const cell = await makeCell();
    const line = await cell.runner.tier0();
    check("names the open step", line.includes('step 1/4 "Claimant"'), line.split("\n")[0]);
    check("lists pending labels", line.includes("pending: Full name, Staff ID, Work email"));
    check("previews later steps", line.includes("later: Trip (destination, dates, purpose)"));
    check("carries conduct", line.includes("Don't read the field list aloud"));
    check(
      "stays small",
      line.length < 700,
      `${line.length} chars over ${line.split("\n").length} lines`,
    );
  }

  console.log("\nGraders — a perfect run must pass\n");
  {
    // Drive `straight-through` with a model that does everything right in one
    // call per turn. If this doesn't pass, no real model can.
    const cell = await makeCell();
    const scenario = SCENARIOS.find((s) => s.name === "straight-through")!;
    const transcript = await runAgent({
      runner: cell.runner,
      adapter: cell.adapter,
      compiled: cell.compiled,
      instanceId: cell.instanceId,
      model: "scripted/perfect",
      userTurns: scenario.userTurns,
      complete: scriptedModel([
        { say: "Happy to help — what's your name and staff id?" },
        {
          tool: "glove_form_fill",
          args: {
            values: {
              fullName: "Ada Okafor",
              staffId: "FN-4471",
              email: "ada.okafor@example.com",
            },
          },
        },
        { say: "Thanks. Where did you go?" },
        {
          tool: "glove_form_fill",
          args: {
            values: {
              destination: "Manchester",
              departDate: "2026-07-13",
              returnDate: "2026-07-15",
              purpose: "client-visit",
            },
          },
        },
        { say: "Got it. How did you travel?" },
        {
          tool: "glove_form_fill",
          args: { values: { mode: "car", mileage: 240, totalAmount: 132.5 } },
        },
        { say: "Nearly there — cost centre and manager?" },
        {
          tool: "glove_form_fill",
          args: {
            values: {
              costCentre: "OPS-220",
              managerEmail: "priya.nayar@example.com",
              receiptsAttached: true,
            },
          },
        },
        { say: "That's everything — your claim is complete." },
      ]),
    });
    const checks = await scenario.grade({
      compiled: cell.compiled,
      adapter: cell.adapter,
      subject: cell.subject,
      transcript,
    });
    const bad = checks.filter((c) => !c.ok);
    check(
      "perfect run passes every check",
      bad.length === 0,
      bad.map((c) => `${c.name}: ${c.detail ?? ""}`).join("; "),
    );

    const l = transcript.ledger;
    check("ledger counted every call", l.calls > 0 && l.promptTokens > 0);
    check("form surface is non-zero", formSurfaceTokens(l) > 0);
    check("discovery is non-zero", discoveryTokens(l) > 0);
    check(
      "eager baseline exceeds discovery",
      l.eagerBaselineTokens > discoveryTokens(l),
      `eager ${l.eagerBaselineTokens} vs discovery ${discoveryTokens(l)}`,
    );
    check("batching measured", transcript.behaviour.fieldsWritten === 13);
    check("no truncation on a clean run", transcript.behaviour.truncatedCompletions === 0);
    check("no empty completions on a clean run", transcript.behaviour.emptyCompletions === 0);
  }

  console.log("\nTruncation is reported, not scored as a miss\n");
  {
    // The exact shape a reasoning model returns when `max_tokens` runs out
    // mid-thought: finish_reason "length", no content, no tool call.
    const cell = await makeCell();
    const scenario = SCENARIOS.find((s) => s.name === "straight-through")!;
    const transcript = await runAgent({
      runner: cell.runner,
      adapter: cell.adapter,
      compiled: cell.compiled,
      instanceId: cell.instanceId,
      model: "scripted/starved",
      userTurns: scenario.userTurns.slice(0, 1),
      complete: async () => ({
        content: null,
        toolCalls: [],
        finishReason: "length",
        usage: { prompt_tokens: 100, completion_tokens: 1024, cost: 0 },
      }),
    });
    check("truncation counted", transcript.behaviour.truncatedCompletions === 1);
    check("empty completion counted", transcript.behaviour.emptyCompletions === 1);
  }

  console.log("\nGraders — a broken run must fail\n");
  {
    // A model that answers in prose and never records anything. Every value
    // check should fail; a grader that passes this is measuring nothing.
    const cell = await makeCell();
    const scenario = SCENARIOS.find((s) => s.name === "straight-through")!;
    const transcript = await runAgent({
      runner: cell.runner,
      adapter: cell.adapter,
      compiled: cell.compiled,
      instanceId: cell.instanceId,
      model: "scripted/lazy",
      userTurns: scenario.userTurns,
      complete: scriptedModel([{ say: "Sure, noted." }]),
    });
    const checks = await scenario.grade({
      compiled: cell.compiled,
      adapter: cell.adapter,
      subject: cell.subject,
      transcript,
    });
    check("silent run fails", checks.some((c) => !c.ok), `${checks.filter((c) => !c.ok).length} failed`);
  }

  console.log("\nHeld values survive a correction\n");
  {
    const cell = await makeCell();
    const scenario = SCENARIOS.find((s) => s.name === "held-value")!;
    const transcript = await runAgent({
      runner: cell.runner,
      adapter: cell.adapter,
      compiled: cell.compiled,
      instanceId: cell.instanceId,
      model: "scripted/held",
      userTurns: scenario.userTurns,
      complete: scriptedModel([
        {
          tool: "glove_form_fill",
          args: {
            values: {
              fullName: "Ada Okafor",
              staffId: "FN-4471",
              email: "ada.okafor@example.com",
              destination: "Bristol",
            },
          },
        },
        { say: "Thanks." },
        {
          tool: "glove_form_fill",
          args: {
            values: {
              purpose: "training",
              departDate: "2026-05-11",
              returnDate: "2026-05-13",
              mode: "rail",
              ticketReference: "RX40021",
              totalAmount: 96,
            },
          },
        },
        { say: "Noted." },
        { tool: "glove_form_fill", args: { values: { mode: "car", mileage: 360 } } },
        { say: "Updated to the car." },
        {
          tool: "glove_form_fill",
          args: {
            values: {
              costCentre: "OPS-220",
              managerEmail: "priya.nayar@example.com",
              receiptsAttached: true,
            },
          },
        },
        { say: "All set." },
      ]),
    });
    const checks = await scenario.grade({
      compiled: cell.compiled,
      adapter: cell.adapter,
      subject: cell.subject,
      transcript,
    });
    const bad = checks.filter((c) => !c.ok);
    check(
      "held-value scenario passes when driven correctly",
      bad.length === 0,
      bad.map((c) => `${c.name}: ${c.detail ?? ""}`).join("; "),
    );
  }

  console.log(
    `\n${failures === 0 ? "Harness looks sound." : `${failures} harness check(s) failed.`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
