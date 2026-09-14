import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Video Workflows",
  description:
    "Agentic video generation for Glove — temporal prompt pipelines, continuity libraries, references, actual-video review, delivery gates, resumable flows, and spend tracking.",
};

export default function VideoPage() {
  return (
    <div className="docs-content">
      <h1>Video Workflows</h1>

      <p>
        <code>glove-video</code> turns video generation into an inspectable
        production loop. The agent develops the concept, builds timed prompts,
        carries subjects and locations across shots, feeds image references into
        the video model, watches every result, revises weak drafts, and exposes
        only a reviewed winner. The model provider remains an adapter you bring.
      </p>

      <CodeBlock filename="terminal" language="bash" code={`pnpm add glove-video`} />

      <p>
        Start with the <a href="/docs/video/gallery">worked video case study</a>{" "}
        if you want to see the difference first. Its keyframe, exact timed beats,
        prompt trace, generated drafts, review evidence, delivery decision, and
        measured spend all come from one recorded agent run.
      </p>

      <h2 id="why">Why not one generate_video tool?</h2>

      <p>
        A one-shot wrapper proves that a provider can return an MP4. It does not
        give an agent the machinery to direct a result worth showing.
      </p>

      <table>
        <thead>
          <tr><th>Production need</th><th>A single call loses</th><th>glove-video records</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Time</td>
            <td>A prose prompt with ambiguous pacing</td>
            <td>Timestamped beats, duration, camera, motion, and sound</td>
          </tr>
          <tr>
            <td>Continuity</td>
            <td>Subjects and locations re-described from memory</td>
            <td>Durable character and scene definitions spliced verbatim</td>
          </tr>
          <tr>
            <td>Direction</td>
            <td>Opaque provider-specific compromises</td>
            <td>A prompt pipeline and capability-fit trace</td>
          </tr>
          <tr>
            <td>Quality</td>
            <td>“Job completed” mistaken for “clip is good”</td>
            <td>Actual-video review, evidence, revision prompts, and a hard gate</td>
          </tr>
          <tr>
            <td>Sequences</td>
            <td>Expensive restarts after one failed shot</td>
            <td>Checkpointed DAG flows that resume from incomplete shots</td>
          </tr>
        </tbody>
      </table>

      <h2 id="model">The production loop</h2>

      <CodeBlock
        filename="flow"
        language="text"
        code={`brief
  → creative direction + acceptance criteria
  → continuity library + opening frame from glove-image
  → timed beats → prompt pipeline → capability fitting
  → provider job → internal video asset
  → review the actual clip
       revise → recipe replay → review again
       pass   → explicit delivery gate → user-facing video`}
      />

      <p>
        Generated clips are internal drafts when review is configured. The
        review tool sends stored video bytes to a separate video-capable model
        and saves a score, timestamped evidence, issues, and a self-contained
        revision prompt. <code>glove_video_deliver</code> refuses anything whose
        latest review does not meet the configured threshold.
      </p>

      <p>
        Reviews also receive identity, style, and first-frame images recorded in
        the video recipe. Hosts can pass additional <code>reference_assets</code>
        for evaluation-only anchors. This lets the reviewer compare a recurring
        face, garment, or product against the actual reference instead of judging
        each clip in isolation.
      </p>

      <h3 id="review-decision">What “pass” means</h3>

      <p>
        The reviewer returns a structured decision, numeric score, strengths,
        and issue records containing a criterion, severity, concrete temporal
        evidence, and required fix. Glove then recomputes approval rather than
        trusting the label alone. Delivery requires all three conditions:
      </p>

      <ol>
        <li>The reviewer declared <code>pass</code>.</li>
        <li>The score meets the host&apos;s <code>passingScore</code>.</li>
        <li>No issue has <code>major</code> or <code>critical</code> severity.</li>
      </ol>

      <p>
        Multi-shot delivery applies the same rule to every selected scene.{" "}
        <code>glove_video_flow_deliver</code> accepts reviewed replacements for
        revised shots and reveals the sequence only when the complete set passes.
      </p>

      <p>
        Any failure is normalized to <code>revise</code>. The stored review also
        carries a self-contained <code>revision_prompt</code>, so the next draft
        acts on auditable evidence instead of “try again, but better.”
      </p>

      <h2 id="quickstart">Quickstart</h2>

      <CodeBlock
        filename="studio.ts"
        language="typescript"
        code={`import { createAdapter } from "glove-core";
import {
  InMemoryVideoAssetStore,
  InMemoryVideoFlowStore,
  InMemoryVideoLibrary,
  InMemoryVideoReviewStore,
  defaultVideoPipeline,
  mountVideo,
  openrouterVideo,
} from "glove-video";

await mountVideo(agent, {
  adapter: openrouterVideo(),
  assets: new InMemoryVideoAssetStore(),
  library: new InMemoryVideoLibrary(),
  flows: new InMemoryVideoFlowStore(),
  pipeline: defaultVideoPipeline(),
  review: {
    model: createAdapter({
      provider: "openrouter",
      model: "qwen/qwen3.5-flash-02-23",
      stream: false,
    }),
    store: new InMemoryVideoReviewStore(),
    passingScore: 84,
    rubric: "Presentation-ready, coherent motion, stable subject, no artifacts.",
  },
});

agent.build();
await agent.processRequest(
  "Create the strongest six-second launch film. Review every draft and deliver only a pass.",
);`}
      />

      <h2 id="references">Image-to-video without plumbing</h2>

      <p>
        Video references are asset ids with roles. A frame generated by{" "}
        <code>glove-image</code> can become a <code>first-frame</code> reference
        without uploading it to temporary object storage; the resolver hands
        the bytes to the video adapter at execution time.
      </p>

      <CodeBlock
        filename="director-call.ts"
        language="typescript"
        code={`glove_video_generate({
  intent: "A glass seed opens into a ring of light",
  beats: [
    { at: 0, action: "seed rests perfectly still" },
    { at: 2, action: "a warm seam appears" },
    { at: 4, action: "the shell opens in one clean motion" },
    { at: 6, action: "light settles into a calm halo" },
  ],
  refs: [{ asset: "img_opening_frame", role: "first-frame" }],
  duration: 6,
  aspect_ratio: "16:9",
  resolution: "720p",
  audio: true,
});`}
      />

      <h2 id="flows">Flows that survive partial failure</h2>

      <p>
        Multi-shot work is saved as a dependency graph. A run checkpoints each
        completed shot with its recipe and output asset. If shot four fails,
        resuming keeps shots one through three and starts at the unfinished
        node. Continuity can use a matched reference or extend the previous clip.
      </p>

      <h2 id="adapters">Provider adapters and capability fitting</h2>

      <p>
        Every <code>VideoModelAdapter</code> declares its supported modes,
        reference roles, durations, aspect ratios, resolutions, audio support,
        and candidate limits. <code>fitVideoToModel</code> applies that contract
        before the provider call and writes every adjustment to the recipe
        trace. Long-running job creation, polling, cancellation, download, and
        provider job ids stay behind the adapter.
      </p>

      <h2 id="usage">Cost is part of the artifact</h2>

      <p>
        Usage is attached to each recipe and accumulated by source for the host:
        requests, generated seconds, token counts where available, and real USD
        cost when the provider reports it. That makes creative iteration
        budgetable instead of a surprise discovered on an invoice.
      </p>
    </div>
  );
}
