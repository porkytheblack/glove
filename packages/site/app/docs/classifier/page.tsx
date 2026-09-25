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

      <h2 id="tools">In an agent</h2>
      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`import { classifierTool, defineClassifierTool, jev, choice, noul } from "glove-classifier";

const model = jev();

// Open: the agent writes the state and questions (glove_classify).
glove.fold(classifierTool({ classifier: model }));

// Fixed: you write the questions; the agent passes { text }.
glove.fold(defineClassifierTool({
  name: "triage_ticket",
  description: "Route a support ticket to a team.",
  classifier: model,
  questions: {
    team: choice("Which team should handle this?", ["billing", "technical", "sales"]),
    urgent: noul("Does this convey urgency?"),
  },
  format: (a) => ({ team: a.team.choice, urgent: a.urgent.noul > 0.5 }),
}));`}
      />
      <p>
        Tool results carry compact answers, rounded and without the score legend.
        The full result is kept in <code>renderData</code>, and classifier
        failures come back as tool errors.
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
