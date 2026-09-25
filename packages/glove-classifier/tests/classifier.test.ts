import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AbortError, type ModelAdapter, type PromptRequest } from "glove-core/core";
import { z } from "zod";
import {
  answerConfidence,
  answerFromDistribution,
  assertValidRequest,
  cascade,
  choice,
  classifierTool,
  ClassifierError,
  defineClassifierTool,
  distributionConfidence,
  gate,
  jev,
  llmClassifier,
  noul,
  normalizeQuestions,
  parseAnswers,
  score,
  typesafe,
  type ClassifierAdapter,
  type ClassifyRequest,
  type Questions,
} from "../src/index";

const ticket = "Help! My payouts have been failing for 3 days.";

const questions = {
  is_urgent: noul("Does this convey urgency?"),
  department: choice("Which team should handle this?", {
    billing: "Payments, invoicing, refunds",
    technical: "Bugs, outages, integrations",
    sales: "Pricing, upgrades, new accounts",
  }),
  frustration: score("How frustrated is the customer?", ["Calm", "Frustrated", "Very angry"]),
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const jevResponse = {
  model: "jev-1.13.0",
  answers: {
    is_urgent: { type: "noul", noul: 0.95 },
    department: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.88, technical: 0.12, sales: 0.0 },
      confidence: 0.81,
    },
    frustration: {
      type: "score",
      score: 1.05,
      legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
      probabilities: { "0": 0.0, "1": 0.95, "2": 0.05 },
      confidence: 0.92,
    },
  },
  usage: { input_tokens: 296, output_tokens: 20 },
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

type Call = { url: string; init: RequestInit; body: any };

function recordingFetch(responses: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return next();
  };
  return { calls, fetch };
}

function fakeModel(replies: string[]): ModelAdapter & { systems: string[]; requests: PromptRequest[] } {
  let i = 0;
  let system = "";
  const systems: string[] = [];
  const requests: PromptRequest[] = [];
  return {
    name: "fake-llm",
    systems,
    requests,
    setSystemPrompt(s: string) {
      system = s;
    },
    async prompt(request: PromptRequest) {
      systems.push(system);
      requests.push(request);
      const text = replies[Math.min(i++, replies.length - 1)]!;
      return { messages: [{ sender: "agent", text }], tokens_in: 10, tokens_out: 5 };
    },
  };
}

