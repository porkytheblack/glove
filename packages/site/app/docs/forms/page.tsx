import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Forms",
  description:
    "Structured collection over a conversation — Zod-authored definitions, lazily loaded, with colocated executors.",
};

export default function FormsPage() {
  return (
    <div className="docs-content">
      <h1>Forms</h1>

      <p>
        The fifth subsystem in <code>glove-memory</code>:{" "}
        <strong>structured collection over a conversation</strong>. You need
        eleven specific values from a user; a form gets them without turning the
        conversation into an interrogation, and without the agent ever reading
        the definition.
      </p>

      <p>
        Definitions are <strong>code</strong> — Zod schemas, gate closures and
        executors colocated in one builder chain. The agent never sees them. It
        sees a projection of <em>evaluated state</em>: which step is open, what
        is still pending, and what is coming later.
      </p>

      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          Forms ship in <code>glove-memory</code> and can be used on their own —
          you do not need entity, episodic, resources or context to run one. If
          you do have them, <code>ctx.memory</code> inside an executor bridges
          straight through. See <a href="/docs/memory">Memory</a> for the other
          four.
        </p>
      </div>

      <h2 id="defining-a-form">Defining a form</h2>

      <p>
        A definition is a builder chain. Each <code>.field()</code> widens the
        accumulated values type, so every predicate and executor downstream is
        typed against the real shape — <code>ctx.values.mode</code> narrows to
        its enum union, <code>ctx.values.mileage</code> is{" "}
        <code>number | undefined</code>.
      </p>

      <CodeBlock
        filename="forms/travel-claim.ts"
        language="typescript"
        code={`import { z } from "zod";
import { defineForm } from "glove-memory/forms";

export const travelClaim = defineForm({
  id: "travel-claim",
  version: 1,
  name: "Travel reimbursement claim",
  description: "Claimant, trip, travel and approval details.",
  conduct:
    "Conversational — one or two questions at a time. Don't read the field " +
    "list aloud. If the user volunteers something out of order, capture it.",
})
  .step("claimant", { title: "Claimant", preview: "name, staff id, email" }, (s) =>
    s
      .field("fullName", {
        schema: z.string().min(2),
        label: "Full name",
        ask: "Get their full legal name as it would appear on a filing.",
      })
      .field("email", { schema: z.string().email(), label: "Work email" }),
  )
  .step(
    "travel",
    {
      title: "Travel",
      preview: "how they travelled, mileage or ticket",
      when: (v, s) => s.stepComplete("claimant"),
    },
    (s) =>
      s
        .field("mode", { schema: z.enum(["car", "rail", "air"]), label: "Mode" })
        .field("mileage", {
          schema: z.number().int().min(1).optional(),
          label: "Miles driven",
          when: (v) => v.mode === "car",     // only means anything for a car
        }),
  )
  .checkpoint("policy-cap", {
    when: (v) => typeof v.total === "number" && v.total > 750,
    blocking: true,
    waitMessage: "Checking this against policy — one moment.",
    run: () => ({ fail: "Over the limit — needs Finance pre-approval." }),
  })
  .onComplete(async (ctx) => {
    await ctx.memory.upsertNode("Person", { name: ctx.values.fullName });
  })
  .build();`}
      />

      <h2 id="optionality">Optionality and type come from Zod</h2>

      <p>
        There is no <code>required</code> option. A field is optional{" "}
        <em>iff</em> its schema accepts <code>undefined</code> — the same
        predicate the inferred values type is built from, so the two can never
        disagree. The <code>type</code> string the agent reads is derived too,
        via <code>z.toJSONSchema</code> plus a small renderer:{" "}
        <code>&quot;email address&quot;</code>,{" "}
        <code>&quot;one of: car | rail | air&quot;</code>,{" "}
        <code>&quot;integer &gt;= 1&quot;</code>. Together those delete the
        field-type vocabulary entirely — no type union, no registry, nothing to
        extend.
      </p>

      <h2 id="writes-are-never-gated">Writes are never gated</h2>

      <p>
        <strong>There is no lock.</strong> Any value the agent can derive, at any
        point in the conversation, is accepted — the only thing that can reject a
        write is Zod. A user who answers question six while being asked question
        two has answered question six. <code>glove_form_fill</code> takes a patch
        of <em>any</em> field ids, validates each independently so one bad value
        does not reject the rest, and returns what landed.
      </p>

      <p>
        Field ids are forgiving: <code>full_name</code>,{" "}
        <code>Full name</code> and <code>fullName</code> all resolve to the same
        field through an alias index built at compile time over normalised ids
        and labels. A definition whose fields would collide once case and
        punctuation are stripped is rejected at compile, so resolution is never a
        guess — and an id that still does not resolve comes back with{" "}
        <code>did_you_mean</code> rather than a bare rejection. Models guess ids
        confidently for fields they have not seen, and a bare miss costs a whole
        round trip.
      </p>

      <p>Sequence is advisory, and splits into two unrelated things:</p>

      <ul>
        <li>
          <strong>
            <code>when</code> — applicability.
          </strong>{" "}
          Whether a field <em>means anything</em> given current answers.{" "}
          <code>mileage</code> is meaningless on a rail trip. Inapplicable fields
          do not count toward completion and are not asked about — but a value
          supplied for one is kept.
        </li>
        <li>
          <strong>Steps — ask order.</strong> A conversational grouping and a
          checkpoint boundary. <code>ask: true</code> means &ldquo;steer toward
          this now&rdquo;; the agent stays free to follow the user elsewhere and
          come back.
        </li>
      </ul>

      <h2 id="entries">Entries, liveness and held values</h2>

      <p>
        <code>entries</code> maps each field to an{" "}
        <strong>append-only log of revisions</strong> plus a cursor naming the
        one in force. Nothing is ever removed or rewritten — a correction
        appends, it does not overwrite — so any earlier answer stays readable and
        any change stays reversible. A retraction is a revision too, which is
        what makes <code>retract</code>, <code>undo</code> and <code>redo</code>{" "}
        pure cursor moves.
      </p>

      <CodeBlock
        filename="host-side"
        language="typescript"
        code={`await runner.retract("ticketReference"); // withdraw, keeping the answer
await runner.undo();                     // last answer anywhere on the form
await runner.undo("mileage");            // or on one field
await runner.redo("mileage");
await runner.history("mileage");         // every answer ever given`}
      />

      <p>
        The agent reaches all four through <code>glove_form_revise</code>&apos;s{" "}
        <code>action</code> parameter — <code>set</code>, <code>retract</code>,{" "}
        <code>undo</code>, <code>redo</code> — rather than four separate verbs.
        Tool schemas are re-sent on every model call, and an agentic evaluation
        measured them at roughly three quarters of this surface&apos;s whole
        context cost; an enum on a verb the model already has is far cheaper than
        three more definitions.
      </p>

      <p>On top of that log, what changes is which entries are <strong>live</strong>:</p>

      <table>
        <thead>
          <tr>
            <th>Term</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>entry</td>
            <td>An answer the user gave for a field</td>
          </tr>
          <tr>
            <td>applicable</td>
            <td>
              <code>field.when(liveValues, state) === true</code>
            </td>
          </tr>
          <tr>
            <td>live entry</td>
            <td>An entry whose field is applicable</td>
          </tr>
          <tr>
            <td>
              <code>values</code>
            </td>
            <td>Derived: the live entries — what counts</td>
          </tr>
          <tr>
            <td>
              <code>held</code>
            </td>
            <td>Derived: the non-live entries — kept, doesn&apos;t count</td>
          </tr>
        </tbody>
      </table>

      <p>
        <strong>Held</strong> means <em>the user told us this, and it is not
        relevant right now.</em> Either it was answered before it applied
        (&ldquo;I drove 40 miles&rdquo; landing before <code>mode</code>), or a
        revision orphaned it (<code>car</code> → <code>rail</code>). Change the
        answer back and the entry is live again, with the original value intact.
      </p>

      <p>
        Repartitioning — the recomputation of the live set — runs on every commit
        and is not a data move: assume every entry is live, evaluate each{" "}
        <code>when</code>, drop the entries whose gate returned false, repeat
        until the set stops shrinking. Shrink-only, so it always terminates, and
        the common case is one pass.
      </p>

      <p>
        Completion counts <strong>applicable required fields only</strong>. A
        claim with a held <code>mileage</code> on a rail trip is complete without
        it, and <code>form.onComplete</code> receives <code>values</code>, never{" "}
        <code>held</code>.
      </p>

      <h2 id="executors">Executors</h2>

      <p>Four colocation points behind one signature:</p>

      <table>
        <thead>
          <tr>
            <th>Hook</th>
            <th>Fires when</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>field.onFill</code>
            </td>
            <td>That field&apos;s entry crosses into the live set</td>
          </tr>
          <tr>
            <td>
              <code>step.onComplete</code>
            </td>
            <td>Every applicable required field in the step is valid</td>
          </tr>
          <tr>
            <td>
              <code>checkpoint.run</code>
            </td>
            <td>
              The checkpoint&apos;s <code>when</code> first holds
            </td>
          </tr>
          <tr>
            <td>
              <code>form.onComplete</code>
            </td>
            <td>Every applicable required field is valid</td>
          </tr>
        </tbody>
      </table>

      <p>
        Dispatch is <strong>commit-then-run</strong>: values and the rising-edge
        log commit in one atomic write, then executors run. At-least-once with a
        per-occurrence <code>idempotencyKey</code> (
        <code>{"${instanceId}:${hookId}:${occurrence}"}</code>) — a retry reuses
        the key, a genuine second crossing gets a fresh one, and whether a repeat
        is real work is the executor&apos;s call.
      </p>

      <p>
        An executor hands back <code>{"{ patch }"}</code> (derived values,
        committed like any other write), <code>{"{ fail }"}</code> (a blocking
        checkpoint rejecting), <code>{"{ jump }"}</code>,{" "}
        <code>{"{ complete: true }"}</code>, or{" "}
        <code>{"{ terminate: reason }"}</code>. <code>ctx.memory</code> bridges
        to the other four subsystems — <code>upsertNode</code>,{" "}
        <code>connect</code>, <code>recordEpisode</code>,{" "}
        <code>writeResource</code>, <code>setContext</code> — with provenance
        supplied by the engine.
      </p>

      <h2 id="triggers">Triggers that steer the conversation</h2>

      <p>
        A checkpoint <em>is</em> a trigger: a condition over values, fired on its
        rising edge, running an executor. Returning <code>{"{ jump }"}</code>{" "}
        moves the open step — forward to skip ahead, or{" "}
        <strong>back to a step that already finished</strong>.
      </p>

      <CodeBlock
        language="typescript"
        code={`.checkpoint("verify-identity", {
  when: (v) => v.claimValue > 10_000,
  run: () => [
    { patch: { verificationRequired: true } },
    { jump: "claimant" },          // go back and re-check who we're talking to
  ],
})`}
      />

      <p>
        An executor may return one effect or an array of them, so a router can
        stamp a derived value <em>and</em> move in the same firing.
      </p>

      <p>
        A backwards jump is a <strong>revisit</strong>: the step&apos;s answers
        stay <code>filled</code> but come back with <code>ask: true</code>,
        because there is no point being sent somewhere every field reads as
        settled. Tier 0 says so too —{" "}
        <code>
          [form: x] back at step 1/3 &quot;Claimant&quot; — go through it again
        </code>{" "}
        — and it says it even when the form had already completed, since a silent
        jump is the same as no jump at all.
      </p>

      <p>
        A router branches on <strong>both</strong> halves of the state.{" "}
        <code>when</code> and <code>run</code> each get a <code>FormState</code>{" "}
        — step completion, which checkpoints have fired, whether the form is done
        — alongside the typed values, so a trigger can route on where the
        conversation has been and not only on what it holds.
      </p>

      <CodeBlock
        language="typescript"
        code={`.checkpoint("route", {
  when: (v, s) => Boolean(v.kind) && s.stepComplete("triage"),
  run: (ctx) => ({
    jump: ctx.state.stepComplete("triage") && ctx.values.kind === "complex"
      ? "complex-detail"
      : "simple-detail",
  }),
})`}
      />

      <p>
        <code>checkpointFired</code> reads the same counters the gate saw, so
        asking about a checkpoint inside its own <code>run</code> reports whether
        it fired <em>before</em> — not the firing in progress.
      </p>

      <h3 id="terminating">Terminating collection</h3>

      <p>
        <code>{"{ terminate: reason }"}</code> stops the form outright, for the
        cases where carrying on would be wrong rather than merely unfinished —
        ineligible, duplicate, withdrawn.
      </p>

      <CodeBlock
        language="typescript"
        code={`.checkpoint("eligibility", {
  when: (v) => typeof v.age === "number" && v.age < 18,
  run: () => ({ terminate: "Under 18 — not eligible for this scheme." }),
})`}
      />

      <p>
        It is neither of the two effects that already existed:{" "}
        <code>fail</code> records a rejection and lets the conversation carry on,
        and <code>complete</code> claims the form succeeded.{" "}
        <code>terminate</code> closes the instance with the reason on{" "}
        <code>closedReason</code>, stops every field asking, refuses further
        writes, and takes the form out of tier 0. It beats a completion that
        would otherwise have landed on the same commit — an ineligible claim must
        not read as a finished one.
      </p>

      <p>
        A jump is a nudge, not a pin. The override is released by the next write
        that lands in the step it sent you to, after which ordering goes back to
        being derived. A jump naming a step that does not exist is ignored.
      </p>

      <h2 id="lazy-loading">Lazy loading</h2>

      <p>
        Modelled on <a href="/docs/inbox">the inbox</a> — a cheap standing
        notification, detail pulled on demand. <strong>Tier 0</strong> is one
        line appended to the system prompt each turn, the way{" "}
        <code>useContext</code> injects:
      </p>

      <CodeBlock
        language="text"
        code={`[form: travel-claim] step 2/4 "Trip" · pending: Destination, Departure date
later: Travel (how they travelled, mileage or ticket) · Approval (cost centre, manager)`}
      />

      <p>
        Pending <em>labels</em> rather than a count, because &ldquo;5 fields
        pending&rdquo; would force a tool call every turn just to learn what to
        ask. A one-line <code>preview</code> per remaining step, because that is
        what makes opportunistic capture work without loading the whole form — an
        agent that hears &ldquo;I drove, it was about 40 miles&rdquo; during step
        2 can see travel is coming. Asks, hints, enum options, validation rules
        and every field outside the open step stay out.
      </p>

      <p>
        <strong>Tier 1</strong> (<code>glove_form_status</code>) is the open step
        in full. <strong>Tier 2</strong> (<code>glove_form_inspect</code>) is any
        named step, a single field, or the whole outline — with gated-off fields
        marked <code>ask: false</code>, so the agent can answer &ldquo;what else
        will you need?&rdquo; without promising something a branch may skip.
      </p>

      <p>
        <strong>Registry-level laziness</strong> — form modules are not imported
        until started. <code>glove_form_list</code> renders name and description
        from the registration; <code>compileForm</code> runs on first{" "}
        <code>start</code>, then caches.
      </p>

      <h2 id="tools">The tool surface</h2>

      <p>
        <code>useFormRunner</code> folds seven tools;{" "}
        <code>glove_form_history</code> comes from the reader registration, so an
        agent can read past fills without being able to write.
      </p>

      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>glove_form_list</code>
            </td>
            <td>Registered forms, name + description — no module load</td>
          </tr>
          <tr>
            <td>
              <code>glove_form_start</code>
            </td>
            <td>Begin an instance, with optional seed values</td>
          </tr>
          <tr>
            <td>
              <code>glove_form_status</code>
            </td>
            <td>The open step in full <em>(tier 1)</em></td>
          </tr>
          <tr>
            <td>
              <code>glove_form_inspect</code>
            </td>
            <td>Any step, field, or the whole outline <em>(tier 2)</em></td>
          </tr>
          <tr>
            <td>
              <code>glove_form_fill</code>
            </td>
            <td>
              A patch of many fields at once; returns re-evaluated state
            </td>
          </tr>
          <tr>
            <td>
              <code>glove_form_revise</code>
            </td>
            <td>
              Amend an earlier answer — <code>set</code> / <code>retract</code> /{" "}
              <code>undo</code> / <code>redo</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>glove_form_abandon</code>
            </td>
            <td>Close out with a reason</td>
          </tr>
          <tr>
            <td>
              <code>glove_form_history</code>
            </td>
            <td>
              Read past fills <em>(reader registration)</em>
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="wiring">Wiring</h2>

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`import { FormRegistry } from "glove-memory/forms";
import { InMemoryFormAdapter } from "glove-memory/in-memory";
import { useFormRunner, useFormReader } from "glove-memory";

const registry = new FormRegistry().register("travel-claim", {
  name: "Travel reimbursement claim",
  description: "Claimant, trip, travel and approval details.",
  // Not imported until a form is actually started.
  load: () => import("./forms/travel-claim").then((m) => m.travelClaim),
});

const { runner } = useFormRunner(glove, new InMemoryFormAdapter({ schema }), {
  registry,
  subject: conversationId,
  memory: { entity, episodic, resources, context },  // optional bridge
});

// A second agent that can read past fills but never write:
useFormReader(auditor, adapter, { registry });`}
      />

      <p>
        <code>useFormRunner</code> folds the tools and wraps{" "}
        <code>processRequest</code> for tier-0 injection (
        <code>injectStatus: false</code> turns that off), then hands back the
        runner so a host can start instances and resolve checkpoints{" "}
        <em>without going through the model</em> — which is how a blocking
        checkpoint gets its answer from your backend rather than from the
        conversation.
      </p>

      <h2 id="operational-notes">Operational notes</h2>

      <p>
        Verified by probe, and worth knowing before you wire this to anything
        real:
      </p>

      <ul>
        <li>
          <strong>Hook order within one commit is fixed:</strong>{" "}
          <code>field.onFill</code> → <code>step.onComplete</code> →{" "}
          <code>checkpoint.run</code> → <code>form.onComplete</code>.
        </li>
        <li>
          <strong>Only rising edges fire.</strong> A step that becomes incomplete
          fires nothing; completing again is a fresh occurrence with a new
          idempotency key.
        </li>
        <li>
          <strong>A step with no applicable required fields is complete</strong>{" "}
          — including an all-optional step, whose <code>onComplete</code>{" "}
          therefore fires the moment the form starts.
        </li>
        <li>
          <strong>A throwing executor does not roll back the write.</strong>{" "}
          Dispatch is commit-then-run, so the answer is durable; the failure is
          recorded and surfaced to the agent.
        </li>
        <li>
          <strong>A recorded failure is not retried.</strong> At-least-once
          covers a crash <em>before</em> the outcome was recorded — a hook that
          ran and failed stays failed until its field crosses into live again. If
          you need retries, do them inside the executor.
        </li>
        <li>
          <strong>
            A blocking checkpoint whose executor never returns leaves the
            instance <code>awaiting</code> indefinitely.
          </strong>{" "}
          Writes are refused with <code>form_blocked</code> until{" "}
          <code>resolveCheckpoint</code> is called. There is no timeout; a host
          that can crash mid-checkpoint should recover them on startup.
        </li>
        <li>
          <strong>
            <code>recordDispatch</code> writes outside the CAS envelope.
          </strong>{" "}
          A concurrent commit can lose dispatch bookkeeping, which costs a
          duplicate executor run — the exact thing the idempotency key exists to
          absorb.
        </li>
        <li>
          <strong>A complete instance stays reachable.</strong> Finishing a form
          does not end the conversation about it, so <code>revise</code> /{" "}
          <code>retract</code> / <code>undo</code> still resolve against it; only{" "}
          <code>abandon</code> closes it. Tier 0 stays quiet once complete.
        </li>
      </ul>

      <h2 id="writing-an-adapter">Writing a form adapter</h2>

      <p>
        <code>FormAdapter</code> is a storage-and-retrieval contract and nothing
        more. The engine holds every semantic — liveness, applicability, rising
        edges, completion — and recomputes them from whatever you hand back, so
        an adapter that persists <code>FormInstance</code> faithfully is a
        correct adapter whatever it is built on. Four invariants, and they are
        the whole of it:
      </p>

      <ol>
        <li>
          <strong>
            <code>entries</code> appends, never replaces.
          </strong>{" "}
          <code>commitInstance</code> receives a <code>FormEntryCommit</code> per
          field (<code>{"{ append?, cursor? }"}</code>), not a{" "}
          <code>FieldHistory</code>. Append to the existing log, move the cursor,
          then clamp it. Overwriting a field&apos;s log destroys answers the
          design guarantees are kept — <code>applyEntryCommit</code> is exported
          from <code>glove-memory/forms</code> so you can reuse the exact
          semantics rather than re-derive them.
        </li>
        <li>
          <strong>
            <code>version</code> is compare-and-set.
          </strong>{" "}
          Reject a stale <code>ifVersion</code> with{" "}
          <code>FormConflictError</code>; bump <code>version</code> on every
          write that lands. The runner retries a conflict — it relies on losing,
          not on winning.
        </li>
        <li>
          <strong>A commit is all-or-nothing.</strong> Entries, occurrence
          counters, dispatch log and status land together or not at all. That is
          what makes commit-then-run dispatch safe.
        </li>
        <li>
          <strong>Reads hand back snapshots.</strong> Clone if your store could
          return a live reference.
        </li>
      </ol>

      <p>
        Everything else is yours: storage engine and schema, indexing, retention,{" "}
        <em>how</em> you achieve atomicity, how much provenance you keep,
        multi-tenancy, encryption, soft deletes. The contract deliberately does
        not model any of it. Per-method detail lives in doc comments on the
        interface, and <code>InMemoryFormAdapter</code> is short enough to read
        end to end before writing your own.
      </p>

      <h2 id="def-drift">Def drift</h2>

      <p>
        Instances pin <code>defVersion</code> at start. When it stops matching
        the registered definition the runner does not guess: the default is{" "}
        <code>status: &quot;stale&quot;</code> with the reason surfaced, and a
        definition may supply <code>migrate(old, fromVersion)</code> to carry
        values forward. Bumping <code>version</code> is the developer&apos;s
        signal that a change is breaking — additive changes do not need it.
      </p>

      <h2 id="not-owned">What forms don&apos;t own</h2>

      <ul>
        <li>
          <strong>Runtime-authored forms.</strong> Definitions are code — there
          is no JSON compile target, no authoring UI, and no second front end.
        </li>
        <li>
          <strong>Compensating a re-fired executor.</strong> Hooks fire on every
          rising edge with a per-occurrence idempotency key; whether a repeat is
          real work is the executor&apos;s decision.
        </li>
        <li>
          <strong>Scheduling and orchestration.</strong> A host drives{" "}
          <code>start</code> and <code>resolveCheckpoint</code>; the engine only
          reacts.
        </li>
      </ul>

      <h2 id="related">Related</h2>

      <ul>
        <li>
          <a href="/docs/memory">Memory</a> — the other four subsystems, and the
          adapters <code>ctx.memory</code> bridges to
        </li>
        <li>
          <a href="/docs/inbox">The Inbox</a> — the standing-notification pattern
          tier 0 is modelled on
        </li>
        <li>
          <a href="/docs/display-stack">The Display Stack</a> — when a step is
          better collected as a rendered form than as questions
        </li>
      </ul>
    </div>
  );
}
