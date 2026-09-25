import { BlogPostHeader } from "@/components/blog-post-header";
import { CodeBlock } from "@/components/code-block";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("classifier-models")!;

export const metadata = postMetadata(post);

export default function Post() {
  return (
    <article className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        Most of what an agent reads, it reads to answer a small question. Is
        this email a refund request? Which team owns this ticket? Did the
        checkout page load? <code>glove-classifier</code> lets those questions
        go to a model built to answer them, and only the answer comes back.
      </p>

      <p>
        A language model is a general tool, and agents built on one tend to push
        every judgement through the main loop. To learn which of four hundred
        emails ask for a refund, the planner reads four hundred emails. To learn
        whether a page shows a login wall, it reads the DOM. The conversation
        fills with material the agent needed for one bit of information and will
        never look at again.
      </p>
      <p>
        Glove has spent several releases moving work out of the context window.
        The scratchpad and the REPLs let a program touch data the model never
        sees, and the working environment gives that program a filesystem.{" "}
        <code>glove-egress</code> makes the boundary enforceable. The missing
        piece was the judgement itself. When the program meets an email, what
        decides whether the email matters?
      </p>

      <h2 id="system-one">A different kind of model</h2>
      <p>
        TypeSafe recently released <a href="https://docs.typesafe.ai/introduction">Jev</a>,
        the first of what it calls System One models. Jev does not generate text.
        You send a <em>state</em> and a set of typed <em>questions</em>, and it
        returns typed answers. There are three kinds of question: a{" "}
        <code>noul</code> returns the probability that a statement is true, a{" "}
        <code>choice</code> picks a label, and a <code>score</code> places the
        state on a rubric. Each answer carries its full probability distribution
        and a confidence value, and all the questions are evaluated in parallel
        in one pass.
      </p>
      <CodeBlock
        language="typescript"
        filename="triage.ts"
        code={`import { jev, noul, choice, score } from "glove-classifier";

const { answers, model } = await jev().classify({
  state: "Help! My payouts have been failing for 3 days and I'm losing sales.",
  questions: {
    urgent: noul("Does this convey urgency?"),
    team: choice("Which team should handle this?", {
      billing: "Payments, invoices, refunds",
      technical: "Bugs, outages, integrations",
      sales: "Pricing, upgrades",
    }),
    frustration: score("How frustrated is the customer?", ["Calm", "Frustrated", "Very angry"]),
  },
});

answers.urgent.noul;        // 0.97
answers.team.choice;        // "billing" (typed: "billing" | "technical" | "sales")
answers.team.probabilities; // { billing: 0.91, technical: 0.09, sales: 0 }
answers.team.confidence;    // 0.86
answers.frustration.score;  // 1.18, between "Frustrated" and "Very angry"
model;                      // "jev-1.13.0", answered in 227 ms`}
      />
      <p>
        Those values are from a live call. Jev cannot sit behind Glove&apos;s{" "}
        <code>ModelAdapter</code>, because it does not chat, stream or call tools,
        so <code>glove-classifier</code> gives classifier models their own small
        contract, <code>ClassifierAdapter</code>. Jev implements it over plain{" "}
        <code>fetch</code>. <code>llmClassifier()</code> implements it over any
        existing <code>ModelAdapter</code>, so the same questions run on the model
        you already use. <code>cascade()</code> composes the two.
      </p>

      <h2 id="context">Less context: judge the data where it lives</h2>
      <p>
        Where the question is asked decides what the agent has to read. We
        measured it on a labelled support inbox of 80 messages, about 24k tokens
        with the signatures, quoted threads and footers real mail carries. Every
        agent got the same request: &ldquo;which messages ask for a refund, and
        how many are urgent?&rdquo; One refund request contains a planted
        customer account number.
      </p>
      <figure>
        <img
          src="/blog/classifier-models/context.svg"
          width={1200}
          height={560}
          alt="Reading the inbox puts 24,455 tokens, including a customer's account number, into the agent's context. Classifying it where it lives puts 3,705 tokens of ids and answers there, with better accuracy."
        />
        <figcaption>
          The same agent (gpt-4.1-mini), the same request, three runs each. Reading
          the inbox cost more context and more mistakes. Classifying it cost 85%
          less context, and the agent never saw the customer&apos;s data.
        </figcaption>
      </figure>
      <p>
        The agent on the right never read a message. The host registered the
        inbox as a classifier <strong>source</strong>. The agent asked both of
        its questions in one call and got back ids, subject lines and answers:
      </p>
      <CodeBlock
        language="typescript"
        filename="agent.ts"
        code={`import { mountClassifier, jev, noul, choice } from "glove-classifier";

mountClassifier(agent, {
  classifier: jev(),
  sources: {
    inbox: {
      description: "The support inbox",
      load: async () => (await mail.unread()).map((m) => ({ id: m.id, label: m.subject, state: m })),
    },
  },
});

// What the agent called, verbatim from a benchmark run:
// glove_classify_source({
//   source: "inbox",
//   questions: { refund: "Does the sender ask for a refund or their money back?",
//                urgent: "Is the message urgent?" },
//   where: { question: "refund" }
// })`}
      />

      <h2 id="patterns">Five places to put the question</h2>
      <p>
        A source is one pattern. The same idea applies everywhere data flows into
        an agent: keep the data where it is, ask the classifier there, and pass
        on only the answer.
      </p>
      <figure>
        <img
          src="/blog/classifier-models/patterns.svg"
          width={1200}
          height={660}
          alt="Five usage patterns: agent tools with sources, REPL programs, working-environment scripts, browser judgements and Foundry inbound triage. Each keeps the data in place and passes only answers to the agent."
        />
      </figure>

      <h3 id="pattern-repl">In a REPL program</h3>
      <p>
        An agent writing code can move records it never reads.{" "}
        <code>classifierFns()</code> adds <code>classifier.many()</code> to the
        JavaScript, Python and Lisp REPLs. REPL programs call host functions one
        at a time, so <code>many</code> judges a whole batch in parallel inside a
        single call and returns plain values that a program can compare
        directly:
      </p>
      <CodeBlock
        language="javascript"
        filename="what the agent writes"
        code={`const judged = classifier.many({
  items: inbox.list().map(m => ({ id: m.id, label: m.subject, state: m })),
  questions: {
    refund: "Does the sender ask for a refund, a chargeback reversal, or their money back?",
    urgent: "Does the sender need this handled today?",
  },
  where: { question: "refund" },
});
({
  refunds: judged.map(j => j.id),
  urgent: judged.filter(j => j.answers.urgent > 0.5).map(j => j.id + " — " + j.label),
})
// 80 judgements in 1.46 s · returned 592 characters instead of 96,980`}
      />

      <h3 id="pattern-env">In a working environment</h3>
      <CodeBlock
        language="javascript"
        filename="/scripts/refunds.js"
        code={`import { glob, readFile } from 'env:fs';
import { describe } from 'env:email';
import { many } from 'env:classifier';   // classifierEnv(jev()) in the host's stdlib

export default async function () {
  const items = [];
  for (const path of await glob('/inbox/*.eml')) {
    const meta = await describe(path);
    items.push({ id: path, label: meta.subject, state: (await readFile(path)).slice(0, 20000) });
  }
  const hits = await many({ items, questions: { refund: 'Does the sender ask for a refund?' }, where: { question: 'refund', min: 0.7 } });
  return hits.map(h => ({ path: h.id, subject: h.label, p: h.answers.refund }));
}`}
      />

      <h3 id="pattern-browser">In a browser</h3>
      <CodeBlock
        language="javascript"
        filename="execute_browser program"
        code={`// host: mountBrowser(glove, { adapter: withClassifier(stationBrowser({ client }), { classifier: jev() }) })
browser.navigate({ sessionId, url: "https://shop.example/orders/latest" });
const { answers } = browser.judge({
  sessionId,
  questions: {
    placed: "Did the order go through?",
    wall: "Is the page asking the user to sign in?",
  },
});
answers   // the page itself never enters the agent's context`}
      />

      <h3 id="pattern-foundry">Before an agent starts, in Foundry</h3>
      <p>
        Inbound transmissions pass through a <code>classify</code> step and each
        playbook&apos;s predicates before any agent runs. A classifier there
        decides which event a message is and which playbooks wake for it, so an
        agent starts only for the messages that need one:
      </p>
      <CodeBlock
        language="typescript"
        filename="predicates/urgent.predicate.ts"
        code={`import { defineTransmissionPredicate } from "glove-foundry";
import { classifierPredicate } from "glove-classifier/foundry";

export default defineTransmissionPredicate(classifierPredicate({
  classifier: jev(),
  questions: { urgent: noul("Does the sender need help today?") },
  where: { question: "urgent", min: 0.7 },       // a playbook can pass { min: 0.9 }
  state: (event: Ticket) => ({ subject: event.subject, body: event.body }),
}));`}
      />

      <h2 id="speed">Speed: one parallel pass, not a turn per item</h2>
      <p>
        A language model answers one token at a time, so judging each item means
        a model turn per item. A System One model evaluates every question in one
        parallel pass. Here are the same 80 messages and the same three questions
        on each classifier, with Glove running eight requests at a time:
      </p>
      <table>
        <thead>
          <tr>
            <th>Classifier</th>
            <th>Refund</th>
            <th>Urgent</th>
            <th>Kind</th>
            <th>Wall time</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Jev (<code>jev-1.13.0</code>)</td>
            <td>100%</td>
            <td>97.5%</td>
            <td>100%</td>
            <td>1.35 s</td>
            <td>$0.0024</td>
          </tr>
          <tr>
            <td>LLM (<code>gpt-4.1-mini</code>)</td>
            <td>95%</td>
            <td>96.3%</td>
            <td>95%</td>
            <td>16.3 s</td>
            <td>$0.0277</td>
          </tr>
          <tr>
            <td>Cascade (Jev, then LLM below 0.6)</td>
            <td>95%</td>
            <td>100%</td>
            <td>100%</td>
            <td>3.3 s</td>
            <td>$0.0054</td>
          </tr>
        </tbody>
      </table>
      <p>
        That is roughly 12× faster and 11× cheaper than the LLM on this set, and
        at least as accurate. The inbox is templated, so it measures the
        mechanism rather than serving as a leaderboard. TypeSafe&apos;s own
        figures are 70–500&nbsp;ms per call, with only input tokens priced.
      </p>

      <h2 id="privacy">Privacy by depending on assertions</h2>
      <p>
        Glove&apos;s egress work began with an uncomfortable measurement. We gave
        cheap models a task over records that contained planted secrets. With a
        raw tool surface, secrets leaked in 75% of runs. Telling the model to
        return only decisions reduced that to 33%, and no further. Only an
        enforced boundary reached 0%: the program may return an assertion, a
        count, or a choice from a short list, and never a raw record. Our
        conclusion was that{" "}
        <em>a privacy boundary that depends on the model&apos;s goodwill is not a boundary</em>.
      </p>
      <p>
        An assertion-only boundary needs something to produce the assertions.
        For judgements (&ldquo;is this feedback negative?&rdquo;), the same study
        delegated each document to a small classifier inside the sandbox.
        Judging accuracy went from 25% to 75%, and leakage from 25% to 0%,
        because the documents reached the judge but never the planner.
        The inbox benchmark repeats that result. The agents that read the inbox
        saw the planted account number in 6 of 6 runs. The agents that
        classified it saw it in 0 of 12.
      </p>
      <p>
        Classifier answers are bounded by construction. A noul is a probability,
        a choice is one label out of <em>k</em>, and a score is a level on a
        rubric you wrote. That is exactly the shape <code>glove-egress</code>{" "}
        budgets for: a yes/no crossing carries at most one bit, and a{" "}
        <em>k</em>-way choice at most log<sub>2</sub> <em>k</em>. The boundary
        lies between the data and the agent&apos;s context. The classifier itself
        does see the content, so choose it with that in mind. TypeSafe states
        that Jev is not trained on customer requests. For data that must stay in
        your infrastructure, <code>llmClassifier()</code> runs the same questions
        on a model you host.
      </p>

      <h2 id="confidence">Knowing when not to act</h2>
      <figure>
        <img
          src="/blog/classifier-models/routing.svg"
          width={1200}
          height={440}
          alt="A fast classifier answers. Confident answers are acted on, medium ones go to review, low ones escalate to a person or to a stronger model through a cascade."
        />
      </figure>
      <CodeBlock
        language="typescript"
        filename="routing.ts"
        code={`import { cascade, gate, jev, llmClassifier } from "glove-classifier";

const classifier = cascade({
  primary: jev(),
  fallback: llmClassifier({ model: reasoningModel }),
  threshold: 0.6,                          // re-ask only the uncertain answers
});

const { answers, escalated } = await classifier.classify({ state: ticket, questions });
switch (gate(answers.team, { act: 0.8, review: 0.5 })) {
  case "act":      return route(answers.team.choice);
  case "review":   return confirmWithUser(answers.team.choice);
  case "escalate": return handToHuman(ticket);
}`}
      />
      <p>
        Keep questions atomic, one quick expert judgement each, and combine them
        in code. Weighting then lives in a coefficient you can change instead of
        a prompt you have to rewrite.
      </p>

      <h2 id="results">What the benchmark taught the library</h2>
      <figure>
        <img
          src="/blog/classifier-models/results.svg"
          width={1200}
          height={502}
          alt="Mean tokens in the agent's context: reading the inbox 24,455 for both models; classifier source about 3,700; REPL with classifier.many about 5,100. Refund F1, data exposure and cost are listed beside each bar."
        />
        <figcaption>
          Both models, three runs per approach. The full answers and tool calls
          are in <code>examples/classifier-inbox/results</code>. Total spend for
          everything in this post was under a dollar.
        </figcaption>
      </figure>
      <p>
        The first version of these tools did not get these numbers. The runs
        showed us where the design was wrong:
      </p>
      <ul>
        <li>
          <strong>A strict schema is a wall.</strong> The first source runs spent
          their whole turn budget on validation errors. The model wrote questions
          as bare strings, left out <code>instructions</code>, and wrote{" "}
          <code>type: &quot;yes_no&quot;</code>. Each has one obvious meaning, so
          the tools now accept them.
        </li>
        <li>
          <strong>Programs want plain values.</strong> REPL agents wrote{" "}
          <code>answers.refund &gt; 0.5</code> and{" "}
          <code>answers.team === &quot;billing&quot;</code> against nested
          objects, or skipped the classifier and matched on keywords instead.
          Keyword matching caught phishing (&ldquo;claim your refund!&rdquo;) and
          a thank-you note, and missed &ldquo;money back&rdquo;.{" "}
          <code>classifier.many</code> now returns scalars, and REPL F1 rose from
          0.65 to 0.97.
        </li>
        <li>
          <strong>Truncation needs to be said, not flagged.</strong> An agent
          ignored a <code>truncated: true</code> flag and reported 18 of 24
          refunds. Truncated results now carry a note that tells the agent how to
          narrow or widen them.
        </li>
      </ul>

      <h2 id="start">Try it</h2>
      <CodeBlock
        language="bash"
        code={`pnpm add glove-classifier
# the benchmark and demos:
pnpm --filter glove-classifier-inbox-example repl
pnpm --filter glove-classifier-inbox-example agent "Which messages ask for a refund?"`}
      />
      <p>
        The <a href="/docs/classifier">classifier guide</a> covers every
        integration. The <a href="/docs/egress">egress</a> and{" "}
        <a href="/docs/code-execution">code execution</a> guides explain the
        boundary this work builds on.
      </p>
      <p>
        Also in this release: <code>glove-core</code> now includes the{" "}
        <a href="/docs/core">Vercel AI Gateway</a> as a provider. Use{" "}
        <code>createAdapter(&#123; provider: &quot;vercel&quot; &#125;)</code>{" "}
        with <code>AI_GATEWAY_API_KEY</code>. Inside a Vercel deployment it falls
        back to the OIDC token Vercel provides automatically.
      </p>
    </article>
  );
}