function fixedClassifier(name: string, build: (req: ClassifyRequest<Questions>) => Record<string, unknown>) {
  const seen: Array<ClassifyRequest<Questions>> = [];
  const adapter: ClassifierAdapter = {
    name,
    async classify(request) {
      seen.push(request);
      return {
        model: name,
        answers: build(request) as any,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
  };
  return { adapter, seen };
}

// ─── Questions ───────────────────────────────────────────────────────────────

describe("question builders", () => {
  it("build the TypeSafe wire shapes", () => {
    assert.deepEqual(noul("Urgent?"), { type: "noul", instructions: "Urgent?" });
    assert.deepEqual(noul("Urgent?", { true: "yes", false: "no" }), {
      type: "noul",
      instructions: "Urgent?",
      criteria: { true: "yes", false: "no" },
    });
    assert.deepEqual(choice("Which?", ["a", "b"]), { type: "choice", instructions: "Which?", criteria: { a: null, b: null } });
    assert.deepEqual(score("How?", ["low", "high"]), { type: "score", instructions: "How?", criteria: ["low", "high"] });
  });

  it("reject malformed requests locally", () => {
    const bad = (q: unknown, re: RegExp) =>
      assert.throws(
        () => assertValidRequest({ state: "s", questions: { q } } as any),
        (e: unknown) => e instanceof ClassifierError && e.code === "invalid_request" && re.test(e.message),
      );
    bad({ type: "choice", criteria: { only: null } }, /at least two labels/);
    bad({ type: "score", criteria: ["one"] }, /at least two levels/);
    bad({ type: "score", criteria: Array.from({ length: 11 }, (_, i) => String(i)) }, /at most 10/);
    bad({ type: "maybe" }, /unknown question type/);
    assert.throws(() => assertValidRequest({ state: "s", questions: {} }), /at least one question/);
  });
});

// ─── Answers ─────────────────────────────────────────────────────────────────

describe("answers from distributions", () => {
  it("computes choice, score and confidence", () => {
    const c = answerFromDistribution(questions.department, { billing: 9, technical: 1 });
    assert.equal(c.choice, "billing");
    assert.equal(c.probabilities.sales, 0);
    assert.ok(Math.abs(c.probabilities.billing - 0.9) < 1e-9);
    assert.ok(Math.abs(c.confidence - (3 * 0.9 - 1) / 2) < 1e-9);

    const s = answerFromDistribution(questions.frustration, { "0": 0, "1": 0.5, "2": 0.5 });
    assert.equal(s.score, 1.5);
    assert.deepEqual(s.legend, { "0": "Calm", "1": "Frustrated", "2": "Very angry" });

    assert.equal(distributionConfidence([1 / 3, 1 / 3, 1 / 3]), 0);
    assert.equal(distributionConfidence([1, 0]), 1);
  });

  it("keeps a bare noul probability instead of normalizing it to 1", () => {
    assert.deepEqual(answerFromDistribution(questions.is_urgent, { true: 0.3 }), { type: "noul", noul: 0.3 });
    assert.deepEqual(answerFromDistribution(questions.is_urgent, { true: 1, false: 3 }), { type: "noul", noul: 0.25 });
  });

  it("gates on confidence, with noul certainty as distance from a coin flip", () => {
    assert.equal(answerConfidence({ type: "noul", noul: 0.5 }), 0);
    assert.equal(answerConfidence({ type: "noul", noul: 0.95 }), 0.8999999999999999);
    assert.equal(gate(0.9), "act");
    assert.equal(gate(0.6), "review");
    assert.equal(gate(0.2), "escalate");
    assert.equal(gate(0.6, { act: 0.5 }), "act");
  });
});

// ─── TypeSafe / Jev ──────────────────────────────────────────────────────────

describe("typesafe adapter", () => {
  it("posts state and questions to /v1/systemone and returns typed answers", async () => {
    const { calls, fetch } = recordingFetch([() => json(jevResponse)]);
    const model = jev({ apiKey: "ts-key", fetch });
    const result = await model.classify({ state: ticket, questions });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://api.typesafe.ai/v1/systemone");
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer ts-key");
    assert.equal(headers["Content-Type"], "application/json");
    assert.deepEqual(calls[0]!.body, { state: ticket, model: "jev-latest", questions });

    assert.equal(result.model, "jev-1.13.0");
    assert.equal(result.answers.department.choice, "billing");
    assert.equal(result.answers.is_urgent.noul, 0.95);
    assert.equal(result.answers.frustration.score, 1.05);
    assert.deepEqual(result.usage, { input_tokens: 296, output_tokens: 20 });
    assert.equal(model.name, "typesafe:jev-latest");
  });

  it("honours a per-call model and base URL overrides", async () => {
    const { calls, fetch } = recordingFetch([() => json(jevResponse)]);
    const model = typesafe({ apiKey: "k", baseURL: "https://proxy.test/", model: "jev-1.13.0", fetch });
    await model.classify({ state: ticket, questions, model: "jev-preview" });
    assert.equal(calls[0]!.url, "https://proxy.test/v1/systemone");
    assert.equal(calls[0]!.body.model, "jev-preview");
  });

  it("retries 529 Overloaded and honours retry-after-ms", async () => {
    const { calls, fetch } = recordingFetch([
      () => json({ detail: "overloaded" }, 529, { "retry-after-ms": "0" }),
      () => json(jevResponse),
    ]);
    const result = await jev({ apiKey: "k", fetch }).classify({ state: ticket, questions });
    assert.equal(calls.length, 2);
    assert.equal(result.answers.department.choice, "billing");
  });

  it("does not retry auth failures", async () => {
    const { calls, fetch } = recordingFetch([() => json({ detail: "bad key" }, 401)]);
    await assert.rejects(
      jev({ apiKey: "k", fetch }).classify({ state: ticket, questions }),
      (e: unknown) => e instanceof ClassifierError && e.code === "auth" && e.status === 401 && /bad key/.test(e.message),
    );
    assert.equal(calls.length, 1);
  });

  it("maps exhausted rate limits and validation errors", async () => {
    const limited = recordingFetch([() => json({}, 429, { "retry-after-ms": "0" })]);
    await assert.rejects(
      jev({ apiKey: "k", fetch: limited.fetch, maxRetries: 1 }).classify({ state: ticket, questions }),
      (e: unknown) => e instanceof ClassifierError && e.code === "rate_limited",
    );
    assert.equal(limited.calls.length, 2);

    const invalid = recordingFetch([() => json({ detail: [{ loc: ["body", "state"] }] }, 422)]);
    await assert.rejects(
      jev({ apiKey: "k", fetch: invalid.fetch }).classify({ state: ticket, questions }),
      (e: unknown) => e instanceof ClassifierError && e.code === "invalid_request" && e.status === 422,
    );
  });

  it("rejects a response missing an answer", async () => {
    const partial = { ...jevResponse, answers: { is_urgent: jevResponse.answers.is_urgent } };
    const { fetch } = recordingFetch([() => json(partial)]);
    await assert.rejects(
      jev({ apiKey: "k", fetch }).classify({ state: ticket, questions }),
      (e: unknown) => e instanceof ClassifierError && e.code === "bad_response" && /department/.test(e.message),
    );
  });

  it("surfaces caller aborts as AbortError without retrying", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetch = (_url: string, init: RequestInit = {}) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        controller.abort();
      });
    };
    await assert.rejects(
      jev({ apiKey: "k", fetch }).classify({ state: ticket, questions }, { signal: controller.signal }),
      AbortError,
    );
    assert.equal(calls, 1);
  });

  it("times out an attempt and retries it", async () => {
    let calls = 0;
    const fetch = (_url: string, init: RequestInit = {}) => {
      calls++;
      if (calls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      return Promise.resolve(json(jevResponse));
    };
    const result = await jev({ apiKey: "k", fetch, timeout: 20, backoffMs: 0 }).classify({ state: ticket, questions });
    assert.equal(calls, 2);
    assert.equal(result.model, "jev-1.13.0");
  });

  it("lists models", async () => {
    const { calls, fetch } = recordingFetch([
      () => json({ models: [{ name: "jev-latest", description: "Jev", release_date: "2026-09-15" }] }),
    ]);
    const models = await jev({ apiKey: "k", fetch }).listModels();
    assert.equal(calls[0]!.url, "https://api.typesafe.ai/v1/models");
    assert.equal(calls[0]!.init.method, "GET");
    assert.equal(models[0]!.name, "jev-latest");
  });

  it("requires an API key", () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      assert.throws(() => jev(), /TYPESAFE_API_KEY/);
      process.env.TYPESAFE_API_KEY = "from-env";
      assert.equal(jev({ fetch: async () => json(jevResponse) }).name, "typesafe:jev-latest");
    } finally {
      if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = saved;
    }
  });
});

