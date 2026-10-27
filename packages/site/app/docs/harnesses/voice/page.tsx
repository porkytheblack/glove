import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint, HarnessDiagram } from "@/components/diagrams";
import { docsMetadata } from "@/lib/docs-nav";

export const metadata = docsMetadata("/docs/harnesses/voice");

export default function VoiceHarnessPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Harness blueprint</span>
      <h1>Voice agent</h1>
      <p className="blog-lede">
        A voice harness has one hard constraint: silence is a bug. Whatever the agent is doing,
        it has to answer within a breath. That puts the weight on the surface (speech in and out,
        barge-in, turn-taking) and on the team: a fast front agent that talks, and a heavier
        worker that does the tool work behind it. Durable work, the kind that should survive the
        call, goes to a Foundry instance.
      </p>

      <Blueprint
        uses={[
          "Agent loop",
          "Model adapters",
          "Abort and un-abortable tools",
          "Subscribers",
          "Tools",
          "Runtime context providers",
          "Store",
          "Forms",
          "Voice pipeline",
          "Realtime speech and avatars",
          "Mesh",
          "Instances",
          "Conversations",
          "Voice calls",
          "Foundry mesh",
          "Inspector and WebChat",
        ]}
        write={[
          "The front agent's spoken persona (short, plain sentences, no markdown)",
          "The worker's tools over your data",
          "Plain Glove only: the host that wakes the worker when a delegation lands in its inbox",
          "Audio plumbing your platform needs: a browser page, a LiveKit room or a phone bridge",
        ]}
      />

      <h2 id="how-it-fits">How it fits together</h2>
      <p>
        Pick the front first. A <strong>pipeline</strong> (<code>glove-voice</code>) runs VAD,
        speech-to-text, the Glove agent and text-to-speech, with barge-in and push-to-talk; any
        chat model can be the agent. A <strong>realtime</strong> model (
        <code>glove-voice-s2s</code>: OpenAI Realtime, Gemini Live, GPT-Live) owns turn-taking
        itself, and <code>RealtimeAgent</code> hands it the same Glove tools. Either way the
        tools are written once.
      </p>
      <p>
        A caller asks for something that needs real work: &ldquo;what&apos;s the warranty on hull
        KES-0007?&rdquo;. The front agent has almost no tools. In the same turn it says &ldquo;one
        sec, let me pull that up&rdquo; and calls <code>glove_mesh_send_message</code> to the worker
        with <code>blocking: true</code>. The message lands in the worker&apos;s inbox as a resolved
        item; the host sees it and runs the worker, which researches with its tools and replies
        with <code>in_reply_to</code> set. The reply lands in the front agent&apos;s inbox, which
        Glove injects on its next turn, and the front relays it out loud. While the request is
        pending, the blocking item keeps the front from inventing an answer.
      </p>
      <p>
        App state the caller should not have to repeat (who is calling, what is on screen, the
        order status) reaches the voice model through runtime context. A realtime session gets
        changed snapshots silently at start and after each tool; call{" "}
        <code>refreshContext()</code> when something changes outside a tool. Forms work the same
        over speech as over text, so collecting a delivery address is a form, not a prompt.
      </p>
      <HarnessDiagram
        highlight="team"
        caption="The voice front is a harness with a team: it hands real work to a worker over mesh, and the worker's reply comes back through the front's inbox on its next turn."
      />

      <h2 id="skeleton-layered">Skeleton: a fast front and a worker</h2>
      <p>
        Adapted from{" "}
        <a href="https://github.com/porkytheblack/glove/tree/main/examples/layered-voice">
          examples/layered-voice
        </a>
        , which adds speaker labels, a <code>&lt;speech&gt;</code> tag protocol (only text inside
        the tags is spoken) and ElevenLabs streaming.
      </p>
      <CodeBlock
        filename="layered.ts"
        language="typescript"
        code={`import { Displaymanager, Glove, MemoryStore, createAdapter } from "glove-core";
import { InMemoryMeshAdapter, MeshNetwork, mountMesh } from "glove-mesh";
import { workerTools } from "./tools.js"; // your code: the data the worker can reach

const network = new MeshNetwork(); // in-process; use a transport-backed MeshAdapter across processes

const front = new Glove({
  store: new MemoryStore("front"), // inbox-capable: mesh messages land here
  model: createAdapter({ provider: "openrouter", model: "google/gemini-2.5-flash" }), // small and fast
  displayManager: new Displaymanager(),
  systemPrompt: \`You are the voice at the front desk. Speak in one or two short sentences.
You cannot look anything up. For any lookup, call glove_mesh_send_message
to "worker" with blocking: true, and say a short acknowledgement in the same turn.\`,
  serverMode: true,
  compaction_config: { compaction_instructions: "Keep who is calling and what is pending." },
}).build();

const worker = new Glove({
  store: new MemoryStore("worker"),
  model: createAdapter({ provider: "anthropic", model: "claude-sonnet-5-5" }), // heavier
  displayManager: new Displaymanager(),
  systemPrompt: "Handle each delegated request with your tools, then reply to \\"front\\" with in_reply_to set. Never just acknowledge.",
  serverMode: true,
  compaction_config: { compaction_instructions: "Keep open requests and findings." },
});
for (const tool of workerTools) worker.fold(tool);
const backOffice = worker.build();

await mountMesh(front, {
  adapter: new InMemoryMeshAdapter(network, "front"),
  identity: { id: "front", name: "Voice front", description: "Talks to the caller", capabilities: ["voice"] },
});
await mountMesh(backOffice, {
  adapter: new InMemoryMeshAdapter(network, "worker"),
  identity: { id: "worker", name: "Back office", description: "Looks things up and acts", capabilities: ["research"] },
});

// The host wakes the worker when a delegation arrives, and the front when the reply does.
export async function onUtterance(text: string) {
  await front.processRequest(text); // your voice front streams its text to TTS
  const pending = (await backOffice.store.getInboxItems?.()) ?? [];
  if (pending.some((item) => item.status === "resolved" && item.tag.startsWith("mesh:from:"))) {
    await backOffice.processRequest("You have new delegated requests in your inbox.");
    await front.processRequest("[The worker replied. Relay it.]"); // the reply is injected from the inbox
  }
}`}
      />

      <h2 id="skeleton-realtime">Skeleton: a voice agent in Foundry</h2>
      <p>
        In Foundry the call is a run. <code>voiceCall</code> hosts the realtime session over
        the assembled agent and saves the transcript. With <code>mesh: true</code> the front
        messages the caller&apos;s other agents by instance id, and their replies are spoken at
        the next pause. The front stays a fast talker; the work goes to agents that can take
        their time, ask a question back, and use tools a call should not.
      </p>
      <CodeBlock
        filename="agents/concierge/agent.ts"
        language="typescript"
        code={`import { defineAgent } from "glove-foundry";
import { voiceCall, webSocketRoom } from "glove-foundry/voice";
import { s2sDrivenModel } from "glove-voice-s2s";
import { FileStore } from "../../lib/file-store.js";
import { conciergePrompt } from "./prompt.js";
import { roomFor } from "./room.js";

export default defineAgent({
  description: "Answers the phone and hands longer work to the back office",
  model: () => s2sDrivenModel({ label: "concierge", provider: "openai", voice: "marin" }),
  systemPrompt: conciergePrompt,
  store: ({ conversationId }) => FileStore.open(conversationId),
  mesh: true, // message the other agents in this workspace by id
  run: voiceCall({
    room: (context) => webSocketRoom(roomFor(context)),   // { port, token } from the request
    greeting: "Greet the caller in one short sentence.",
  }),
});`}
      />
      <CodeBlock
        filename="when a customer signs up"
        language="typescript"
        code={`// The agents are data: one workspace per customer, so they only see each other.
await foundry.createAgent("concierge", { id: "acme", workspaceId: "acme", name: "Concierge" });
await foundry.createAgent("bookings", {
  id: "acme-bookings", workspaceId: "acme", name: "Bookings",
  description: "Books tables and travel. Takes a few minutes.",
});`}
      />
      <p>
        The concierge finds Bookings with <code>glove_mesh_list_agents</code> and sends it the
        job with <code>glove_mesh_send_message</code>. Bookings is an ordinary agent with{" "}
        <code>mesh</code> set. If it needs to know something (indoors or outside?), its
        message comes back into the call, where the concierge answers from what it knows or
        asks the caller. Its runs show up in the inspector and can be approved or steered,
        and a reply that lands after the caller hangs up waits in the conversation. LiveKit
        rooms and phone bridges plug in as <Link href="/foundry/docs/voice#rooms">rooms</Link>.
        The pattern is <Link href="/foundry/docs/layered-agents">layered agents</Link>; the
        full version, with personal memory and a text chat on the same agent, is{" "}
        <code>examples/foundry-layered-assistant</code>.
      </p>

      <h2 id="dont-build">What not to build</h2>
      <ul>
        <li>
          <strong>A second implementation of your tools for the realtime provider.</strong>{" "}
          <Link href="/docs/realtime-voice"><code>RealtimeAgent</code></Link> reads the agent&apos;s
          registered tools and runs each call through the same <code>Tool.run</code>.
        </li>
        <li>
          <strong>Speech-to-text, agent and text-to-speech glue.</strong> The{" "}
          <Link href="/docs/voice">voice pipeline</Link> handles VAD, turn commits, barge-in and
          push-to-talk, in the browser and on React Native.
        </li>
        <li>
          <strong>A message bus between the voice agent and the worker.</strong>{" "}
          <Link href="/docs/mesh">Mesh</Link> delivers through each agent&apos;s inbox, and a
          blocking send keeps the front from answering before the worker does.
        </li>
        <li>
          <strong>Rewriting the session instructions every time app state changes.</strong>{" "}
          <Link href="/docs/build/context">Runtime context</Link> is refreshed silently without a
          reply and without growing the prompt.
        </li>
        <li>
          <strong>A job tracker for work started on a call.</strong> A Foundry{" "}
          <Link href="/foundry/docs/runtime#run-handle">run handle</Link> waits, streams, cancels and
          steers, and the run outlives the call.
        </li>
      </ul>

      <h2 id="deploy">Deploy on Kuiper</h2>
      <p>
        The durable half deploys like any Foundry app: one unit, its data on <code>/data</code>,
        a <code>requestAuthorization</code> adapter, models through the gateway. The voice host
        is where audio lives, so its shape depends on the platform:
      </p>
      <ul>
        <li>
          <strong>Browser voice</strong> (a pipeline or WebRTC realtime): a Next.js unit that serves
          the page and mints short-lived provider tokens (<code>createVoiceTokenHandler</code> from{" "}
          <code>glove-next</code>). Keep the provider keys as project secrets bound to that unit.
        </li>
        <li>
          <strong>Server-side voice</strong> (LiveKit rooms, phone bridges): a Node service unit that
          joins the room and runs <code>RealtimeAgent</code>.
        </li>
      </ul>
      <p>
        Either way the host reaches Foundry over the project&apos;s private network:{" "}
        <code>kuiper env set -u voice &apos;FOUNDRY_URL=${"{{"}concierge.INTERNAL_URL{"}}"}&apos;</code>.
        See <Link href="/foundry/docs/kuiper">Deploy on Kuiper</Link> and{" "}
        <a href="https://kuiper.sh/docs/foundry/#next-js-with-foundry">Next.js with Foundry</a>.
      </p>

      <h2 id="further">Go further</h2>
      <ul>
        <li>
          <Link href="/docs/voice-architectures">Voice agent architectures</Link>: pipeline versus
          realtime, single versus layered, and the <code>&lt;speech&gt;</code> protocol, measured.
        </li>
        <li>
          <a href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-braind-storm">
            examples/foundry-braind-storm
          </a>
          : a Gemini Live briefing line that launches durable Foundry workforces mid-call.
        </li>
        <li>
          Showcase: <Link href="/docs/showcase/coffee-shop">Coffee Shop</Link> and{" "}
          <Link href="/docs/showcase/lola">Lola</Link>, voice-first apps with tool-rendered UI.
        </li>
        <li>
          Build the parts one at a time: <Link href="/docs/build/surface">show your work</Link>,{" "}
          <Link href="/docs/build/team">split the work</Link>.
        </li>
        <li>
          Reference: <Link href="/docs/voice">Voice pipeline</Link>,{" "}
          <Link href="/docs/realtime-voice">Realtime voice &amp; avatars</Link>,{" "}
          <Link href="/docs/mesh">Mesh</Link>,{" "}
          <Link href="/foundry/docs/multi-agent#voice">Foundry voice hosts</Link>.
        </li>
      </ul>
    </article>
  );
}
