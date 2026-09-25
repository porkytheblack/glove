import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  choice,
  ClassifierError,
  decider,
  gliclass,
  huggingfaceZeroShot,
  kev,
  labelScorer,
  laya,
  noul,
  rizzo,
  score,
  scoresFor,
  systemOne,
  von,
} from "../src/index";

const questions = {
  urgent: noul("Does this convey urgency?"),
  team: choice("Which team?", { billing: "Payments", technical: "Bugs", sales: null }),
  mood: score("How frustrated?", ["Calm", "Frustrated", "Very angry"]),
};

type Call = { url: string; init: RequestInit; body: any };
function fakeFetch(respond: (call: Call) => unknown, status = 200) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const call = { url, init, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return new Response(JSON.stringify(respond(call)), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetch };
}

describe("systemOne: any /v1/systemone server", () => {
  it("sends no auth header when there is no key, and tolerates sparse responses", async () => {
    // A minimal server: no model, no usage, no confidence, no legend — plus unknown extras.
    const { calls, fetch } = fakeFetch(() => ({
      answers: {
        urgent: { type: "noul", noul: 0.8 },
        team: { type: "choice", choice: "billing", probabilities: { billing: 0.9, technical: 0.1, sales: 0 } },
        mood: { type: "score", probabilities: { "0": 0, "1": 0.5, "2": 0.5 } },
      },
      latency_ms: 12,
      x_rizzo: { ok: true },
    }));
    const clf = systemOne({ baseURL: "http://127.0.0.1:9999/", model: "local-1", fetch });
    const res = await clf.classify({ state: "help", questions });

    assert.equal(calls[0]!.url, "http://127.0.0.1:9999/v1/systemone");
    assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, undefined);
    assert.equal(calls[0]!.body.model, "local-1");
    assert.equal(res.model, "local-1"); // filled from the request
    assert.deepEqual(res.usage, { input_tokens: 0, output_tokens: 0 });
    assert.ok(Math.abs(res.answers.team.confidence - (3 * 0.9 - 1) / 2) < 1e-9);
    assert.equal(res.answers.mood.score, 1.5);
    assert.deepEqual(res.answers.mood.legend, { "0": "Calm", "1": "Frustrated", "2": "Very angry" });
    assert.equal(clf.name, "system-one:local-1");
  });

  it("accepts a choice answer given only as a label", async () => {
    const { fetch } = fakeFetch(() => ({ answers: { team: { choice: "sales" } } }));
    const res = await systemOne({ baseURL: "http://x", model: "m", fetch }).classify({ state: "s", questions: { team: questions.team } });
    assert.equal(res.answers.team.choice, "sales");
    assert.equal(res.answers.team.confidence, 1);
  });

  it("rejects a response with the wrong answer type", async () => {
    const { fetch } = fakeFetch(() => ({ answers: { urgent: { type: "choice", choice: "yes" } } }));
    await assert.rejects(
      systemOne({ baseURL: "http://x", model: "m", fetch }).classify({ state: "s", questions: { urgent: questions.urgent } }),
      (e: unknown) => e instanceof ClassifierError && e.code === "bad_response",
    );
  });

  it("requires a key only when asked to", () => {
    assert.throws(() => systemOne({ baseURL: "http://x", model: "m", requireApiKey: true }), /No API key/);
    assert.doesNotThrow(() => systemOne({ baseURL: "http://x", model: "m" }));
  });

  it("lists models from either { models } or OpenAI-style { data }", async () => {
    const a = fakeFetch(() => ({ models: [{ name: "kev-latest" }] }));
    assert.deepEqual(await systemOne({ baseURL: "http://x", model: "m", fetch: a.fetch }).listModels(), [{ name: "kev-latest" }]);
    const b = fakeFetch(() => ({ data: [{ id: "rizzo-latest" }] }));
    assert.deepEqual(await systemOne({ baseURL: "http://x", model: "m", fetch: b.fetch }).listModels(), [{ name: "rizzo-latest" }]);
  });
});

