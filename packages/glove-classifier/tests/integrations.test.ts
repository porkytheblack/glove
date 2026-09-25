import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { JsSession } from "glove-js";
import { defineTransmissionEvent, defineTransmissionPredicate } from "glove-foundry";
import { createAdapterTestEnv } from "glove-working-environment/testing";
import {
  answerFromDistribution,
  choice,
  classifierFns,
  classifyMany,
  mountClassifier,
  newClassifierUsage,
  noul,
  withClassifier,
  type ClassifierAdapter,
  type Questions,
} from "../src/index";
import { classifierEnv } from "../src/env";
import { classifierPredicate, classifyInbound } from "../src/foundry";

/**
 * A deterministic stand-in classifier: nouls are "yes" when the state
 * mentions the word after "mention " in the question, choices pick the label
 * that appears in the state. Records every state it saw.
 */
function keywordClassifier() {
  const seen: unknown[] = [];
  const adapter: ClassifierAdapter = {
    name: "keywords",
    async classify(request) {
      seen.push(request.state);
      const text = JSON.stringify(request.state).toLowerCase();
      const answers: Record<string, unknown> = {};
      for (const [id, q] of Object.entries(request.questions)) {
        if (q.type === "noul") {
          const word = String(q.instructions).toLowerCase().match(/mention (\w+)/)?.[1] ?? "";
          answers[id] = answerFromDistribution(q, { true: text.includes(word) ? 0.9 : 0.1 });
        } else if (q.type === "choice") {
          const labels = Object.keys(q.criteria);
          const hit = labels.find((l) => text.includes(l));
          answers[id] = answerFromDistribution(q, Object.fromEntries(labels.map((l) => [l, l === hit ? 8 : 1])));
        } else {
          answers[id] = answerFromDistribution(q, { "0": 1, "1": 1 });
        }
      }
      return { model: "keywords-1", answers: answers as any, usage: { input_tokens: 10, output_tokens: 1 } };
    },
  };
  return { adapter, seen };
}

const inbox = [
  { id: "m1", label: "Invoice", state: "Please refund my duplicate charge" },
  { id: "m2", label: "Hello", state: "Just saying hi" },
  { id: "m3", label: "Broken", state: "The app crashes on refund page" },
];
const refundQ: Questions = { refund: noul("Does it mention refund?") };

describe("classifyMany", () => {
  it("classifies every item in parallel and captures per-item failures", async () => {
    const { adapter } = keywordClassifier();
    let active = 0;
    let peak = 0;
    const flaky: ClassifierAdapter = {
      name: "flaky",
      async classify(req, opts) {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        if (req.state === "Just saying hi") throw new Error("boom");
        return adapter.classify(req, opts);
      },
    };
    const res = await classifyMany(flaky, inbox, refundQ, { concurrency: 3 });
    assert.equal(peak, 3);
    assert.equal(res.items[1]!.error, "boom");
    assert.ok((res.items[0]!.answers!.refund as { noul: number }).noul > 0.5);
    assert.deepEqual(res.usage, { input_tokens: 20, output_tokens: 2 });
  });
});