// ─── LLM classifier ──────────────────────────────────────────────────────────

describe("llm classifier", () => {
  const reply = JSON.stringify({
    answers: {
      is_urgent: { true: 0.9, false: 0.1 },
      department: { billing: 0.2, technical: 0.7, sales: 0.1 },
      frustration: { probabilities: { "0": 0.1, "1": 0.8, "2": 0.1 } },
    },
  });

  it("asks for distributions and builds typed answers", async () => {
    const model = fakeModel(["```json\n" + reply + "\n```"]);
    const result = await llmClassifier({ model }).classify({ state: ticket, questions });

    assert.equal(result.model, "fake-llm");
    assert.equal(result.answers.department.choice, "technical");
    assert.ok(Math.abs(result.answers.is_urgent.noul - 0.9) < 1e-9);
    assert.ok(Math.abs(result.answers.frustration.score - 1) < 1e-9);
    assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 5 });

    assert.match(model.systems[0]!, /You are a classifier/);
    const sent = JSON.parse(model.requests[0]!.messages[0]!.text);
    assert.equal(sent.state, ticket);
    assert.deepEqual(sent.questions.is_urgent.options, { true: "yes", false: "no" });
    assert.deepEqual(sent.questions.frustration.options, { "0": "Calm", "1": "Frustrated", "2": "Very angry" });
  });

  it("retries an unparseable reply, then gives up with bad_response", async () => {
    const recovered = fakeModel(["not json", reply]);
    const result = await llmClassifier({ model: recovered }).classify({ state: ticket, questions });
    assert.equal(result.answers.department.choice, "technical");
    assert.deepEqual(result.usage, { input_tokens: 20, output_tokens: 10 });

    const broken = fakeModel(['{"answers": {"is_urgent": {"true": 1}}}']);
    await assert.rejects(
      llmClassifier({ model: broken }).classify({ state: ticket, questions }),
      (e: unknown) => e instanceof ClassifierError && e.code === "bad_response" && /department/.test(e.message),
    );
    assert.equal(broken.requests.length, 2);
  });

  it("serializes concurrent calls through the stateful adapter", async () => {
    let active = 0;
    let maxActive = 0;
    const model: ModelAdapter = {
      name: "slow",
      setSystemPrompt() {},
      async prompt() {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { messages: [{ sender: "agent", text: reply }], tokens_in: 1, tokens_out: 1 };
      },
    };
    const clf = llmClassifier({ model });
    await Promise.all([1, 2, 3].map(() => clf.classify({ state: ticket, questions })));
    assert.equal(maxActive, 1);
  });

  it("parses a flat reply without the answers wrapper", () => {
    const answers = parseAnswers('{"is_urgent": {"true": "0.4"}}', { is_urgent: noul("?") });
    assert.equal(answers.is_urgent.noul, 0.4);
  });
});

