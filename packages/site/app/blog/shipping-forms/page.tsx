import { CodeBlock } from "@/components/code-block";
import { BlogPostHeader } from "@/components/blog-post-header";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("shipping-forms")!;

export const metadata = postMetadata(post);

export default async function Post() {
  return (
    <div className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        Forms is a collection primitive for conversations — the fifth memory
        subsystem in <code>glove-memory</code>. This is the record of what we
        decided and why, and of the five defects a fifty-cent eval found that
        reading the code had not.
      </p>

      <p>
        Every agent that collects something structured — an intake, an
        onboarding, a claim, a booking — ends up rebuilding the same four things
        badly. It keeps partial answers in the transcript, where they are one
        summarisation away from gone. It asks in a fixed order, so a user who
        volunteers question six while being asked question two gets asked
        question six again later. It cannot tell &ldquo;not answered&rdquo; from
        &ldquo;does not apply&rdquo;. And when the user corrects themselves, the
        old answer is overwritten and the correction is unappealable.
      </p>

      <p>
        Forms exists to make those four failures structurally impossible rather
        than discouraged by a prompt. What follows is the honest version of how
        it got there — including the parts we got wrong on the first pass.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="shapes">Three shapes, three owners</h2>

      <p>
        Almost every question about this subsystem answers itself once you know
        which representation you are holding. A <code>FormDef</code> is code in
        your repo — zod schemas, predicates, executors — and it is never
        serialised. <code>compileForm</code> turns it into a cached index. A{" "}
        <code>FormInstance</code> is the only thing storage ever sees. A{" "}
        <code>FormView</code> is rebuilt on every tool call and is the only
        thing the model reads.
      </p>

      <p>
        The model never sees a definition. That single boundary is what lets the
        definition carry arbitrary TypeScript while the agent-facing surface
        stays a flat list of rows with a status each.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="decisions">The decisions</h2>

      <h3>Definitions are code, not JSON</h3>

      <p>
        The tempting design is a JSON schema for forms, stored in a table,
        editable at runtime. We did not do that, and the reason is that the
        interesting parts of a form are not data. An applicability rule is a
        predicate. A validation is a zod schema. A side effect is an async
        function with access to the rest of memory. Encoding those as data means
        inventing a language for them, and that language will be worse than the
        one you already have.
      </p>

      <p>
        Colocating them also buys type threading. Every <code>.field()</code>{" "}
        widens the accumulated values type, so a predicate written on the third
        field of the second step already knows about everything declared before
        it.
      </p>

      <CodeBlock
        filename="forms/pi-intake.ts"
        language="typescript"
        code={`.field("incidentType", {
  schema: z.enum(["vehicle", "premises", "medical"]),
  label: "Type of incident",
})
.field("vehicleCount", {
  schema: z.number().int().min(1).optional(),
  label: "Vehicles involved",
  // \`v.incidentType\` narrows to the enum union — not \`unknown\`, not \`any\`
  when: (v) => v.incidentType === "vehicle",
})`}
      />

      <p>
        Step ids are threaded the same way, so{" "}
        <code>state.stepComplete(&quot;identiy&quot;)</code> is a compile error
        rather than a predicate that quietly returns <code>false</code> forever.
      </p>

      <h3>Optionality is derived, never declared</h3>

      <p>
        There is no <code>required: true</code> flag and no field-type
        vocabulary. A field is optional exactly when its schema accepts{" "}
        <code>undefined</code> — <code>schema.safeParse(undefined).success</code>{" "}
        — and the type string the agent reads comes out of{" "}
        <code>z.toJSONSchema</code>. Two sources of truth about the same fact is
        a bug waiting for a deadline, and this one had an obvious single source.
      </p>

      <h3>Writes are never gated</h3>

      <p>
        This is the load-bearing one. <code>glove_form_fill</code> takes a patch
        of <em>any</em> field ids, not just the step the conversation is on.
        Each value is validated independently, so one bad answer never throws
        away the good ones sent alongside it. And an answer that does not
        currently apply is not dropped — it is <strong>held</strong>.
      </p>

      <p>
        Liveness is recomputed from scratch on every commit rather than decided
        at write time and remembered. That makes it a partition, not a mutation:
        an answer orphaned by a correction comes back the moment the correction
        is corrected, because nothing was ever removed.
      </p>

      <h3>Two different things spelled <code>when</code></h3>

      <table>
        <thead>
          <tr>
            <th></th>
            <th>Question it answers</th>
            <th>If false</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>field.when</code>
            </td>
            <td>Does this question make sense at all?</td>
            <td>Answer is held, not counted, still writable</td>
          </tr>
          <tr>
            <td>
              <code>step.when</code>
            </td>
            <td>Should we be asking about this yet?</td>
            <td>Step is not opened, fields do not ask, still writable</td>
          </tr>
        </tbody>
      </table>

      <p>
        Applicability is about meaning; ask-order is about conversation. Keeping
        them separate is what lets a form with fifty conditional fields finish in
        six questions without any of the fields becoming unwritable.
      </p>

      <h3>Commit, then run</h3>

      <p>
        Executors hang at four points — <code>field.onFill</code>,{" "}
        <code>step.onComplete</code>, <code>checkpoint.run</code>,{" "}
        <code>form.onComplete</code> — and all four fire on a{" "}
        <strong>rising edge</strong>: the first commit where the condition holds
        having not held before. The answer is durable <em>before</em> any
        executor sees it, which is what makes at-least-once dispatch survivable.
        A crash mid-executor replays the hook; it never loses the answer.
      </p>

      <p>
        Every edge bumps a per-hook counter whether or not an executor is
        attached, and that counter is the third segment of the idempotency key —{" "}
        <code>{"${instanceId}:${hookId}:${occurrence}"}</code>. A retry reuses
        the key; a genuine second crossing gets a fresh one.
      </p>

      <h3>Loading is tiered like an inbox</h3>

      <p>
        A form is only useful if the agent knows it exists, and only affordable
        if knowing that costs almost nothing. One line goes into the system
        prompt each turn; everything else is pulled on demand.
      </p>

      <CodeBlock
        filename="tier 0"
        language="text"
        code={`[form: pi-intake] step 2/4 "Incident" · pending: Type of incident, Date of incident
later: Injuries (what hurts, treatment) · Review (confirm and sign off)`}
      />

      <p>
        Two inclusions in there were argued for on cost and both survived.
        Pending <em>labels</em> rather than a count, because &ldquo;5 fields
        pending&rdquo; forces a tool call every turn just to learn what to ask —
        more expensive than the tokens it saves. And a one-line preview per
        remaining step, which is what makes opportunistic capture work: an agent
        who hears &ldquo;I already have a lawyer&rdquo; during step 2 can see
        representation is coming and grab it now.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="eval">Then we ran it against actual models</h2>

      <p>
        Everything above reads as correct. The surface compiled, the tests
        passed, the types were tight. So we built{" "}
        <code>examples/forms-bench</code> — seven scenarios, two repetitions,
        four cheap tool-capable models across four vendors, with real token
        attribution and real spend reported by the provider.
      </p>

      <p>
        The scenarios were chosen to be uncomfortable rather than
        representative: a user who front-loads every answer in one message, a
        user whose answer is orphaned by a later correction, a malformed id
        mixed into an otherwise-good patch, a user who takes something back, a
        value over a checkpoint&apos;s cap, and a &ldquo;what else do you
        need?&rdquo; turn that tests whether the agent can see past the open
        step.
      </p>

      <p>
        Total spend for the whole programme, across every round of fixes:
        roughly fifty cents. It found five defects that reading the code had
        not.
      </p>

      <table>
        <thead>
          <tr>
            <th>Symptom</th>
            <th>Cause</th>
            <th>Collection rate</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>279 unknown field ids</td>
            <td>
              62% differed from a real id only in case or punctuation; 17% of
              write calls had every field rejected
            </td>
            <td>69% → 85%</td>
          </tr>
          <tr>
            <td>
              Half of all boolean writes sent <code>&quot;yes&quot;</code>
            </td>
            <td>
              The type string read <code>yes / no</code> while the error said{" "}
              <em>expected boolean</em>
            </td>
            <td>85% → 90%</td>
          </tr>
          <tr>
            <td>Good answers destroyed</td>
            <td>
              Models wrote <code>&quot;&quot;</code> to retract, overwriting the
              single stored entry
            </td>
            <td>90% → 94%</td>
          </tr>
          <tr>
            <td>Completed forms unreachable</td>
            <td>
              Instance resolution excluded <code>complete</code>, so no
              post-completion correction was possible
            </td>
            <td>one model: 9/14 → 12/14</td>
          </tr>
          <tr>
            <td>Routing silently dropped</td>
            <td>
              A jump <em>back</em> to a finished step was ignored — the one
              thing a routing trigger could ask for and not get
            </td>
            <td>revisit shipped</td>
          </tr>
        </tbody>
      </table>

      <h3>The first one: ids the model cannot echo</h3>

      <p>
        Models do not reliably reproduce your field ids. They send{" "}
        <code>Full name</code> for <code>fullName</code>,{" "}
        <code>staff_id</code> for <code>staffId</code>. The engine rejected all
        of it, correctly and uselessly.
      </p>

      <p>
        The fix is a compile-time alias index over normalised ids{" "}
        <em>and</em> labels, so all the spellings land on the same field. Any
        definition whose fields would collide once case and punctuation are
        stripped is now rejected at compile time, so resolution is never a
        guess. Ids that still do not resolve come back with{" "}
        <code>did_you_mean</code> suggestions rather than a bare rejection —
        without them the model has nothing to go on but another guess, and a
        wasted round trip was the most common friction on the surface.
      </p>

      <h3>The second one: a friendly type string</h3>

      <p>
        <code>describeType</code> rendered <code>z.boolean()</code> as{" "}
        <code>yes / no</code>. It reads well. It is also a lie about what the
        schema accepts, and models believed it: they sent the literal string{" "}
        <code>&quot;yes&quot;</code> for half of all writes to a boolean field,
        got back <em>expected boolean, received string</em>, and looped. Twenty
        one of forty eight runs had a retry loop on this single string.
      </p>

      <p>
        It now renders <code>true or false</code>, and a type mismatch on a
        quoted number or boolean gets a hint naming the JSON shape to send. Type
        strings name what the schema accepts, not a friendly paraphrase of it.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="history">The defect that changed the storage model</h2>

      <p>
        The third one was not a string. With one entry per field, a model
        writing <code>&quot;&quot;</code> to clear an answer overwrote the real
        one. The design said nothing is ever deleted; with a single entry per
        field, that was only true of applicability changes.
      </p>

      <p>
        So storage became a per-field append-only revision log plus a cursor
        saying which revision is in force.
      </p>

      <CodeBlock
        filename="glove-memory/forms"
        language="typescript"
        code={`interface FieldHistory {
  /** Oldest first. Append-only — nothing is ever removed or rewritten. */
  revisions: FormEntry[];
  /** Index of the revision in force. -1 means none. */
  cursor: number;
}`}
      />

      <p>
        A retraction is itself a revision — <code>retracted: true</code> with no
        value — so &ldquo;the user took that back&rdquo; and &ldquo;the user
        changed their mind&rdquo; are the same mechanism. That collapses{" "}
        <code>set</code>, <code>retract</code>, <code>undo</code> and{" "}
        <code>redo</code> into cursor arithmetic over a log that cannot lose
        anything, and makes every one of them reversible. Blank writes went to
        zero.
      </p>

      <h3>Four moves, one tool</h3>

      <p>
        All four ride on <code>glove_form_revise</code> behind an{" "}
        <code>action</code> parameter rather than shipping three new tools. Tool
        schemas are re-sent on every completion call, and the eval measured them
        at roughly <strong>three quarters of this surface&apos;s entire context
        cost</strong>. One enum on a verb the model already has is far cheaper
        than three more definitions — and &ldquo;revise&rdquo; is the honest
        word for all four moves anyway.
      </p>

      <p>
        The same logic shaped the view. What undo and redo would do is surfaced
        as one line each at the view level, not as a flag on every field row:
        the agent needs to know the move exists, not to audit each field&apos;s
        depth on every call.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="adapter">What we chose not to build</h2>

      <p>
        The adapter was heading toward a conformance test suite — a package that
        would tell an implementer whether their backend was correct. We dropped
        it. A conformance suite is a way of specifying behaviour by making the
        specification executable, and every assertion it makes is a decision
        taken away from the person writing the adapter.
      </p>

      <p>
        What shipped instead is documentation with a sharp edge. Four invariants
        the engine actually relies on:
      </p>

      <ol>
        <li>
          <strong>
            <code>entries</code> appends, never replaces.
          </strong>{" "}
          A commit carries a per-field <code>{"{ append?, cursor? }"}</code>,
          not a whole <code>FieldHistory</code>.{" "}
          <code>applyEntryCommit</code> is exported so nobody has to
          reimplement it.
        </li>
        <li>
          <strong>
            <code>version</code> is compare-and-set.
          </strong>{" "}
          The runner retries a conflict a few times — it relies on losing, not
          on winning.
        </li>
        <li>
          <strong>A commit is all-or-nothing.</strong> This is what makes
          commit-then-run dispatch safe.
        </li>
        <li>
          <strong>Reads hand back snapshots.</strong> If your store can return
          live references, clone on the way out.
        </li>
      </ol>

      <p>
        And an explicit list of what is <em>not</em> specified: storage engine,
        schema, indexing, retention, how atomicity is achieved, provenance
        depth, multi-tenancy, encryption. An adapter&apos;s job is storage and
        retrieval. The engine holds every semantic — liveness, applicability,
        rising edges, completion — and recomputes them from whatever it is
        handed back.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="routing">Routing arrived last, and late</h2>

      <p>
        A checkpoint is a trigger: a condition over values and prior state,
        fired on its rising edge. It could already jump the conversation
        forward. Jumping <em>back</em> to a step that had already completed was
        silently dropped — which is the one thing a routing trigger could ask
        for and not get.
      </p>

      <p>
        A backwards jump is now a <strong>revisit</strong>. The step reopens,
        its answers stay <code>filled</code> but come back with{" "}
        <code>ask: true</code>, and tier 0 says{" "}
        <code>back at step N/M &quot;Title&quot; — go through it again</code>{" "}
        even on an otherwise-complete form. The override is released by the next
        write into that step, so a jump nudges rather than pins.
      </p>

      <p>
        Two smaller additions came with it. Executors now receive the same{" "}
        <code>FormState</code> their gates do, so a router can branch on where
        the conversation has <em>been</em> and not only on the values it holds.
        And an executor may return an array of effects, so one firing can stamp
        a derived value and move in the same breath.
      </p>

      <CodeBlock
        filename="a router that stamps and moves"
        language="typescript"
        code={`.checkpoint("triage", {
  when: (v, s) => s.stepComplete("incident") && v.severity !== undefined,
  run: ({ values, state }) => {
    if (values.severity === "minor" && !state.stepComplete("injuries")) {
      return [
        { patch: { track: "fast" } },   // stamp a derived value…
        { jump: "review" },             // …and route, in the same firing
      ];
    }
    if (values.priorClaimId) return { jump: "identity" };  // back — a revisit
  },
})`}
      />

      <p>
        The other gap was ending a form for the right reason.{" "}
        <code>{"{ fail }"}</code> records a rejection and lets the conversation
        carry on; <code>{"{ complete }"}</code> claims the form{" "}
        <em>succeeded</em>. Neither fits ineligible, duplicate, or withdrawn.{" "}
        <code>{"{ terminate: reason }"}</code> now stops collection outright —
        closes the instance with a <code>closedReason</code>, stops every field
        asking, refuses further writes, and beats a completion that would
        otherwise have landed on the same commit.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="lessons">What generalises</h2>

      <p>
        <strong>The friction is almost never in the engine.</strong> Four of the
        five defects were in strings the model reads — an id it could not echo,
        a type it could not parse, a verb whose description did not say what{" "}
        <em>not</em> to do. The state machine was fine the whole time. If you
        are optimising an agent-facing API, the descriptions are the API.
      </p>

      <p>
        <strong>A surface that inspects as correct can be hostile in use.</strong>{" "}
        Nothing on that table was found by reading the code, and several of them
        are obvious in hindsight. The only way to find them is to run the thing
        against models that do not know what you meant.
      </p>

      <p>
        <strong>Tool schemas are the dominant context cost.</strong> Not
        descriptions, not results — schemas, re-sent on every completion call.
        That measurement is why four verbs became one enum, and it should
        probably change how you count the cost of &ldquo;just one more
        tool&rdquo;.
      </p>

      <p>
        <strong>Fix the harness before you trust the number.</strong> A{" "}
        <code>max_tokens</code> of 1024 starved the reasoning models entirely —
        they returned <code>finish_reason: &quot;length&quot;</code> with no
        content and no tool calls, which is indistinguishable from a model
        ignoring your tools. Two graders were measuring the wrong thing: one
        scored retraction, the better behaviour, as failure; another asked a
        genuinely ambiguous question and then marked the model down for
        answering it a defensible way. Both are recorded in the bench README
        rather than quietly corrected, because a benchmark whose fixes are
        invisible is not evidence.
      </p>

      <p>
        <strong>Not everything belongs to you.</strong> The adapter conformance
        suite would have been good engineering aimed at the wrong target. The
        contract needed to be small enough that somebody could implement it over
        a store we have never heard of, and documentation does that where a test
        suite does not.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="open">Still open</h2>

      <p>
        Switching to a <em>different</em> form definition mid-conversation has
        no effect type. A trigger can terminate the form it is in and an agent
        can start another, but there is no single move that hands the collected
        values across — and the instance and value semantics of that move are a
        product decision rather than an engineering one. It is deliberately
        unbuilt.
      </p>

      <p>
        Forms ships as <code>glove-memory/forms</code> with an in-process
        reference adapter, seven agent tools plus a read-only eighth, and the
        eval harness under <code>examples/forms-bench</code> — which is worth
        running against your own forms, not just ours. The{" "}
        <a href="/docs/memory">memory docs</a> carry the full API.
      </p>
    </div>
  );
}