describe("mountClassifier", () => {
  function stubGlove() {
    const tools = new Map<string, any>();
    return { tools, fold: (t: any) => void tools.set(t.name, t) };
  }
  const run = (tool: any, input: unknown) => tool.do(tool.inputSchema.parse(input), {}, {}, undefined);

  it("folds classify, batch, source and catalog tools", () => {
    const glove = stubGlove();
    const mount = mountClassifier(glove, { classifier: keywordClassifier().adapter });
    assert.deepEqual(mount.toolNames, [
      "glove_classify",
      "glove_classify_batch",
      "glove_classify_source",
      "glove_classify_catalog",
    ]);
    assert.deepEqual([...glove.tools.keys()], mount.toolNames);
  });

  it("classifies a source without returning its content", async () => {
    const glove = stubGlove();
    const { adapter, seen } = keywordClassifier();
    const mount = mountClassifier(glove, {
      classifier: adapter,
      presets: { refunds: { description: "Refund triage", questions: refundQ } },
    });
    mount.addSource("inbox", { description: "Support inbox", load: () => inbox });

    const res = await run(glove.tools.get("glove_classify_source"), {
      source: "inbox",
      preset: "refunds",
      where: { question: "refund" },
    });
    assert.equal(res.status, "success");
    assert.deepEqual(res.data.results.map((r: any) => r.id), ["m1", "m3"]);
    assert.equal(res.data.total, 3);
    assert.equal(res.data.matched, 2);
    assert.equal(seen.length, 3);
    // The agent-facing data carries ids, labels and answers — never the states.
    assert.ok(!JSON.stringify(res.data).includes("duplicate charge"));
    assert.deepEqual(mount.usage(), { calls: 3, input_tokens: 30, output_tokens: 3 });
  });

  it("batches agent-held items, merges preset + extra questions, and caps results", async () => {
    const glove = stubGlove();
    mountClassifier(glove, {
      classifier: keywordClassifier().adapter,
      presets: { refunds: { questions: refundQ } },
      resultLimit: 1,
    });
    const res = await run(glove.tools.get("glove_classify_batch"), {
      items: inbox,
      preset: "refunds",
      questions: { hi: noul("Does it mention hi?") },
    });
    assert.equal(res.data.matched, 3);
    assert.equal(res.data.truncated, true);
    assert.deepEqual(Object.keys(res.data.results[0].answers), ["refund", "hi"]);
  });

  it("uses named classifiers and reports unknown names as tool errors", async () => {
    const glove = stubGlove();
    const other = keywordClassifier();
    mountClassifier(glove, { classifier: keywordClassifier().adapter, classifiers: { alt: other.adapter } });
    await run(glove.tools.get("glove_classify"), { state: "refund please", questions: refundQ, classifier: "alt" });
    assert.equal(other.seen.length, 1);

    const bad = await run(glove.tools.get("glove_classify"), { state: "x", preset: "nope" });
    assert.equal(bad.status, "error");
    assert.match(bad.message, /unknown preset "nope"/);
    const none = await run(glove.tools.get("glove_classify"), { state: "x" });
    assert.match(none.message, /pass `questions`, a `preset`, or both/);
  });

  it("lists presets and sources in the catalog, including ones added later", async () => {
    const glove = stubGlove();
    const mount = mountClassifier(glove, { classifier: keywordClassifier().adapter });
    mount.addPreset("refunds", { description: "Refund triage", questions: refundQ });
    mount.addSource("inbox", { description: "Support inbox", load: () => inbox });
    const res = await glove.tools.get("glove_classify_catalog").do({}, {}, {}, undefined);
    assert.deepEqual(res.data.presets, [{ name: "refunds", description: "Refund triage", questions: { refund: "noul" } }]);
    assert.deepEqual(res.data.sources, [{ name: "inbox", description: "Support inbox" }]);
    mount.removeSource("inbox");
    const after = await glove.tools.get("glove_classify_catalog").do({}, {}, {}, undefined);
    assert.deepEqual(after.data.sources, []);
  });
});

describe("classifierFns in a REPL", () => {
  it("lets a JS program triage items and return only ids", async () => {
    const { adapter, seen } = keywordClassifier();
    const usage = newClassifierUsage();
    const session = JsSession.create();
    session.registerAll(classifierFns(adapter, { usage }));
    const items = JSON.stringify(inbox);
    const result = await session.execute(`
      const hits = classifier.many({
        items: ${items},
        questions: { refund: { type: "noul", instructions: "Does it mention refund?" } },
        where: { question: "refund", min: 0.5 },
      });
      const p = classifier.is({ state: "no refunds here", question: "Does it mention refund?" });
      const team = classifier.pick({ state: "billing issue", question: "Which team?", labels: ["billing", "sales"] });
      ({ ids: hits.map(h => h.id), p, team: team.choice })
    `);
    assert.deepEqual(result.value, { ids: ["m1", "m3"], p: 0.9, team: "billing" });
    assert.equal(seen.length, 5);
    assert.equal(usage.calls, 5);
  });

  it("validates arguments before calling the classifier", async () => {
    const fns = classifierFns(keywordClassifier().adapter, { namespace: null });
    assert.deepEqual(fns.map((f) => f.name), ["classify", "many", "is", "pick", "rate"]);
    await assert.rejects(fns[2]!.call({ state: "x" }), /is: question/);
  });
});

