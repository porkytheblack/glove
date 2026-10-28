import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { HarnessDiagram } from "@/components/diagrams";
import { AlreadyBuilt, StepKicker, StepPath } from "@/components/build-step";
import { docsMetadata } from "@/lib/docs-nav";

const HREF = "/docs/build/context";
export const metadata = docsMetadata(HREF);

export default function BuildContextPage() {
  return (
    <article className="docs-content">
      <StepKicker href={HREF} />
      <h1>Control what it sees</h1>
      <p className="blog-lede">
        Every model call is built from three things: the system prompt, the saved
        history, and whatever is true right now. Glove keeps the first two stable and
        delivers the third fresh before every call, so the agent always sees current
        state and the provider can still cache everything before it.
      </p>

      <HarnessDiagram highlight="context" />

      <h2 id="shape">The shape of every call</h2>
      <CodeBlock
        filename="what the model receives, every iteration"
        language="text"
        code={`system prompt            stable: who the agent is, its rules
saved history            stable: the conversation (after the last compaction)
                         + "history" context, saved once per change
"request" context        frozen for this request, just before its message
the request's message
tool calls and results   this request so far, plus events that arrived mid-loop
─────────────────────────────────────────────────── cache boundary
"iteration" context      fresh: current state from your providers
                         (never saved, never rewrites the prompt)`}
      />
      <p>
        The tempting mistake is to rebuild the system prompt on every turn with the
        current state pasted in. It works until it doesn&apos;t: the prompt cache
        misses on every call, old states linger in history when you echo them into
        messages, and between two tool calls in the same request the state the model
        sees is already stale. Runtime context fixes all three.
      </p>

      <h2 id="providers">Live state: context providers</h2>
      <CodeBlock
        filename="release.ts"
        language="typescript"
        code={`// Called before every model iteration, including between tool steps.
const stop = agent.addContextProvider(async () => {
  const release = await releases.current(); // your data
  if (!release) return null;                 // nothing to add this time
  return [
    \`Release in progress: \${release.version} (\${release.status}).\`,
    \`Merged since last tag: \${release.changes.length} pull requests.\`,
    \`Blocking: \${release.blockers.join(", ") || "nothing"}.\`,
  ].join("\\n");
});

// Later, when the release ships:
stop();`}
      />
      <p>
        A provider returns a string, content parts (an image of a dashboard, say) or{" "}
        <code>null</code>. The text arrives as a transient user-role message at the
        tail. Subscribers get a <code>runtime_context</code> event with what was sent
        (the text exactly, media as a placeholder), so you can trace it. glove-memory&apos;s pinned context, forms and
        goals all use this same seam; so does <code>mountBrowser</code> to show the
        model its latest screenshot.
      </p>

      <h2 id="delivery">When it arrives: delivery</h2>
      <p>
        A provider&apos;s <code>delivery</code> decides when it is read and whether it
        stays:
      </p>
      <CodeBlock
        filename="delivery.ts"
        language="typescript"
        code={`// Default: re-read before every model call, tool steps included. For state a
// tool can change mid-request — a browser screenshot, a build that is running.
agent.addContextProvider(renderBuild);

// Read once per request and frozen just before the request's message. The input
// is identical on every tool step, so each step reuses the cache.
agent.addContextProvider(renderAccount, { delivery: "request" });

// Saved to history before the request's message, only when it changed. It ages
// into the background like any message; the model reasons over it without a
// tool call. Saved again after compaction hides it. Text only.
agent.addContextProvider(renderPlan, { delivery: "history", key: "plan" });`}
      />
      <p>
        A history provider&apos;s text is saved wrapped in{" "}
        <code>&lt;context key=&quot;plan&quot;&gt;</code>, which is how Glove finds
        its last value again with any store, after a restart too. When it returns
        nothing after having saved something, a{" "}
        <code>status=&quot;cleared&quot;</code> marker is saved once. Goals, forms and
        pinned context take the same option:{" "}
        <code>useGoalRunner(agent, adapter, {"{ scope, delivery: \"history\" }"})</code>.
      </p>
      <p>
        Prompt caching follows: the Anthropic and Bedrock adapters put their
        conversation breakpoint on the last saved block, never on a transient one,
        plus one just before request-frozen context, because that prefix is what the
        next request starts with.
      </p>

      <h2 id="events">Things that happen on their own: events</h2>
      <p>
        Tool results and user messages have a place in the loop. A reply from
        another agent, a webhook or a calendar change arrives on its own schedule.
        Hand it to <code>emitEvent</code>:
      </p>
      <CodeBlock
        filename="events.ts"
        language="typescript"
        code={`await agent.emitEvent({
  id: delivery.id,                 // emitting the same id twice is a no-op
  source: "webhook:ci",
  kind: "build.finished",
  content: \`Build \${build.id} is \${build.status}.\`,
  whenIdle: "auto",                // "wake" | "defer" | "auto"
});

// From your client: the user is typing, or a voice session is live.
agent.notifyUserActivity();`}
      />
      <ul>
        <li>
          <strong>While the loop runs</strong>, the event joins at the next tool-step
          boundary, saved once right after the tool results.
        </li>
        <li>
          <strong>While idle</strong>, the policy decides. By default an event wakes
          the agent, starting a turn with the event as its message, unless the user
          has been active recently: then it waits and is saved just before their
          next message. A deferred event wakes the agent after{" "}
          <code>deferTimeoutMs</code> (60 s by default) if no message comes.
        </li>
      </ul>
      <p>
        Events reach the model as escaped XML,{" "}
        <code>&lt;event id source kind received_at&gt;</code> inside an{" "}
        <code>&lt;events&gt;</code> wrapper that says they came from outside and are
        information, not instructions. Replace the policy, the formatter or the
        in-memory queue (for a durable one) through the <code>events</code> option
        on <code>new Glove</code>. Turns run one at a time, so a woken turn and a
        user&apos;s message never interleave. Subscribers get{" "}
        <code>event_received</code>, <code>event_injected</code>,{" "}
        <code>event_dropped</code> and <code>event_wake_failed</code>.
      </p>

      <h2 id="skills">Guidance on demand: skills</h2>
      <p>
        Long procedures don&apos;t belong in the system prompt. Give the agent a
        listing and let it read what it needs:
      </p>
      <CodeBlock
        filename="release.ts"
        language="typescript"
        code={`import { useReadSkill } from "glove-core";

useReadSkill(agent, [
  {
    name: "release-checklist",
    description: "The team's release procedure. Read before tagging anything.",
    content: "# Release checklist\\n1. All CI green on main\\n2. Changelog drafted ...",
    sections: {
      hotfix: "# Hotfix releases\\nBranch from the last tag, cherry-pick, ...",
    },
  },
]);`}
      />
      <p>
        The agent gets one <code>glove_read_skill</code> tool whose description lists
        the skills; reading one returns its content, or a named section. Users can
        also type <code>/release-checklist</code> to load it into the next turn. Keep
        skills as files with <code>loadContentSkillsFromFs</code> from{" "}
        <code>glove-core/content-skills-fs</code>, the same shape as a coding
        agent&apos;s <code>SKILL.md</code> folders.
      </p>
      <p>
        For commands that change the agent rather than add text, use hooks.{" "}
        <code>glove.defineHook(&quot;compact&quot;, …)</code> runs when a user types{" "}
        <code>/compact</code>, with full control: force compaction, swap the model,
        or answer without calling the model at all. See{" "}
        <Link href="/docs/extensions">hooks, skills and subagents</Link>.
      </p>

      <h2 id="plan">A plan the agent keeps: the task list</h2>
      <p>
        If the store implements tasks (<code>MemoryStore</code> does), every agent gets{" "}
        <code>glove_update_tasks</code>. The model writes its plan as tasks with a
        status and updates them as it works; your UI reads{" "}
        <code>store.getTasks()</code> to show progress. There is nothing to wire up.
      </p>

      <h2 id="long">Long sessions: compaction and summaries</h2>
      <ul>
        <li>
          <strong>Compaction</strong> summarises the conversation when it nears{" "}
          <code>compaction_context_limit</code>, using your{" "}
          <code>compaction_instructions</code>. The model continues from the summary;
          the store still has every message, so your UI shows the whole thread.
          Pending inbox items are carried into the summary, and tasks live in the
          store, so neither is lost.
        </li>
        <li>
          <strong>Tool result summaries</strong>: turn on{" "}
          <code>enableToolResultSummary</code>, give the tool{" "}
          <code>generateToolSummary</code>, and return{" "}
          <code>generateSummaryArgs</code> from its <code>do()</code>. A large
          result is then replaced by its summary in later requests.
        </li>
        <li>
          <strong>Keep big data out entirely.</strong> A 5,000-row result belongs in a
          file or a REPL variable, not in context. That is{" "}
          <Link href="/docs/build/workspace">step 5</Link>.
        </li>
      </ul>

      <h2 id="already-built">Already built for you</h2>
      <AlreadyBuilt parts={["context"]} />

      <h2 id="next">Next</h2>
      <p>
        The agent sees the right things now, but forgets the team the moment the
        process restarts. In <Link href="/docs/build/state">step 4</Link> it gets a
        durable store, an inbox for answers that arrive later, and memory.
      </p>
      <StepPath href={HREF} />
    </article>
  );
}
