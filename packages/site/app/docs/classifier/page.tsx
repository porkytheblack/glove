import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Classifier Models",
  description:
    "Fast, calibrated, typed decisions for Glove — TypeSafe's Jev or any classifier behind one adapter, with an LLM fallback, confidence-gated cascades, and agent tools.",
};

export default function ClassifierPage() {
  return (
    <div className="docs-content">
      <h1>Classifier Models</h1>

      <p>
        A classifier model doesn&apos;t write text. It takes a <strong>state</strong>{" "}
        (the thing being judged) and a map of typed <strong>questions</strong>, and
        returns one typed answer per question with the probability distribution
        behind it. <a href="https://docs.typesafe.ai/introduction">TypeSafe&apos;s Jev</a>{" "}
        is the flagship example: a &ldquo;System One&rdquo; model that answers in
        70–500&nbsp;ms, charges only for input tokens, and can&apos;t return a
        malformed answer.
      </p>
      <p>
        Jev can&apos;t sit behind a <code>ModelAdapter</code>, because it doesn&apos;t
        chat, stream or call tools. <code>glove-classifier</code> gives classifier
        models their own contract, <code>ClassifierAdapter</code>, and ships Jev, an
        LLM-backed classifier, a confidence-gated cascade, and tools for agents.
      </p>

      <CodeBlock filename="terminal" language="bash" code={`pnpm add glove-classifier`} />

      <h2 id="questions">Question types</h2>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Asks</th>
            <th>Answer</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>noul</code></td>
            <td>Is this statement true?</td>
            <td><code>noul</code>: probability of yes, 0–1</td>
          </tr>
          <tr>
            <td><code>choice</code></td>
            <td>Which of these labels?</td>
            <td><code>choice</code>, per-label <code>probabilities</code>, <code>confidence</code></td>
          </tr>
          <tr>
            <td><code>score</code></td>
            <td>Where on this rubric?</td>
            <td><code>score</code> (can land between levels), per-level <code>probabilities</code>, <code>confidence</code></td>
          </tr>
        </tbody>
      </table>
      <p>
        Names and wire shapes match TypeSafe&apos;s API. Ask atomic questions — each
        a judgement an expert could make in seconds — and combine them in code.
        Every question is judged in parallel in one call, so adding questions is
        nearly free.
      </p>

      <h2 id="jev">Jev</h2>
      <CodeBlock
        filename="triage.ts"
        language="typescript"
        code={`import { jev, noul, choice, score } from "glove-classifier";

const model = jev(); // TYPESAFE_API_KEY, model "jev-latest"

const { answers, model: served } = await model.classify({
  state: "Help! My payouts have been failing for 3 days.",
  questions: {
    is_urgent: noul("Does this convey urgency?"),
    department: choice("Which team should handle this?", {
      billing: "Payments, invoicing, refunds",
      technical: "Bugs, outages, integrations",
      sales: "Pricing, upgrades, new accounts",
    }),
    frustration: score("How frustrated is the customer?", ["Calm", "Frustrated", "Very angry"]),
  },
});

answers.department.choice;     // "billing" | "technical" | "sales" — typed from the labels
answers.department.confidence; // 0.81
answers.frustration.score;     // 1.05
answers.is_urgent.noul;        // 0.95
served;                        // "jev-1.13.0" — the versioned model that answered`}
      />
      <p>
        Options: <code>apiKey</code> (<code>TYPESAFE_API_KEY</code>),{" "}
        <code>baseURL</code> (<code>TYPESAFE_BASE_URL</code>), <code>model</code>{" "}
        (<code>TYPESAFE_DEFAULT_MODEL</code>, then <code>jev-latest</code>),{" "}
        <code>timeout</code> per attempt (10&nbsp;s), <code>maxRetries</code> (2),{" "}
        <code>backoffMs</code>, <code>headers</code> and <code>fetch</code>. 408,
        429 and 5xx responses (including 529 Overloaded) are retried with backoff,
        and <code>Retry-After</code> is honoured. Aborts raise glove-core&apos;s{" "}
        <code>AbortError</code>. Every other failure raises a{" "}
        <code>ClassifierError</code> with a <code>code</code>. Pin a versioned id
        such as <code>jev-1.13.0</code> when you have tuned thresholds against it,
        because aliases move when a new version ships.
      </p>

      <h2 id="models">Other classifier models</h2>
      <p>
        Jev defined the <code>POST /v1/systemone</code> contract, and open
        typed-decision models now serve it on your own hardware. The presets are
        the same client (<code>SystemOneClassifier</code>) with each
        project&apos;s documented defaults. Start the server as its README
        describes, then point Glove at it:
      </p>
      <CodeBlock
        filename="models.ts"
        language="typescript"
        code={`import { kev, laya, von, rizzo, decider, systemOne } from "glove-classifier";

const local = laya();                                  // http://127.0.0.1:8000
const gpu = kev({ baseURL: "http://gpu-box:8009" });   // any address
const other = systemOne({ baseURL: "https://decisions.internal", model: "my-model", apiKey });`}
      />
      <table>
        <thead>
          <tr>
            <th>Preset</th>
            <th>Model</th>
            <th>Default address</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>jev()</code></td><td>TypeSafe Jev (hosted)</td><td>api.typesafe.ai</td><td>Calibrated. Needs <code>TYPESAFE_API_KEY</code>.</td></tr>
          <tr><td><code>kev()</code></td><td><a href="https://github.com/jaredpalmer/kev">Kev</a>: Qwen3.5 + LoRA, 0.8B–27B</td><td>127.0.0.1:8009</td><td><code>KEV_API_KEY</code> if the server sets one.</td></tr>
          <tr><td><code>laya()</code></td><td><a href="https://github.com/NandhaKishorM/laya">Laya</a>: ModernBERT / mmBERT, ~400M</td><td>127.0.0.1:8000</td><td>Runs on CPU. Score levels need descriptions.</td></tr>
          <tr><td><code>von()</code></td><td><a href="https://github.com/wfzyx/von">Von</a>: ModernBERT-large, 395M</td><td>localhost:8000</td><td></td></tr>
          <tr><td><code>rizzo()</code></td><td><a href="https://github.com/Rizzo-AI-Academy/rizzo-flow">Rizzo Flow</a>: Spark-X2.5, 1.7B/4B</td><td>127.0.0.1:8017</td><td>At most 26 choice labels. Uncalibrated by default.</td></tr>
          <tr><td><code>decider()</code></td><td><a href="https://github.com/Mapika/decider">Decider</a>: Qwen-based, 0.8B–35B</td><td>127.0.0.1:8000</td><td>English only, 32k context.</td></tr>
        </tbody>
      </table>
      <p>
        Each preset reads <code>&lt;NAME&gt;_BASE_URL</code> and{" "}
        <code>&lt;NAME&gt;_API_KEY</code>. The client absorbs the ways these
        servers differ. It computes missing confidence from the probabilities,
        fills in a missing legend, usage or model, ignores extra fields, and
        checks each server&apos;s option limits locally. Pin the address and model
        in production, because the defaults follow each project&apos;s README as
        of September 2026.
      </p>
      <p>
        <strong>Zero-shot label scorers.</strong> <code>huggingfaceZeroShot()</code>{" "}
        (NLI models over the Hugging Face Inference API), <code>gliclass()</code>{" "}
        and <code>labelScorer()</code> for your own model all map the three
        question types onto &ldquo;score these labels&rdquo;. They don&apos;t read
        instructions, so put the meaning in the labels.
      </p>
      <p>
        On the labelled inbox (80 messages × 3 questions), hosted Jev scored
        100% / 97.5% / 100% at 18&nbsp;ms per message. Laya, self-hosted on 4 CPU
        cores with no GPU, scored 75% / 88.8% / 81.3% at 2.85&nbsp;s per message.
        Its English checkpoint reads only 512 tokens of these long emails. A
        common setup is a self-hosted model as the <code>primary</code> of a{" "}
        <code>cascade()</code> with Jev or an LLM as the fallback.
      </p>

      <h2 id="confidence">Acting on confidence</h2>
      <CodeBlock
        filename="route.ts"
        language="typescript"
        code={`import { gate } from "glove-classifier";

switch (gate(answers.department, { act: 0.8, review: 0.5 })) {
  case "act":      return route(answers.department.choice);
  case "review":   return confirmWithUser(answers.department.choice);
  case "escalate": return handToHuman();
}`}
      />
      <p>
        <code>answerConfidence()</code> works for every answer type. A{" "}
        <code>noul</code> has no <code>confidence</code> field, so its certainty is
        its distance from a coin flip, <code>|2p − 1|</code>. Set thresholds per
        action to match the stakes.
      </p>

      <h2 id="llm">Any LLM as a classifier</h2>
      <CodeBlock
        filename="llm.ts"
        language="typescript"
        code={`import { createAdapter } from "glove-core/models/providers";
import { llmClassifier } from "glove-classifier";

const model = llmClassifier({
  model: createAdapter({ provider: "openai", model: "gpt-4.1-mini", stream: false }),
});`}
      />
      <p>
        The LLM is asked for a probability distribution per question, returned as
        JSON, and the reply becomes the same typed answers. Replies that can&apos;t
        be parsed are retried. The probabilities are self-reported rather than
        calibrated, so treat them as a hint.
      </p>

      <h2 id="cascade">Cascade</h2>
      <CodeBlock
        filename="cascade.ts"
        language="typescript"
        code={`import { cascade, jev, llmClassifier } from "glove-classifier";

const model = cascade({
  primary: jev(),
  fallback: llmClassifier({ model: reasoningModel }),
  threshold: 0.6, // or shouldEscalate(answer, id, question)
});

const result = await model.classify({ state, questions });
result.escalated; // ids the fallback answered`}
      />

      <h2 id="mount">In an agent: mountClassifier</h2>
      <p>
        <code>mountClassifier</code> gives an agent classifier models it can use
        whenever a judgement is cheaper than reading. The host registers{" "}
        <strong>presets</strong> (named question sets) and <strong>sources</strong>{" "}
        (data streams such as an inbox or a ticket queue), and can add or remove
        them at any time.
      </p>
      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`import { mountClassifier, jev, llmClassifier, noul, choice } from "glove-classifier";

const classifiers = mountClassifier(glove, {
  classifier: jev(),
  classifiers: { careful: llmClassifier({ model: reasoningModel }) },
  presets: {
    triage: {
      description: "Support triage",
      questions: {
        team: choice("Which team should handle this?", ["billing", "technical", "sales"]),
        urgent: noul("Does the sender need help today?"),
      },
    },
  },
  sources: {
    inbox: {
      description: "Unread support email",
      load: async () => (await mail.unread()).map((m) => ({ id: m.id, label: m.subject, state: m.body })),
    },
  },
});

classifiers.addSource("crm", { description: "Open CRM notes", load: loadNotes }); // any time`}
      />
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>glove_classify</code></td>
            <td>Judges one state, with its own questions and/or a preset.</td>
          </tr>
          <tr>
            <td><code>glove_classify_batch</code></td>
            <td>Judges many items the agent already holds. <code>where</code> keeps only the matches.</td>
          </tr>
          <tr>
            <td><code>glove_classify_source</code></td>
            <td>Judges every item in a host source and returns only ids, labels and answers. The content never enters the agent&apos;s context.</td>
          </tr>
          <tr>
            <td><code>glove_classify_catalog</code></td>
            <td>Lists presets, sources and named classifiers.</td>
          </tr>
        </tbody>
      </table>
      <p>
        A <code>where</code> condition is{" "}
        <code>&#123; question, choice?, min?, max? &#125;</code>, and a list of
        conditions must all hold. A noul matches when its yes-probability is at
        least <code>min</code> (default 0.5). A choice matches when{" "}
        <code>choice</code> is the chosen label, or, with <code>min</code>, when
        that label&apos;s probability is at least <code>min</code>. A score
        matches when it falls within <code>min</code> and <code>max</code>. For a
        single fixed judgement, use <code>defineClassifierTool()</code> instead,
        which asks your questions over the agent&apos;s input.
      </p>

      <h2 id="code">In code: REPLs and working environments</h2>
      <p>
        An agent that writes code can move data around without reading it,
        because only the program&apos;s return value enters its context. A
        classifier supplies the judgement that step needs, such as &ldquo;which of
        these 400 emails ask for a refund?&rdquo;, and the program returns three
        ids instead of 400 messages.
      </p>
      <CodeBlock
        filename="repl.ts"
        language="typescript"
        code={`import { JsSession, mountJs } from "glove-js";
import { classifierFns, jev } from "glove-classifier";

const session = JsSession.create();
session.registerAll(classifierFns(jev())); // classifier.classify / many / is / pick / rate
mountJs(glove, { session });

// what the agent writes:
const hits = classifier.many({
  items: emails.map(e => ({ id: e.id, label: e.subject, state: e.body })),
  questions: { refund: { type: "noul", instructions: "Does the sender ask for a refund?" } },
  where: { question: "refund", min: 0.7 },
});
hits.map(h => h.id)`}
      />
      <p>
        REPL programs call host functions one at a time, so <code>many</code>{" "}
        runs a whole batch in parallel inside a single call. Programs get plain
        values: <code>answers.refund</code> is the yes-probability,{" "}
        <code>answers.team</code> is the label, and <code>answers.urgency</code>{" "}
        is the level. The full typed answers are under <code>details</code>, and
        a question can be a plain string. The same functions
        work in <code>glove-python</code> and <code>glove-lisp</code>, and in a
        working environment as <code>env:classifier</code>. That module ships a
        README and a <code>classifier-triage</code> skill:
      </p>
      <CodeBlock
        filename="env.ts"
        language="typescript"
        code={`import { classifierEnv } from "glove-classifier/env";

createWorkingEnvironment({ stdlib: [email(), classifierEnv(jev())] });

// a script:
import { glob, readFile } from 'env:fs';
import { many } from 'env:classifier';

export default async function () {
  const items = [];
  for (const path of await glob('/inbox/*.eml')) items.push({ id: path, state: (await readFile(path)).slice(0, 20000) });
  const hits = await many({ items, questions: { refund: { type: 'noul', instructions: 'Does the sender ask for a refund?' } }, where: { question: 'refund' } });
  return hits.map(h => h.id);
}`}
      />

      <h2 id="browser">Browsers</h2>
      <p>
        <code>withClassifier</code> adds a <code>judge</code> operation to a{" "}
        <a href="/docs/execution">glove-execution</a> browser adapter. It observes
        the page, classifies what it sees, and returns only the answers. Questions
        like &ldquo;is this a login wall?&rdquo; or &ldquo;did the order go
        through?&rdquo; get answered without the DOM entering the agent&apos;s
        context.
      </p>
      <CodeBlock
        filename="browser.ts"
        language="typescript"
        code={`import { withClassifier } from "glove-classifier";

mountBrowser(glove, { adapter: withClassifier(stationBrowser({ client }), { classifier: jev() }) });

// in a browser workflow:
const { answers } = await browser.judge({
  sessionId,
  questions: { done: { type: "noul", instructions: "Did the order go through?" } },
});`}
      />

      <h2 id="foundry">Foundry transmissions</h2>
      <p>
        Every inbound event passes through its transmission&apos;s{" "}
        <code>classify</code> step and each playbook&apos;s predicates before any
        agent runs. With a classifier there, agents start only for the events
        that need them.
      </p>
      <CodeBlock
        filename="predicates/urgent.predicate.ts"
        language="typescript"
        code={`import { defineTransmissionPredicate } from "glove-foundry";
import { classifierPredicate, classifyInbound } from "glove-classifier/foundry";

export default defineTransmissionPredicate(classifierPredicate({
  classifier: jev(),
  questions: { urgent: noul("Does the sender need help today?") },
  where: { question: "urgent", min: 0.7 },   // playbook parameters may override: { min: 0.9 }
  state: (event: Ticket) => ({ subject: event.subject, body: event.body }),
}));

// in the transmission's inbound contract:
classify: classifyInbound({
  classifier: jev(),
  question: choice("What is this message?", ["refund", "bug", "other"]),
  events: { refund: refundRequested, bug: bugReported },
  fallback: generalInquiry,
  minConfidence: 0.6,
  state: (event: Ticket) => event.body,
}),`}
      />

      <h2 id="measured">Measured</h2>
      <p>
        On a labelled 80-message inbox (
        <a href="https://github.com/porkytheblack/glove/tree/main/examples/classifier-inbox">examples/classifier-inbox</a>),
        a <code>gpt-4.1-mini</code> agent that classified the inbox as a source
        held 3,705 tokens in context, against 24,455 when it read the inbox.
        Its refund F1 rose from 0.93 to 1.00, and the planted customer data
        reached it in 0 of 3 runs instead of 3 of 3. Jev judged 80 messages × 3
        questions in 1.35&nbsp;s for $0.0024, against 16.3&nbsp;s and $0.028 for
        an LLM.
      </p>

      <h2 id="privacy">Context, speed and privacy</h2>
      <p>
        A classifier answer is small by construction: a probability, a label, or
        a level. When code or a tool asks the question, the content stays where
        it is and only the answer reaches the agent. This is the same boundary{" "}
        <a href="/docs/egress">glove-egress</a> enforces with assertions:
        decisions leave the sandbox, records do not. See{" "}
        <a href="/blog/classifier-models">Classifier models in Glove</a> for the
        reasoning behind the design.
      </p>

      <h2 id="custom">Bring your own classifier</h2>
      <p>
        Implement <code>ClassifierAdapter</code>, which has a <code>name</code> and a{" "}
        <code>classify(&#123; state, questions &#125;, &#123; signal &#125;)</code>{" "}
        method. It returns one answer per question id, with the same{" "}
        <code>type</code> as the question.{" "}
        <code>answerFromDistribution(question, distribution)</code> builds a
        well-formed answer from any probability distribution, and cascades, tools
        and gating then work unchanged.
      </p>
    </div>
  );
}