describe("classifierEnv in a working environment", () => {
  it("exposes env:classifier to scripts", async () => {
    const { adapter } = keywordClassifier();
    const t = await createAdapterTestEnv(classifierEnv(adapter));
    try {
      const value = await t.script(`import { many, is } from 'env:classifier';
        export default async function main() {
          const hits = await many({
            items: ${JSON.stringify(inbox)},
            questions: { refund: { type: 'noul', instructions: 'Does it mention refund?' } },
            where: { question: 'refund' },
          });
          return { ids: hits.map(h => h.id), p: await is({ state: 'hello', question: 'Does it mention refund?' }) };
        }`);
      assert.deepEqual(value, { ids: ["m1", "m3"], p: 0.1 });
      const readme = await t.fs.readFile("/std/classifier/README.md");
      assert.match(String(readme), /many\(\{ items, questions, where \}\)/);
    } finally {
      await t.env.close();
    }
  });
});

describe("withClassifier on a browser adapter", () => {
  function fakeBrowser() {
    const observed: unknown[] = [];
    let closed = false;
    return {
      observed,
      isClosed: () => closed,
      adapter: {
        name: "fake",
        operations: [
          {
            name: "observe",
            description: "observe",
            inputSchema: {},
            async execute(input: unknown) {
              observed.push(input);
              return { status: "success" as const, data: "<h1>Checkout complete — refund issued</h1>" };
            },
          },
        ],
        resourceIds: () => ["s1"],
        uncertainCreations: () => 0,
        async close() {
          closed = true;
        },
      },
    };
  }

  it("adds a judge operation that returns answers but not the page", async () => {
    const browser = fakeBrowser();
    const decorated = withClassifier(browser.adapter, { classifier: keywordClassifier().adapter });
    const judge = decorated.operations.find((o) => o.name === "judge")!;
    const res = await judge.execute({ sessionId: "s1", mode: "dom", questions: refundQ });
    assert.equal(res.status, "success");
    assert.ok((res.data as any).answers.refund.noul > 0.5);
    assert.ok(!JSON.stringify(res).includes("Checkout complete"));
    assert.deepEqual(browser.observed, [{ sessionId: "s1", mode: "dom" }]);

    assert.deepEqual(decorated.resourceIds(), ["s1"]);
    await decorated.close();
    assert.equal(browser.isClosed(), true);
  });

  it("rejects invalid questions and adapters without observe", async () => {
    const browser = fakeBrowser();
    const judge = withClassifier(browser.adapter, { classifier: keywordClassifier().adapter }).operations.at(-1)!;
    const res = await judge.execute({ sessionId: "s1", questions: {} });
    assert.equal(res.status, "error");
    assert.equal(browser.observed.length, 0);
    assert.throws(
      () => withClassifier({ ...browser.adapter, operations: [] }, { classifier: keywordClassifier().adapter }),
      /no "observe" operation/,
    );
  });
});

describe("Foundry transmissions", () => {
  type Ticket = { subject: string; body: string };
  const ticket: Ticket = { subject: "Help", body: "I need a refund for order 12" };

  it("classifierPredicate matches playbooks on classifier answers, with parameter overrides", async () => {
    const { adapter, seen } = keywordClassifier();
    const predicate = defineTransmissionPredicate(
      classifierPredicate<Ticket>({
        classifier: adapter,
        questions: refundQ,
        where: { question: "refund", min: 0.5 },
        state: (e) => e.body,
      }),
    );
    const ctx = { route: {} } as any;
    assert.equal(await Effect.runPromise(predicate.match(ticket, {}, ctx)), true);
    assert.equal(await Effect.runPromise(predicate.match(ticket, { min: 0.95 }, ctx)), false);
    assert.deepEqual(seen, [ticket.body, ticket.body]);
    assert.match(predicate.description!, /refund ≥ 0.5/);
  });

  it("classifyInbound resolves the event definition, falling back on low confidence", async () => {
    const refund = defineTransmissionEvent({ direction: "inbound", description: "Refund" });
    const bug = defineTransmissionEvent({ direction: "inbound", description: "Bug" });
    const general = defineTransmissionEvent({ direction: "inbound", description: "Other" });
    const classify = classifyInbound({
      classifier: keywordClassifier().adapter,
      question: choice("What is this?", ["refund", "bug", "other"]),
      events: { refund, bug },
      fallback: general,
      minConfidence: 0.5,
      state: (e: Ticket) => e.body,
    });
    assert.equal(await Effect.runPromise(classify(ticket, {})), refund);
    assert.equal(await Effect.runPromise(classify({ subject: "", body: "nothing here" }, {})), general);
  });
});
