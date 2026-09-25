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
        code={`import { jev, noul, choice, gate } from "glove-classifier";

const { answers } = await jev().classify({
  state: ticket,
  questions: {
    team: choice("Which team should handle this?", ["billing", "technical", "sales"]),
    urgent: noul("Does the sender need help today?"),
  },
});

answers.team.choice;           // "billing" | "technical" | "sales", typed from the labels
if (gate(answers.team) === "act") route(answers.team.choice);`}
      />
      <p>
        Jev cannot sit behind Glove&apos;s <code>ModelAdapter</code>, because it
        does not chat, stream or call tools. So <code>glove-classifier</code>{" "}
        gives classifier models their own small contract,{" "}
        <code>ClassifierAdapter</code>. Jev implements it over plain{" "}
        <code>fetch</code>. <code>llmClassifier()</code> implements it over any
        existing <code>ModelAdapter</code>, so the same questions work with the
        model you already run. <code>cascade()</code> asks the fast classifier
        first and passes only its low-confidence answers to a stronger one.
      </p>

      <h2 id="context">Less context: judge the data where it lives</h2>
      <p>
        Where the question is asked decides what the agent has to read. Glove now
        puts classifiers in each place data flows through:
      </p>
      <ul>
        <li>
          <strong>Tools.</strong> <code>mountClassifier()</code> gives an agent{" "}
          <code>glove_classify</code> and a batch variant. It also adds{" "}
          <code>glove_classify_source</code>, which judges a host-registered source
          (an inbox, a ticket queue, a crawl) and returns ids, labels and answers.
          The content itself never comes back.
        </li>
        <li>
          <strong>REPLs.</strong> <code>classifierFns()</code> adds{" "}
          <code>classifier.many()</code> to the JavaScript, Python and Lisp
          surfaces. A program pulls the records, judges them all in parallel in
          one call, and returns the few that matter.
        </li>
        <li>
          <strong>Working environments.</strong> <code>env:classifier</code> gives
          a script the same functions next to <code>env:fs</code> and{" "}
          <code>env:email</code>.
        </li>
        <li>
          <strong>Browsers.</strong> <code>withClassifier()</code> adds{" "}
          <code>browser.judge()</code>, which observes a page and answers
          questions about it without returning the page.
        </li>
        <li>
          <strong>Foundry.</strong> <code>classifyInbound()</code> and{" "}
          <code>classifierPredicate()</code> triage inbound transmissions before
          any agent starts, so an agent runs only for events that need one.
        </li>
      </ul>
      <CodeBlock
        language="javascript"
        filename="what the agent writes"
        code={`const hits = classifier.many({
  items: emails.map(e => ({ id: e.id, label: e.subject, state: e.body })),
  questions: { refund: { type: "noul", instructions: "Does the sender ask for a refund?" } },
  where: { question: "refund", min: 0.7 },
});
hits.map(h => ({ id: h.id, subject: h.label }))`}
      />
      <p>
        Some rough arithmetic: four hundred emails at about six hundred tokens
        each is around a quarter of a million tokens of context. The program
        above returns a handful of ids and subject lines. That is illustrative
        arithmetic, not a benchmark, but the direction is not in doubt. The
        agent reads the three emails that matter, and the other 397 never
        enter its context.
      </p>

      <h2 id="speed">Speed: one parallel pass, not a turn per item</h2>
      <p>
        A language model answers one token at a time. Asking it to judge each
        item means a model turn per item, or one enormous turn over all of them
        in which the model has to keep track of which item it is on. A System One
        model evaluates every question in one parallel pass. TypeSafe reports
        response times of roughly 70–500&nbsp;ms and prices only input tokens.
        Those are their figures, and the gap depends on the workload.
      </p>
      <p>
        Glove adds its own share of parallelism. REPL programs call host
        functions one at a time, so <code>many()</code> spreads a whole batch
        across concurrent requests inside a single call. The tools and the
        Foundry helpers do the same. A triage pass that would otherwise be a long
        agent loop becomes one step.
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
        For computable facts, code does. For judgements (&ldquo;is this feedback
        negative?&rdquo;), the same study delegated each document to a small
        classifier inside the sandbox. Judging accuracy went from 25% to 75%, and
        leakage went from 25% to 0%, because the documents, and the planted
        secret in one of them, reached the judge but never the planner. The study
        was small and cheap by design (a few models, $0.12 in total), so read it
        as evidence for the approach rather than as a leaderboard.
      </p>
      <p>
        Classifier models make this the natural way to work. Their answers are
        bounded by construction. A noul is a probability, a choice is one label
        out of <em>k</em>, and a score is a level on a rubric you wrote. That is
        exactly the shape <code>glove-egress</code> budgets for: a yes/no
        crossing carries at most one bit, and a <em>k</em>-way choice at most log
        <sub>2</sub> <em>k</em>. A planner working with classifier answers
        depends on assertions rather than on reading.
      </p>
      <p>
        One qualification: the classifier itself does see the content. The
        boundary lies between the data and the agent&apos;s context, and it does
        not stop the data from reaching a model at all. Choose the classifier
        with that in mind. TypeSafe states that Jev is not trained on customer
        requests. For data that must not leave your infrastructure,{" "}
        <code>llmClassifier()</code> runs the same questions on a model you host.
      </p>

      <h2 id="confidence">Knowing when not to act</h2>
      <p>
        A confident wrong answer is worse than none. Every choice and score comes
        with a confidence value, and a noul&apos;s distance from 0.5 serves the
        same purpose. <code>gate()</code> turns confidence into act, review or
        escalate, with thresholds you set per action, since approving a transfer
        needs more certainty than tagging a ticket. <code>cascade()</code> uses
        the same signal to send only the uncertain questions to a slower model.
        Keep questions atomic, one quick expert judgement each, and combine them
        in code. Weighting then lives in a coefficient you can change instead of
        a prompt you have to rewrite.
      </p>

      <h2 id="start">Try it</h2>
      <CodeBlock language="bash" code={`pnpm add glove-classifier`} />
      <p>
        The <a href="/docs/classifier">classifier guide</a> covers every
        integration. If you haven&apos;t seen the boundary work, read the{" "}
        <a href="/docs/egress">egress guide</a> and the{" "}
        <a href="/docs/code-execution">code execution guide</a> first. The
        classifier is what those surfaces were missing: a way to decide what
        matters without reading it.
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