// ─── Cascade ─────────────────────────────────────────────────────────────────

describe("cascade", () => {
  it("re-asks only low-confidence questions of the fallback", async () => {
    const primary = fixedClassifier("fast", () => ({
      is_urgent: { type: "noul", noul: 0.97 },
      department: { type: "choice", choice: "billing", probabilities: { billing: 0.4, technical: 0.35, sales: 0.25 }, confidence: 0.1 },
      frustration: { type: "score", score: 1, legend: {}, probabilities: { "0": 0, "1": 1, "2": 0 }, confidence: 1 },
    }));
    const fallback = fixedClassifier("slow", () => ({
      department: { type: "choice", choice: "technical", probabilities: { billing: 0, technical: 1, sales: 0 }, confidence: 1 },
    }));
    const result = await cascade({ primary: primary.adapter, fallback: fallback.adapter }).classify({
      state: ticket,
      questions,
      model: "jev-1.13.0",
    });

    assert.deepEqual(result.escalated, ["department"]);
    assert.deepEqual(Object.keys(fallback.seen[0]!.questions), ["department"]);
    assert.equal(fallback.seen[0]!.model, undefined);
    assert.equal(result.answers.department.choice, "technical");
    assert.equal(result.answers.is_urgent.noul, 0.97);
    assert.deepEqual(result.usage, { input_tokens: 2, output_tokens: 2 });
    assert.equal(result.fallback?.model, "slow");
  });

  it("skips the fallback when everything is confident", async () => {
    const primary = fixedClassifier("fast", () => ({ is_urgent: { type: "noul", noul: 0.01 } }));
    const fallback = fixedClassifier("slow", () => ({}));
    const result = await cascade({ primary: primary.adapter, fallback: fallback.adapter }).classify({
      state: ticket,
      questions: { is_urgent: questions.is_urgent },
    });
    assert.deepEqual(result.escalated, []);
    assert.equal(fallback.seen.length, 0);
    assert.equal(result.fallback, undefined);
  });
});

// ─── Normalization ──────────────────────────────────────────────────────────

describe("normalizeQuestions", () => {
  it("accepts the shapes models write", () => {
    assert.deepEqual(
      normalizeQuestions({
        a: "Does it ask for a refund?",
        b: { type: "yes_no", question: "Urgent?" },
        c: { type: "classification", instructions: "Which team?", options: ["billing", { label: "sales", description: "Pricing" }] },
        d: { type: "rating", instructions: "How angry?", levels: { "1": "angry", "0": "calm" } },
        e: { instructions: "Which?", criteria: { x: null, y: null } },
        f: { type: "noul", instructions: "Spam?", criteria: { yes: "marketing", no: "real person" } },
      }),
      {
        a: { type: "noul", instructions: "Does it ask for a refund?" },
        b: { type: "noul", instructions: "Urgent?" },
        c: { type: "choice", instructions: "Which team?", criteria: { billing: null, sales: "Pricing" } },
        d: { type: "score", instructions: "How angry?", criteria: ["calm", "angry"] },
        e: { type: "choice", instructions: "Which?", criteria: { x: null, y: null } },
        f: { type: "noul", instructions: "Spam?", criteria: { true: "marketing", false: "real person" } },
      },
    );
  });

  it("explains what is wrong when it cannot read a question", () => {
    assert.throws(() => normalizeQuestions({ q: { type: "maybe" } }), /unknown type "maybe"/);
    assert.throws(() => normalizeQuestions({ q: 42 }), /expected an object/);
    assert.throws(() => normalizeQuestions({ q: { type: "choice", instructions: "?" } }), /a choice needs `criteria`/);
  });
});