describe("open-model presets", () => {
  it("use each project's documented address, model and auth variable", async () => {
    const saved = { ...process.env };
    try {
      delete process.env.KEV_BASE_URL;
      process.env.KEV_API_KEY = "kev-secret";
      const cases: Array<[ReturnType<typeof kev>, string, string]> = [
        [kev(), "http://127.0.0.1:8009", "kev-latest"],
        [laya(), "http://127.0.0.1:8000", "auto"],
        [von(), "http://localhost:8000", "von-1.2.0"],
        [rizzo(), "http://127.0.0.1:8017", "rizzo-latest"],
        [decider(), "http://127.0.0.1:8000", "decider"],
      ];
      for (const [clf, url, model] of cases) {
        assert.equal(clf.baseURL, url);
        assert.equal(clf.model, model);
      }
      const { calls, fetch } = fakeFetch(() => ({ answers: { urgent: { type: "noul", noul: 0.5 } } }));
      await kev({ fetch }).classify({ state: "s", questions: { urgent: questions.urgent } });
      assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer kev-secret");
      process.env.LAYA_BASE_URL = "http://gpu-box:8000";
      assert.equal(laya().baseURL, "http://gpu-box:8000");
    } finally {
      process.env = saved;
    }
  });

  it("enforce server limits locally", async () => {
    const { calls, fetch } = fakeFetch(() => ({}));
    const many = choice("Which letter?", Array.from({ length: 30 }, (_, i) => `opt${i}`));
    await assert.rejects(rizzo({ fetch }).classify({ state: "s", questions: { q: many } }), /rizzo accepts at most 26 choice labels \(got 30\)/);
    await assert.rejects(
      laya({ fetch }).classify({ state: "s", questions: { q: score("?", ["low", null]) } }),
      /laya needs a description for every score level/,
    );
    assert.equal(calls.length, 0);
  });
});

describe("label scorers", () => {
  it("map noul, choice and score onto label scoring", async () => {
    const seen: Array<{ labels: string[]; multiLabel: boolean }> = [];
    const clf = labelScorer({
      name: "fake-nli",
      async score({ labels, multiLabel }) {
        seen.push({ labels, multiLabel });
        return labels.map((l) => (/urgency|billing|Frustrated$/.test(l) ? 0.8 : 0.1));
      },
    });
    const res = await clf.classify({ state: { text: "help" }, questions });
    assert.ok(Math.abs(res.answers.urgent.noul - 0.8) < 1e-9); // "Does this convey urgency?" → one hypothesis, scored alone
    assert.equal(res.answers.team.choice, "billing");
    assert.equal(res.answers.mood.score, 1);
    assert.deepEqual(
      seen.map((s) => s.multiLabel),
      [true, false, false],
    );
    assert.deepEqual(seen[1]!.labels, ["billing: Payments", "technical: Bugs", "sales"]);
  });

  it("scores yes against no when both are described", async () => {
    const clf = labelScorer({ name: "x", score: async ({ labels }) => labels.map((l) => (l === "asks for money" ? 3 : 1)) });
    const res = await clf.classify({
      state: "refund pls",
      questions: { r: noul("Refund?", { true: "asks for money", false: "does not" }) },
    });
    assert.equal(res.answers.r.noul, 0.75);
  });

  it("reads the common response shapes", () => {
    assert.deepEqual(scoresFor(["a", "b"], [{ label: "b", score: 0.7 }, { label: "a", score: 0.3 }]), [0.3, 0.7]);
    assert.deepEqual(scoresFor(["a", "b"], { labels: ["b", "a"], scores: [0.6, 0.4] }), [0.4, 0.6]);
    assert.deepEqual(scoresFor(["a", "b"], [[{ label: "a", score: 1 }]]), [1, 0]);
    assert.throws(() => scoresFor(["a"], { nope: true }), /no label scores/);
  });

  it("huggingfaceZeroShot posts the Inference API shape", async () => {
    const { calls, fetch } = fakeFetch((c) => c.body.parameters.candidate_labels.map((label: string, i: number) => ({ label, score: i === 0 ? 0.9 : 0.1 })));
    const clf = huggingfaceZeroShot({ apiKey: "hf_x", fetch });
    const res = await clf.classify({ state: "refund please", questions: { team: questions.team } });
    assert.equal(calls[0]!.url, "https://router.huggingface.co/hf-inference/models/facebook/bart-large-mnli");
    assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer hf_x");
    assert.equal(calls[0]!.body.inputs, "refund please");
    assert.equal(calls[0]!.body.parameters.multi_label, false);
    assert.equal(res.answers.team.choice, "billing");
    assert.equal(clf.name, "huggingface:facebook/bart-large-mnli");
  });

  it("gliclass posts to its server with threshold 0", async () => {
    const { calls, fetch } = fakeFetch((c) => c.body.labels.map((label: string) => ({ label, score: label.startsWith("technical") ? 0.9 : 0.05 })));
    const res = await gliclass({ baseURL: "http://127.0.0.1:8000", fetch }).classify({ state: "app crashes", questions: { team: questions.team } });
    assert.equal(calls[0]!.url, "http://127.0.0.1:8000/gliclass");
    assert.deepEqual(calls[0]!.body, { texts: "app crashes", labels: ["billing: Payments", "technical: Bugs", "sales"], threshold: 0 });
    assert.equal(res.answers.team.choice, "technical");
  });

  it("surfaces HTTP failures as ClassifierError", async () => {
    const { fetch } = fakeFetch(() => ({ error: "bad token" }), 401);
    await assert.rejects(
      huggingfaceZeroShot({ apiKey: "bad", fetch }).classify({ state: "s", questions: { team: questions.team } }),
      (e: unknown) => e instanceof ClassifierError && e.code === "auth",
    );
  });
});
