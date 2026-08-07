import { CodeBlock } from "@/components/code-block";
import { BlogPostHeader } from "@/components/blog-post-header";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("eight-new-packages")!;

export const metadata = postMetadata(post);

export default async function Post() {
  return (
    <div className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        Realtime voice and avatars, agentic image generation, a working
        environment that can look at what it made, and memory that knows what to
        withhold. Eight packages landed this week. Here is what each one is for.
      </p>

      <p>
        There is a shape to this release that only became obvious once it was
        finished. Almost everything in it gives an agent a <em>faculty</em> it
        did not have: a voice that answers in real time, a face, eyes to check
        its own output, hands to produce media, and judgement about what to keep
        to itself. Individually they are separate packages. Together they are
        the difference between an agent that returns text and one that does the
        work.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="voice">A voice, and a face to put it on</h2>

      <p>
        Glove has had a voice pipeline for a while — the cascade:{" "}
        <em>speech → text → agent → text → speech</em>. It works, and its
        latency is the sum of its parts. Realtime speech-to-speech models
        collapse that stack: the model listens and speaks directly, and turn
        taking is decided by something that can actually hear the caller.
      </p>

      <p>
        <a href="/docs/realtime-voice">
          <code>glove-voice-s2s</code>
        </a>{" "}
        runs an ordinary Glove agent on those models — OpenAI Realtime and
        Gemini Live. The agent definition does not change. Your tools, your
        display stack, your context management all still apply; only the
        transport underneath is different.
      </p>

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`const agent = new Glove({
  store,
  // The model slot carries the realtime config, so the agent definition
  // stays the single source of truth and RealtimeAgent derives the session.
  model: s2sDrivenModel({
    provider: "openai",
    turnDetection: { type: "server_vad", silence_duration_ms: 450 },
  }),
  displayManager: new Displaymanager(),
  systemPrompt: "...",
}).fold(bookTableTool);

const rt = new RealtimeAgent({ agent });
await rt.start();`}
      />

      <p>
        Two details in there took the longest and matter the most. Turn-taking
        knobs are <strong>typed</strong> rather than raw JSON, because
        silence thresholds are the difference between an agent that interrupts
        people and one that feels patient. And barge-in does{" "}
        <strong>truncation sync</strong> — when a caller cuts the agent off, the
        model is told what the caller actually <em>heard</em>, not what it had
        planned to say. Without that, the agent carries on as though it
        delivered a sentence that nobody received.
      </p>

      <p>
        <a href="/docs/realtime-voice">
          <code>glove-voice-avatar</code>
        </a>{" "}
        puts a face over that audio — an <code>AvatarAdapter</code> contract
        with a conformance suite, plus working Tavus and Anam adapters. And{" "}
        <code>glove-voice-livekit</code> replaces the hand-rolled audio duct
        with WebRTC in both directions: the browser side shrinks to{" "}
        <code>Room.connect</code> plus a microphone toggle, and barge-in becomes
        a server-authoritative buffer flush instead of a client-side race.
      </p>

      <div className="blog-note">
        <strong>Why three packages and not one.</strong> Each layer is useful
        without the ones above it. A phone agent needs S2S and no avatar. A
        kiosk needs an avatar but not LiveKit. Fusing them would force every
        adopter to carry all three vendors&apos; dependencies to use any of
        them.
      </div>

      {/* ---------------------------------------------------------------- */}
      <h2 id="environment">The working environment grew a body</h2>

      <p>
        The{" "}
        <a href="/docs/working-environment">working environment</a> is a
        sandboxed filesystem an agent writes scripts against, instead of calling
        a fixed menu of tools. This week it gained five capability adapters, and
        one verb that changes what it can be trusted with.
      </p>

      <table>
        <thead>
          <tr>
            <th>Adapter</th>
            <th>What it gives the agent</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>env:media</code>
            </td>
            <td>
              ffmpeg — describe a video without decoding it, thumbnail, clip,
              concat, transcode, extract frames
            </td>
          </tr>
          <tr>
            <td>
              <code>env:slides</code>
            </td>
            <td>
              Build PowerPoint decks from a spec, and read decks back as text
              and outlines
            </td>
          </tr>
          <tr>
            <td>
              <code>env:archives</code>
            </td>
            <td>
              zip / tar / tar.gz both directions, with traversal- and bomb-safe
              extraction. No dependencies
            </td>
          </tr>
          <tr>
            <td>
              <code>env:render</code>
            </td>
            <td>
              Rasterize PDFs, decks, Word files and images to page PNGs — inside
              the sandbox
            </td>
          </tr>
          <tr>
            <td>
              <code>env:motion</code>
            </td>
            <td>
              Render React scenes — including Reanimated — to deterministic
              frames, stills and video
            </td>
          </tr>
        </tbody>
      </table>

      <h3>The verb that matters: the agent can look</h3>

      <p>
        Everything above produces artifacts an agent could previously only
        reason about indirectly. It could build a slide deck and describe its
        own XML back to itself, and be entirely wrong about what the deck{" "}
        <em>looked like</em>. A table running off the page, a chart with no
        bars, a title overlapping a figure — none of those are visible in the
        markup.
      </p>

      <p>
        <code>view_image(path, prompt, page?)</code> closes that loop. Paired
        with <code>env:render</code>, the agent rasterizes what it made and
        actually looks at it. It is the only verb in the environment that
        catches a <em>visual</em> defect, and it is the difference between
        &ldquo;the file was written&rdquo; and &ldquo;the deliverable is
        correct&rdquo;.
      </p>

      <p>
        Alongside it, three quieter additions with real consequences:{" "}
        <code>readOnlyPaths</code> gives the agent directories it may read but
        never edit; <code>cachedRemote</code> backs the tree with object storage
        so a session survives the process; and{" "}
        <strong>pure modules</strong> expose synchronous libraries{" "}
        <em>synchronously</em>. That last one is subtler than it sounds — a
        missed <code>await</code> on a promise is silent garbage, so a
        synchronous library reached through an async binding fails in a way that
        still reports success.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="images">Images became a workflow</h2>

      <p>
        <a href="/docs/image">
          <code>glove-image</code>
        </a>{" "}
        is the newest package and the biggest conceptual shift in the release. A
        hand-rolled <code>generate_image(prompt)</code> tool works exactly once.
        The moment images are a repeated job, four things break: prompts are{" "}
        <em>built</em> rather than typed, recurring subjects drift between
        turns, settings need to stay consistent, and existing images have to
        come back in as inputs.
      </p>

      <p>So each of those became a primitive:</p>

      <ul>
        <li>
          <strong>A prompt pipeline.</strong> An intent runs through ordered{" "}
          <em>inbetweens</em> — character and scene expansion, style, an LLM
          rewrite — and a terminal stage that reconciles the request against
          what the model actually supports. Every degradation it forces is
          written into a trace and handed back, so nothing is silently changed.
        </li>
        <li>
          <strong>Characters and scenes.</strong> Durable identities whose
          wording is spliced into every prompt <em>verbatim</em>. Consistency
          comes from repetition, not from the model remembering.
        </li>
        <li>
          <strong>Lineage.</strong> Every derived image records how it was made,
          so &ldquo;same, but at dusk&rdquo; is one call that replays the recipe.
        </li>
        <li>
          <strong>Cost.</strong> Every model-touching call is metered — per
          call, per image, per session — in real dollars where the provider
          reports them.
        </li>
      </ul>

      <p>
        The <a href="/docs/image/gallery">gallery</a> is the honest version of
        this claim: a campaign shot in one scripted run, every frame shown with
        the prompt that produced it and what it cost, plus a canvas that draws
        one image&apos;s real provenance from its recorded recipe rather than
        from a diagram someone drew.
      </p>

      <div className="blog-note">
        <strong>Where it stops working.</strong> These are generative
        approximations. Woven, textile and craft goods hold up well; a product
        carrying an exact logo, a precise colourway or fine hardware detail will
        not reproduce faithfully, even with its own packshot pinned as a
        reference. That belongs in the docs as much as the capability does.
      </div>

      {/* ---------------------------------------------------------------- */}
      <h2 id="memory">Memory learned what to withhold</h2>

      <p>
        <a href="/docs/memory">
          <code>glove-memory</code>
        </a>{" "}
        gained three things that are all really the same thing: control over
        exposure.
      </p>

      <p>
        <strong>Tool allowlists</strong> let a memory-backed agent be given a
        slice of the surface rather than all of it.{" "}
        <strong>Resource access control</strong> gates the resource filesystem
        by path, so a subagent can be handed a subtree instead of the tree. And{" "}
        <strong>layered memory</strong> merges a shared stratum and a private
        one into a single view — a team knowledge base underneath, a
        user&apos;s own memory on top, one coherent read.
      </p>

      <p>
        Forms moved in the same direction: a trigger can now route on{" "}
        <em>state</em> rather than only on values, and can send a conversation
        back to a step it already completed — or stop collection outright when
        carrying on would be wrong rather than merely unfinished.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="docs">And the docs were rebuilt</h2>

      <p>
        Eight new packages is also eight new ways to be lost. The documentation
        was restructured around what you are trying to <em>do</em> rather than
        which package does it, every package got covered, and two
        machine-readable surfaces landed:{" "}
        <a href="/llms.txt">
          <code>llms.txt</code>
        </a>{" "}
        as an index and <code>llms-full.txt</code> as a condensed reference.
      </p>

      <p>
        That second one is not a novelty. Most Glove code is now written with a
        model in the loop, and a model that has to guess an API writes plausible
        code that does not run. Giving it the real surface is cheaper than
        debugging the invention.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="whats-next">What is next</h2>

      <p>
        The obvious gap in generative media is video — the image package is
        deliberately scoped to stills, and <code>env:motion</code> already
        handles the deterministic side of rendering. For images specifically:
        React renderers and a candidate picker, direct OpenAI and Gemini
        adapters, and bridges into the scratchpad and the working environment.
      </p>

      <p>
        Everything here is MIT and on{" "}
        <a href="https://github.com/porkytheblack/glove">GitHub</a>. If you build
        something with it, we would like to see it.
      </p>
    </div>
  );
}