// ─── Tools ───────────────────────────────────────────────────────────────────

describe("tools", () => {
  const display = {} as any;
  const glove = {} as any;

  it("classifierTool validates agent-written questions and returns compact answers", async () => {
    const { calls, fetch } = recordingFetch([() => json(jevResponse)]);
    const tool = classifierTool({ classifier: jev({ apiKey: "k", fetch }) });
    assert.equal(tool.name, "glove_classify");

    const input = tool.inputSchema!.parse({ state: ticket, questions });
    const result = await tool.do(input, display, glove);
    assert.equal(result.status, "success");
    assert.deepEqual((result.data as any).answers.frustration, {
      score: 1.05,
      confidence: 0.92,
      probabilities: { "0": 0, "1": 0.95, "2": 0.05 },
    });
    assert.equal((result.renderData as any).model, "jev-1.13.0");
    assert.deepEqual(calls[0]!.body.questions, questions);

    const bad = await tool.do(
      tool.inputSchema!.parse({ state: ticket, questions: { q: { type: "score", instructions: "?", criteria: ["one"] } } }),
      display,
      glove,
    );
    assert.equal(bad.status, "error");
    assert.match(bad.message!, /at least two levels/);
    // The schema must serialize for model adapters.
    assert.equal((z.toJSONSchema(tool.inputSchema!) as any).type, "object");
  });

  it("classifierTool reports classifier failures as tool errors", async () => {
    const { fetch } = recordingFetch([() => json({ detail: "nope" }, 401)]);
    const tool = classifierTool({ classifier: jev({ apiKey: "k", fetch }) });
    const result = await tool.do({ state: ticket, questions } as any, display, glove);
    assert.equal(result.status, "error");
    assert.match(result.message!, /^auth:/);
  });

  it("defineClassifierTool asks fixed questions over the agent's input", async () => {
    const { calls, fetch } = recordingFetch([() => json(jevResponse)]);
    const tool = defineClassifierTool({
      name: "triage_ticket",
      description: "Triage a support ticket.",
      classifier: jev({ apiKey: "k", fetch }),
      questions,
      format: (answers) => ({ route: answers.department.choice, urgent: answers.is_urgent.noul > 0.5 }),
    });
    const result = await tool.do(tool.inputSchema!.parse({ text: ticket }), display, glove);
    assert.equal(calls[0]!.body.state, ticket);
    assert.deepEqual(result.data, { route: "billing", urgent: true });
  });

  it("defineClassifierTool builds state from a custom input", async () => {
    const { calls, fetch } = recordingFetch([() => json(jevResponse)]);
    const tool = defineClassifierTool({
      name: "triage",
      description: "Triage.",
      classifier: jev({ apiKey: "k", fetch }),
      questions,
      input: z.object({ subject: z.string(), body: z.string() }),
      state: (input) => ({ subject: input.subject, body: input.body }),
    });
    await tool.do({ subject: "Payouts", body: ticket }, display, glove);
    assert.deepEqual(calls[0]!.body.state, { subject: "Payouts", body: ticket });
  });
});

// ─── Type inference (checked by `tsc --noEmit`) ─────────────────────────────

async function typeChecks(model: ClassifierAdapter) {
  const r = await model.classify({ state: ticket, questions });
  const dept: "billing" | "technical" | "sales" = r.answers.department.choice;
  const p: number = r.answers.department.probabilities.technical;
  const level: number = r.answers.frustration.probabilities["2"];
  const yes: number = r.answers.is_urgent.noul;
  // @ts-expect-error — not one of the labels
  const wrong: "refunds" = r.answers.department.choice;
  // @ts-expect-error — noul answers have no confidence field
  r.answers.is_urgent.confidence;
  return [dept, p, level, yes, wrong];
}
void typeChecks;
