import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { HarnessDiagram } from "@/components/diagrams";
import { AlreadyBuilt, StepKicker, StepPath } from "@/components/build-step";
import { docsMetadata } from "@/lib/docs-nav";

const HREF = "/docs/build/surface";
export const metadata = docsMetadata(HREF);

export default function BuildSurfacePage() {
  return (
    <article className="docs-content">
      <StepKicker href={HREF} />
      <h1>Show your work</h1>
      <p className="blog-lede">
        A surface is how people reach the agent and see what it is doing. In Glove
        it is two primitives: an event stream (text as it arrives, tool calls as they
        happen) and a <strong>display stack</strong> that tools push UI onto, and can
        wait on. The second is what lets a tool stop and ask a person, then carry on
        with their answer.
      </p>

      <HarnessDiagram highlight="surface" />

      <h2 id="display-stack">The display stack in one paragraph</h2>
      <p>
        Every tool receives <code>display</code> as its second argument.{" "}
        <code>display.pushAndForget({"{ renderer, input }"})</code> renders something
        and lets the tool continue: a card, a table, progress.{" "}
        <code>await display.pushAndWait({"{ renderer, input }"})</code> renders
        something and suspends the tool until the person resolves it, then returns
        their answer to the tool, not to the model. (With glove-react&apos;s{" "}
        <code>defineTool</code>, below, the renderer is the tool itself, so you pass
        just the props.) Nothing about this is tied to chat: the same stack drives a
        web UI, a terminal prompt, or a permission dialog in an IDE.
      </p>

      <h2 id="web">Put the release assistant on the web</h2>
      <p>
        With <code>glove-react</code> and <code>glove-next</code>, the model call goes
        through a one-line route, the tools run in the browser next to their
        components, and anything that needs server credentials is a{" "}
        <code>fetch</code> to your own API.
      </p>
      <CodeBlock filename="terminal" language="bash" code={`pnpm add glove-react glove-next zod`} />
      <CodeBlock
        filename="app/api/chat/route.ts"
        language="typescript"
        code={`import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
});`}
      />
      <CodeBlock
        filename="lib/glove.tsx"
        language="tsx"
        code={`import { GloveClient, defineTool } from "glove-react";
import { z } from "zod";

const change = z.object({ number: z.number(), title: z.string(), labels: z.array(z.string()) });

// Shows the notes and keeps going: pushAndForget.
const showNotes = defineTool({
  name: "show_release_notes",
  description: "Show draft release notes to the user. Use after drafting them.",
  inputSchema: z.object({ version: z.string(), changes: z.array(change) }),
  displayPropsSchema: z.object({ version: z.string(), changes: z.array(change) }),
  async do(input, display) {
    await display.pushAndForget(input);
    return { status: "success", data: "Shown to the user." };
  },
  render({ props }) {
    return (
      <section>
        <h3>Release {props.version}</h3>
        <ul>{props.changes.map((c) => <li key={c.number}>#{c.number} {c.title}</li>)}</ul>
      </section>
    );
  },
});

// Asks and waits: pushAndWait. The model never sees the button, only the outcome.
const tagRelease = defineTool({
  name: "tag_release",
  description: "Tag and publish a release. Always confirms with the user first.",
  inputSchema: z.object({ version: z.string() }),
  displayPropsSchema: z.object({ version: z.string() }),
  resolveSchema: z.object({ confirmed: z.boolean() }),
  displayStrategy: "hide-on-complete",
  unAbortable: true,
  async do({ version }, display) {
    const { confirmed } = await display.pushAndWait({ version });
    if (!confirmed) return { status: "error", data: null, message: "The user cancelled." };
    const res = await fetch("/api/releases", { method: "POST", body: JSON.stringify({ version }) });
    return { status: "success", data: await res.json() };
  },
  render({ props, resolve }) {
    return (
      <div>
        <p>Tag and publish {props.version}?</p>
        <button onClick={() => resolve({ confirmed: true })}>Publish</button>
        <button onClick={() => resolve({ confirmed: false })}>Cancel</button>
      </div>
    );
  },
});

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You help a software team ship releases. Use tools for facts; never guess.",
  tools: [
    {
      name: "list_merged_changes",
      description: "List pull requests merged on or after a date, newest first.",
      inputSchema: z.object({ since: z.string() }),
      async do({ since }) {
        const changes = await (await fetch(\`/api/changes?since=\${since}\`)).json();
        return { status: "success", data: changes }; // plain tools return ToolResultData
      },
    },
    showNotes,
    tagRelease,
  ],
});`}
      />
      <CodeBlock
        filename="app/page.tsx"
        language="tsx"
        code={`"use client";
import { GloveProvider, Render, useGlove } from "glove-react";
import { gloveClient } from "@/lib/glove";

function Chat() {
  const glove = useGlove();
  return (
    <Render
      glove={glove}
      renderMessage={({ entry }) => <p><b>{entry.kind === "user" ? "You" : "Ship"}:</b> {entry.text}</p>}
      renderStreaming={({ text }) => <p style={{ opacity: 0.7 }}>{text}</p>}
      renderInput={({ send, busy }) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("msg") as HTMLInputElement;
            if (input.value.trim()) send(input.value.trim());
            input.value = "";
          }}
        >
          <input name="msg" disabled={busy} placeholder="Draft notes for 2.4.0" />
        </form>
      )}
    />
  );
}

export default function Page() {
  return <GloveProvider client={gloveClient}><Chat /></GloveProvider>;
}`}
      />
      <p>
        <code>&lt;Render&gt;</code> places each tool&apos;s slots in the conversation
        where they were pushed, applies the display strategy
        (<code>hide-on-complete</code> removes the confirm once answered), and renders
        history with <code>renderResult</code> when you add one. <code>useGlove()</code>{" "}
        exposes the same timeline if you would rather draw it yourself.
      </p>

      <h2 id="permission">Ask before every risky call, once</h2>
      <p>
        A confirm inside one tool is fine. For a policy (&quot;ask before any
        write&quot;), set <code>requiresPermission</code> on the tool instead:{" "}
        <code>true</code> for every call, or a function of the input, such as{" "}
        <code>(input) =&gt; input.command !== &quot;git status&quot;</code>. Glove asks
        through the display stack with a <code>permission_request</code> slot, stores
        the decision per tool and input, and returns a clear error to the model when
        the answer is no. You render that one slot type once for every gated tool;
        the <Link href="/docs/showcase/coding-agent">coding agent</Link> shows it. In{" "}
        <Link href="/docs/build/system">step 7</Link> the same flag becomes an
        approval record that anyone with access can resolve, even hours later.
      </p>

      <h2 id="other-surfaces">Other surfaces, same agent</h2>
      <table>
        <thead><tr><th>Surface</th><th>What you use</th></tr></thead>
        <tbody>
          <tr><td>Terminal or backend</td><td>Subscribers for streaming; <code>displayManager.subscribe()</code> to see slots and <code>resolve(slotId, value)</code> to answer them. See <Link href="/docs/server-side">server-side agents</Link>.</td></tr>
          <tr><td>WebSocket app</td><td>Forward subscriber events and slots over the socket; the <Link href="/docs/showcase/coding-agent">coding agent</Link> does exactly this.</td></tr>
          <tr><td>Voice</td><td><code>GloveVoice</code> wraps the same Glove: speech in, speech out, barge-in. <Link href="/docs/voice">Voice pipeline</Link>.</td></tr>
          <tr><td>Realtime speech or an avatar</td><td><code>RealtimeAgent</code> runs the same tools on OpenAI Realtime, Gemini Live or GPT-Live. <Link href="/docs/realtime-voice">Realtime voice</Link>.</td></tr>
          <tr><td>Any OpenAI SDK, Slack, email</td><td>Foundry&apos;s APIs and transmissions, in <Link href="/docs/build/system">step 7</Link>.</td></tr>
        </tbody>
      </table>

      <h2 id="already-built">Already built for you</h2>
      <AlreadyBuilt parts={["surface"]} />

      <h2 id="next">Next</h2>
      <p>
        The assistant can show notes and ask before publishing. But it only knows what
        is in the conversation. In <Link href="/docs/build/context">step 3</Link> we
        control what it sees on every call: the release in progress, the team&apos;s
        conventions, and a plan it keeps up to date.
      </p>
      <StepPath href={HREF} />
    </article>
  );
}
