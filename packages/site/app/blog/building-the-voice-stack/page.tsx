import { CodeBlock } from "@/components/code-block";
import { BlogPostHeader } from "@/components/blog-post-header";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("building-the-voice-stack")!;

export const metadata = postMetadata(post);

export default async function Post() {
  return (
    <div className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        The release post said what shipped. This one is the working notes: five
        preserved examples, three avatar integrations, and a run of bugs that
        every test suite passed straight through. The decisions that held, and
        the ones the wire corrected.
      </p>

      <p>
        Realtime voice is unusually punishing to build because the failure mode
        is <em>silence</em>. A REST integration that is wrong throws. A voice
        session that is wrong connects, streams your microphone at a provider,
        and returns nothing — with every green check still green. Almost
        everything below follows from that one property.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="layering">The decision that shaped everything: two models, not one</h2>

      <p>
        The obvious way to build a voice agent is to point a realtime model at
        your tools and let it work. We tried that first and it is wrong for any
        agent that has to be <em>correct</em>. Realtime models are tuned for
        conversational latency, not for reasoning over a database, and the
        moment one is asked to do both it either stalls mid-sentence or invents
        an answer confidently.
      </p>

      <p>
        So the front agent is deliberately <strong>thin</strong>: it owns the
        conversation, the voice, and the turn-taking, and it knows almost
        nothing. Anything requiring real work is delegated over{" "}
        <a href="/docs/mesh">
          <code>glove-mesh</code>
        </a>{" "}
        to a capable worker model running as a separate job, whose answer is
        injected back into the live session when it lands.
      </p>

      <CodeBlock
        filename="room-signal.ts"
        language="typescript"
        code={`// The front agent talks. The worker knows things.
const front = buildS2SFrontAgent(store, s2sConfig);
await mountMesh(front, { adapter: meshAdapter, identity: FRONT_IDENTITY });

const rt = new RealtimeAgent({ agent: front });

// …and when the worker replies, it arrives mid-conversation:
rt.inject(\`<worker-result>\${message.content}</worker-result>\`, { respond: true });`}
      />

      <p>
        The prompt rule that makes it work is blunt: <em>never invent a number;
        if a lookup is pending, say you are still checking.</em> A thin agent
        that admits it is waiting is better company than a capable one that
        guesses. This split also means the expensive model is only paying for
        the turns that need it.
      </p>

      <div className="blog-note">
        <strong>Rooms are jobs.</strong> Each call runs as a{" "}
        <a href="https://github.com/porkytheblack/station">station</a> signal
        run — so a conversation has a lifecycle, logs, a duration and an
        outcome, and the delegation it triggered is visible as its own run
        beside it. Debugging a live call becomes reading a job, not tailing a
        process.
      </div>

      {/* ---------------------------------------------------------------- */}
      <h2 id="config">Configuration belongs on the model slot</h2>

      <p>
        An early version wired the realtime session separately from the agent:
        build the agent, then build an adapter, then keep them in sync by hand.
        Every drift between them was a silent behaviour change. The fix was to
        make the <em>model slot itself</em> carry the realtime configuration, so
        the agent definition stays the single source of truth and{" "}
        <code>RealtimeAgent</code> derives the session from it.
      </p>

      <p>
        The same instinct produced <strong>typed turn-taking knobs</strong>{" "}
        rather than a passthrough JSON blob. These values decide whether your
        agent feels patient or feels like it talks over people, and they are
        static per provider — exactly the thing a type should catch. A typo in a
        raw blob is not an error, it is a personality change you find out about
        from a user.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="avatars">Avatars are a rendering layer, not a pipeline</h2>

      <p>
        Every avatar vendor wants to sell you the whole stack — perception, an
        LLM, a voice, a face. We use exactly one quarter of that. The agent
        stays the brain, the realtime model stays the voice, and the avatar is
        handed finished PCM to lip-sync. Providers call this{" "}
        <em>echo</em> or <em>passthrough</em> mode, and it is the only mode that
        preserves the layering.
      </p>

      <p>
        That yields one contract — <code>AvatarAdapter</code>: connect and get a{" "}
        <code>view</code> a client can attach to, feed it audio, end the
        utterance, interrupt. Interruption is conformance-enforced to be safe at
        any time, including when nothing is playing, because the voice side
        treats every user speech-start as a potential barge-in and the face must
        follow the voice without asking questions.
      </p>

      <p>
        The reward for the contract came later: the second provider, and then
        the same providers over a different transport, were all{" "}
        <code>attachAvatar(rt, avatar)</code> and done.
      </p>

      <h3>The courier pattern, discovered twice</h3>

      <p>
        Both avatar vendors turned out to hide the same structural surprise, in
        different places. Tavus interaction events travel{" "}
        <strong>only</strong> over the Daily data channel — there is no REST
        endpoint, no matter what an eager reading of the docs suggests. Anam&apos;s
        passthrough audio input lives <strong>only</strong> on the browser SDK —
        there is no server-side audio API at all.
      </p>

      <p>
        In both cases the server has the audio and no way to deliver it. Rather
        than smuggle a media client into the room process, both adapters make
        the gap explicit: a required <code>sendInteraction</code> /{" "}
        <code>sendCommand</code> function the host supplies, which ferries
        frames to whoever <em>is</em> joined — in our examples, the browser
        already on the call.
      </p>

      <CodeBlock
        filename="avatar.ts"
        language="typescript"
        code={`// Required, not optional — the transport genuinely does not exist
// server-side, and pretending otherwise fails at runtime instead of here.
const avatar = new AnamPassthroughAdapter({
  apiKey, avatarId,
  sendCommand: (command) => duct.send({ t: "avatar_command", command }),
});`}
      />

      <p>
        Making it a required constructor argument was deliberate. An optional
        courier with a plausible-looking default would have produced an adapter
        that connects, reports healthy, and never renders a frame.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="livekit">LiveKit is pipes, not a face vendor</h2>

      <p>
        Worth stating plainly because it is the most natural wrong assumption:
        adding LiveKit does <em>not</em> remove the need for a Tavus or Anam
        key. LiveKit has no avatars of its own. What its ecosystem standardises
        is the <em>wire</em> — a published protocol by which the provider&apos;s
        renderer joins your room as an ordinary participant and reads agent
        audio off a byte stream.
      </p>

      <p>
        So the trade is not fewer vendors, it is <strong>one transport you own
        instead of one bespoke surface per vendor</strong>. Concretely, in our
        examples: the browser hook went from about 500 lines to about 250 —
        audio worklets, a playback ring buffer, a local VAD reflex and a
        pause/resume/clear protocol all deleted, because WebRTC already does
        that. Barge-in became server-authoritative: the room flushes its own
        outbound queue, so there is no client buffer to chase.
      </p>

      <div className="blog-note">
        <strong>The tell that a design is right.</strong> If LiveKit
        <em>had</em> removed the provider key, that would have meant it was
        reselling the rendering — a fact worth knowing before building on it.
        Costs that vanish under a new abstraction usually moved rather than
        disappeared.
      </div>

      {/* ---------------------------------------------------------------- */}
      <h2 id="live">The bugs only live calls found</h2>

      <p>
        Every one of these shipped with a passing test suite. They are grouped
        because the pattern matters more than any single fix.
      </p>

      <h3>A second voice at the open</h3>

      <p>
        The first Tavus call greeted the caller in a stranger&apos;s voice before
        switching to ours. Suppressing the greeting parameter did not fix it:
        the greeting was configured on the <em>persona</em>, and conversation
        parameters do not override persona defaults. The fix is to stop reusing
        a dashboard-made persona and have the adapter ensure a{" "}
        <strong>minimal</strong> one — echo mode, no greeting, no TTS layer —
        reused by name. Both LiveKit&apos;s and Pipecat&apos;s integrations do
        the same thing, which was the hint that we were fighting the platform
        rather than a bug.
      </p>

      <h3>A face that went dark mid-conversation</h3>

      <p>
        Anam sessions kept dying a few minutes in. The first fix — raising every
        timeout the API exposes — was wrong, and the give-away was that it
        didn&apos;t work: the real limit is a <em>plan</em> cap that force-ends
        conversations regardless of session configuration. Once that is true,
        the cap is routine rather than exceptional, and the correct handling is
        renewal, not prevention: the session ends, the host mints a new one, the
        client re-attaches, and the face blinks instead of dying.
      </p>

      <h3>An adapter that could not hear</h3>

      <p>
        The Gemini path connected, streamed microphone audio, and returned
        nothing at all. Gemini delivers its JSON over <strong>binary</strong>{" "}
        WebSocket frames; the adapter parsed them with{" "}
        <code>String(raw)</code>, which for a Blob is the literal text{" "}
        <code>&quot;[object Blob]&quot;</code>. Every inbound message was
        dropped, forever, silently.
      </p>

      <p>
        The conformance suite missed it because the fake socket fired{" "}
        <em>strings</em>. That is the whole lesson: a test double that is more
        convenient than the real wire tests your convenience. The fake now emits
        binary frames like the endpoint does, which turns the entire existing
        suite into a regression test for that class of bug.
      </p>

      <h3>One JSON Schema key that killed every session</h3>

      <p>
        Then it still did not work. Gemini&apos;s schema type is an OpenAPI 3.0
        subset, not JSON Schema, and it rejects the <em>entire session</em> over
        a single unrecognised key. Zod&apos;s <code>toJSONSchema()</code> — which
        every Glove tool passes through — emits <code>$schema</code> and{" "}
        <code>additionalProperties</code> by default. Any agent with tools could
        never open a Gemini session.
      </p>

      <p>
        The sanitizer that fixes it uses an <strong>allowlist</strong> of
        supported keys rather than a blocklist of known-bad ones, deliberately:
        a blocklist would have to be updated every time Zod learns a new
        keyword, and the failure mode of being out of date is the voice
        disappearing.
      </p>

      <h3>A hardcoded API version</h3>

      <p>
        And then the model itself was &quot;not found&quot; — except the model
        id was correct. The WebSocket URL pinned <code>v1beta</code>, and newer
        preview models land on <code>v1alpha</code> first. That error message
        has three indistinguishable causes (wrong id, wrong version, no access
        on the key), so alongside making the version configurable we added a
        lookup that asks the provider which models <em>this</em> key can
        actually open a session with, and prints the environment lines to paste.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="diagnostics">The lesson under all of them: swallowed errors</h2>

      <p>
        Four of those bugs were quick to fix and slow to find, for one shared
        reason. The adapter&apos;s close handler looked like this:
      </p>

      <CodeBlock
        language="typescript"
        code={`ws.addEventListener("close", () => {
  this.connected = false;
  this.emit("disconnected");
});`}
      />

      <p>
        The provider was explaining itself the entire time —{" "}
        <code>1007: Unknown name &quot;$schema&quot; at
        &apos;setup.tools[0]…&apos;</code> — and we were dropping it on the
        floor and reporting a tidy disconnect. Once the close code and reason
        were surfaced as errors, the next two bugs were diagnosed from a single
        log line each.
      </p>

      <p>
        Error plumbing is not hygiene work you get to after the feature. In a
        stack whose failure mode is silence, the diagnostics <em>are</em> the
        feature — they are what converts &quot;it doesn&apos;t work&quot; into a
        specific, fixable claim.
      </p>

      <p>
        The same reasoning produced a <code>probe</code> script in the example:
        it drives the real agent with its real tools through the real code path,
        minus the microphone, and prints either working audio or the
        provider&apos;s own complaint. Voice bugs are expensive to reproduce by
        talking to a browser; a five-second command that returns the truth is
        worth more than the hour it saves each time.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="conformance">What a conformance suite can and cannot prove</h2>

      <p>
        Every adapter family in this stack ships a behavioural suite that runs
        against fakes with no credentials — and the honest framing, repeated in
        every README, is that <strong>passing proves the adapter is wired
        correctly against its own reading of the protocol</strong>. Only a live
        call proves the reading.
      </p>

      <p>
        This session was an extended demonstration. The suites were genuinely
        valuable: they caught an utterance-boundary race where audio chunks
        merged into one stream, and they made the second and third providers
        cheap to add. They were also, simultaneously, entirely green while the
        Gemini path could not hear, could not open a session with tools, and
        pointed at the wrong API version.
      </p>

      <p>
        So the seams that let a suite run credential-free — an injectable{" "}
        <code>fetch</code>, an injectable socket, an injectable courier — are
        the same seams that let a fake drift from reality. Keep them, and keep
        the fake shaped like the wire: binary where the wire is binary, strict
        where the provider is strict.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="examples">Five examples, none of them replaced</h2>

      <p>
        Each step is preserved as its own runnable example rather than an
        upgrade of the previous one, with ports shifted so they run side by
        side. The instinct to keep them came from the person testing them:
        being able to return to the last thing that worked is worth more than a
        tidy repository.
      </p>

      <table>
        <thead>
          <tr>
            <th>Example</th>
            <th>Pipeline</th>
            <th>Transport</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>layered-voice</code>
            </td>
            <td>Cascade (VAD → STT → LLM → TTS)</td>
            <td>Browser-hosted</td>
          </tr>
          <tr>
            <td>
              <code>server-voice</code>
            </td>
            <td>Cascade</td>
            <td>Server rooms, WebSocket audio duct</td>
          </tr>
          <tr>
            <td>
              <code>s2s-rooms</code>
            </td>
            <td>Speech-to-speech</td>
            <td>Server rooms, WebSocket duct</td>
          </tr>
          <tr>
            <td>
              <code>avatar-rooms</code>
            </td>
            <td>Speech-to-speech + a face</td>
            <td>Duct up, provider session down</td>
          </tr>
          <tr>
            <td>
              <code>livekit-rooms</code>
            </td>
            <td>Speech-to-speech (+ optional face)</td>
            <td>LiveKit, both directions</td>
          </tr>
        </tbody>
      </table>

      <p>
        They are the same starship dealership throughout — a salesperson who
        knows nothing about ships and a worker who knows everything, so the
        delegation is visible in the conversation rather than buried in a
        latency graph. Reading them in order is the fastest way to see what each
        transport actually costs and buys.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="takeaways">If you are building on this</h2>

      <ul>
        <li>
          <strong>Split the models.</strong> A thin conversational front and a
          capable worker beats one model doing both, on latency and on being
          right.
        </li>
        <li>
          <strong>Surface the provider&apos;s own words.</strong> Close codes
          and reasons, verbatim. In a stack that fails silently, this is the
          highest-leverage code you will write.
        </li>
        <li>
          <strong>Shape fakes like the wire.</strong> Binary if it is binary,
          strict if it is strict. A convenient double tests your convenience.
        </li>
        <li>
          <strong>Allowlist when a provider validates strictly.</strong> A
          blocklist is a promise to keep updating it, and the penalty for
          falling behind is total failure.
        </li>
        <li>
          <strong>Make impossible transports explicit.</strong> If the server
          cannot deliver the frames, a required courier argument beats an
          optional one with a default that silently does nothing.
        </li>
        <li>
          <strong>Ship a probe.</strong> One command that exercises the real
          path and prints the truth ends the &quot;it doesn&apos;t work&quot;
          loop.
        </li>
      </ul>

      <p>
        The packages are{" "}
        <a href="/docs/realtime-voice">
          <code>glove-voice-s2s</code>, <code>glove-voice-avatar</code> and{" "}
          <code>glove-voice-livekit</code>
        </a>
        , and the examples are in the{" "}
        <a href="https://github.com/porkytheblack/glove/tree/main/examples">
          repository
        </a>
        . All MIT.
      </p>
    </div>
  );
}
