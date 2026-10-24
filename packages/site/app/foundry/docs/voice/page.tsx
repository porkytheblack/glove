import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { VoiceCallStory } from "@/components/foundry-stories";

export const metadata = {
  title: "Voice agents",
  description:
    "Run a Foundry agent as a live voice call with voiceCall: the same prompt, tools and memory as its text turns, a room for the audio, and replies from other agents on the mesh spoken at the next pause.",
};

export default function VoicePage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Design your system / Voice agents</span>
      <h1>Voice agents</h1>
      <p className="blog-lede">
        A voice agent is an ordinary definition with a speech model and{" "}
        <code>run: voiceCall(...)</code>. The call uses the same prompt, tools, memory and
        context as the agent&apos;s text turns, saves what both sides say, and stays quick
        because anything slow goes to <Link href="/foundry/docs/layered-agents">another agent</Link>{" "}
        over the mesh. When that agent replies mid-call, the reply is spoken at the next pause.
      </p>

      <VoiceCallStory />

      <h2 id="define">Define the call</h2>
      <p>
        The model is <code>s2sDrivenModel(...)</code> from <code>glove-voice-s2s</code>: a
        realtime provider drives the turns. <code>voiceCall</code> from{" "}
        <code>glove-foundry/voice</code> is the <code>run</code>. Give it a room, which is
        where the audio comes from and goes to:
      </p>
      <CodeBlock
        filename="agents/assistant/call.ts"
        language="typescript"
        code={`import type { AgentAssemblyContext } from "glove-foundry";
import { voiceCall, webSocketRoom } from "glove-foundry/voice";
import { z } from "zod";

/** How the app starts a call: the port the page will connect to, and a one-time token. */
export const callRequest = z.object({
  call: z.object({ port: z.number().int().min(1024).max(65_535), token: z.string().min(24) }),
});

export function isCall(context: Pick<AgentAssemblyContext, "request">): boolean {
  return callRequest.safeParse(context.request.payload).success;
}

export const call = voiceCall({
  room: (context) => {
    const { call: room } = callRequest.parse(context.request.payload);
    return webSocketRoom({ port: room.port, token: room.token, agentName: "Iris" });
  },
  greeting: "The person just called. Greet them in one short sentence, by name if you know it.",
});`}
      />
      <p>
        One agent can take both calls and chat. Pick the model and the run by the request,
        as the{" "}
        <a href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-layered-assistant">
          layered assistant
        </a>{" "}
        does:
      </p>
      <CodeBlock
        filename="agents/assistant/agent.ts"
        language="typescript"
        code={`model: (_agent, context) => (isCall(context) ? callModel() : interactorModel()),
systemPrompt: (_agent, context) => interactorPrompt(isCall(context)),
run: (agent, context) => (isCall(context) ? call(agent, context) : context.defaultRun()),

// lib/models.ts
export function callModel(): ModelAdapter {
  return s2sDrivenModel({ label: "assistant-call", provider: "openai", voice: "marin" });
}`}
      />
      <p>Start a call from your app by sending a message whose payload names the room:</p>
      <CodeBlock
        filename="app/api/calls/route.ts"
        language="typescript"
        code={`const token = randomBytes(24).toString("base64url");
await foundry.createConversation(personId, { id: \`\${personId}-call\` });
await foundry.send(personId, \`\${personId}-call\`, "call", { payload: { call: { port, token } } });
return Response.json({ url: \`ws://127.0.0.1:\${port}/call?token=\${token}\` });`}
      />

      <h2 id="what-runs">What the call runs</h2>
      <ul>
        <li>A <code>RealtimeAgent</code> over the assembled agent: its system prompt, its tools and its runtime context (memory, goals, open mesh threads), refreshed after every tool call.</li>
        <li>What the caller says and what the agent says are appended to the conversation&apos;s store, so the next text turn or call has the history.</li>
        <li>The greeting is sent once, when the first caller joins. Leave it out to wait for the caller to speak.</li>
        <li>The call ends when the room calls <code>end()</code>, nobody is connected for <code>idleMs</code> (2 minutes), <code>maxDurationMs</code> passes (30 minutes), or the run is cancelled.</li>
      </ul>

      <h2 id="tools">Which tools are on the call</h2>
      <p>
        A realtime session calls tools directly, mid-sentence. Two kinds don&apos;t belong
        there, so <code>voiceCall</code> keeps them off:
      </p>
      <ul>
        <li><strong>Foundry&apos;s bookkeeping tools</strong>: spawn, sleep, background, the workspace, shared inbox, tasks and environment tools. <code>glove_foundry_schedule</code> and the <code>glove_mesh_*</code> tools stay.</li>
        <li><strong>Any tool with <code>requiresPermission</code></strong>. The realtime path has no approval step, so the tool would run ungated. Send that work to another agent on the mesh, where it pauses on an <Link href="/foundry/docs/approvals">approval</Link> as usual.</li>
      </ul>
      <p>
        Add more with <code>realtime: {"{ excludeTools: [...] }"}</code>: anything that takes
        long enough to leave the caller in silence.
      </p>

      <h2 id="updates">Replies during and after the call</h2>
      <p>
        The call listens on its conversation, so replies and questions from other agents
        reach it directly instead of starting a new run. It holds each one until neither side
        is speaking (eight seconds at most), then tells the model, which tells the caller. A
        question is put the same way: the model answers from what it knows with{" "}
        <code>glove_mesh_send_message</code> and <code>in_reply_to</code>, or asks the caller
        first. The full message is also saved to the conversation. Change the wording with{" "}
        <code>announce: (message) =&gt; string | null</code>; the default is{" "}
        <code>announceMeshMessage</code>.
      </p>
      <p>
        When the caller has hung up, a message starts an ordinary run in that conversation
        with <code>source.kind</code> <code>&quot;mesh&quot;</code>. If your <code>run</code>{" "}
        sends it to <code>voiceCall</code>, the message is saved for the next turn; pass{" "}
        <code>offCall</code> to handle it another way. The layered assistant routes it to a
        text turn instead, so the reply is waiting in the chat.
      </p>

      <h2 id="rooms">Rooms</h2>
      <p>
        A room connects the session to callers: <code>{"{ open(call), close() }"}</code>. It
        feeds caller audio to <code>call.realtime</code>, plays the agent&apos;s audio, and calls{" "}
        <code>call.joined()</code> and <code>call.left()</code> as people come and go.
      </p>
      <h3 id="websocket-room"><code>webSocketRoom</code></h3>
      <p>
        One WebSocket per call, served by the run on its own port. A caller connects to{" "}
        <code>ws://host:port/call?token=…</code>; a wrong token is refused, and a new
        connection replaces the old one. <code>GET /health</code> says whether someone is
        connected.
      </p>
      <table>
        <thead><tr><th>Direction</th><th>Frames</th></tr></thead>
        <tbody>
          <tr><td>Page → room</td><td>Binary PCM16 mono at <code>sampleRate</code> (16 kHz); JSON <code>{"{ t: \"say\", text }"}</code> to type instead of speak; <code>{"{ t: \"barge_in\" }"}</code> to stop the agent.</td></tr>
          <tr><td>Room → page</td><td>Binary PCM16 of the agent&apos;s voice; JSON <code>ready</code>, <code>utterance</code>, <code>speech</code> / <code>speech_end</code> (live captions), <code>state</code>, <code>tool</code>, <code>clear</code> (stop playback) and <code>error</code>. Types: <code>VoiceRoomServerMessage</code>, <code>VoiceRoomClientMessage</code>.</td></tr>
        </tbody>
      </table>
      <p>
        The braind-storm example&apos;s{" "}
        <a href="https://github.com/porkytheblack/glove/blob/main/examples/foundry-braind-storm/app/lib/use-briefing-call.ts">
          <code>use-briefing-call.ts</code>
        </a>{" "}
        is a browser client for this protocol, with audio worklets for capture and playback.
      </p>
      <h3 id="livekit-room">A LiveKit room</h3>
      <p>
        <code>glove-voice-livekit</code> joins a LiveKit room from the run. The connection
        goes out from your server, so it works anywhere the run can reach LiveKit:
      </p>
      <CodeBlock
        filename="agents/assistant/livekit-room.ts"
        language="typescript"
        code={`import type { FoundryVoiceRoom } from "glove-foundry/voice";
import { LiveKitTransport, attachRealtime, mintParticipantToken } from "glove-voice-livekit";

export async function liveKitRoom(roomName: string): Promise<FoundryVoiceRoom> {
  const transport = new LiveKitTransport({
    url: process.env.LIVEKIT_URL!,
    token: await mintParticipantToken(
      { apiKey: process.env.LIVEKIT_API_KEY!, apiSecret: process.env.LIVEKIT_API_SECRET! },
      { roomName, identity: "agent" },
    ),
  });
  let detach = () => {};
  return {
    async open(call) {
      transport.on("participant_connected", () => call.joined());
      transport.on("participant_disconnected", () => call.left());
      await transport.connect();
      for (const _ of transport.room.remoteParticipants.values()) call.joined();
      detach = attachRealtime(call.realtime, transport);
    },
    async close() {
      detach();
      await transport.disconnect();
    },
  };
}

// call.ts
export const call = voiceCall({ room: (context) => liveKitRoom(roomNameFor(context)) });`}
      />

      <h2 id="options">Options</h2>
      <table>
        <thead><tr><th><code>voiceCall</code> option</th><th>Default / notes</th></tr></thead>
        <tbody>
          <tr><td><code>room</code></td><td>Required. A room, or <code>(context) =&gt; room</code> for one per call.</td></tr>
          <tr><td><code>greeting</code></td><td>None. Sent to the model once, when the first caller joins.</td></tr>
          <tr><td><code>idleMs</code></td><td>120 000. End after this long with nobody connected.</td></tr>
          <tr><td><code>maxDurationMs</code></td><td>1 800 000. End after this long in any case.</td></tr>
          <tr><td><code>openDelayMs</code></td><td>0. Wait after the session connects before opening the room; Gemini Live confirms its setup just after the socket opens, so 500 helps there.</td></tr>
          <tr><td><code>transcript</code></td><td><code>true</code>. Save both sides to the conversation&apos;s store.</td></tr>
          <tr><td><code>realtime</code></td><td>Passed to <code>RealtimeAgent</code>: <code>adapter</code>, <code>voice</code>, <code>instructions</code>, <code>excludeTools</code> (added to the defaults), <code>onToolCall</code>.</td></tr>
          <tr><td><code>announce</code></td><td>How a mesh message is put to the model. Return <code>null</code> to keep it silent.</td></tr>
          <tr><td><code>offCall</code></td><td>Handles a mesh message that arrives when no call is live. Default: save it to the conversation.</td></tr>
        </tbody>
      </table>
      <p>
        The run returns <code>{"{ endedBecause, durationMs, turns, updatesSpoken }"}</code>, and
        the trace shows <code>foundry.voice.call.open</code>, <code>caller.joined</code>,{" "}
        <code>caller.left</code>, <code>tool</code>, <code>updates.spoken</code> and{" "}
        <code>call.ended</code>.
      </p>

      <h2 id="deploy">Deploying</h2>
      <ul>
        <li><code>webSocketRoom</code> listens on its own port, separate from Foundry&apos;s. On a host with one public port, such as a <Link href="/foundry/docs/kuiper">Kuiper</Link> unit, put the room behind your own proxy or use a LiveKit room, which connects outward.</li>
        <li>A call holds a run, and one of <code>execution.maxConcurrent</code>&apos;s slots, for as long as it lasts. Size the limit for calls plus the workers they start.</li>
        <li>Provider keys stay on the server. Browsers only get the room&apos;s one-time token.</li>
      </ul>
    </article>
  );
}
