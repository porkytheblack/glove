import { CodeBlock } from "@/components/code-block";
import { BlogPostHeader } from "@/components/blog-post-header";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("building-video-workflows-with-glove")!;

export const metadata = postMetadata(post);

export default async function Post() {
  return (
    <div className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        <code>glove-video</code> gives agents a workflow for producing video: maintain creative direction, generate shots, inspect the actual results, revise failures, and deliver approved selections.
      </p>

      <p>
        A short campaign may need a recurring character, consistent locations, several shots, revisions, and a final review. Provider jobs take time, and a failure halfway through the sequence should not require regenerating every successful shot.
      </p>

      <p>
        <a href="https://www.npmjs.com/package/glove-video">glove-video is available on npm</a>. The published <code>0.1.4</code> package includes prompt pipelines, reusable character and scene libraries, stored assets and recipes, an OpenRouter generation adapter, resumable shot flows, and optional review-gated delivery.
      </p>

      <CodeBlock
        language="bash"
        code={`pnpm add glove-video`}
      />

      <p>
        Mount it on a Glove agent with <code>mountVideo</code>, supplying a model adapter, asset storage, and a continuity library. Add flow storage for sequences and a video-capable reviewer when delivery should depend on inspection. The <a href="/docs/video">video guide</a> has the complete setup.
      </p>

      <p>
        Imagine a three-shot film for a lakeside lodge: a traveler arrives, walks toward the water, and settles on a terrace.
      </p>

      <p>
        The brief establishes the story. The workflow carries the information needed to make its separate shots belong together.
      </p>

      <h2 id="continuity-starts-before-generation">
        Continuity starts before generation
      </h2>

      <p>
        A saved character can describe appearance and performance, including how the person moves. A saved scene can describe the setting, lighting, visual style, and ambient motion.
      </p>

      <p>
        The prompt pipeline expands those definitions into each shot. Structured beats provide a timeline for actions, while additional passes can supply camera direction or a house style. An optional model-backed enhancer can further develop the prompt.
      </p>

      <p>
        Each stage records a trace, so the application can inspect how the original intent became the submitted request. Generated assets retain their recipes and lineage, supporting regeneration with a revised direction.
      </p>

      <p>
        These mechanisms make continuity requirements explicit. They cannot guarantee that a generative model will satisfy them, which is why inspection remains part of the workflow.
      </p>

      <p>
        The final pipeline stage, <code>fitVideoToModel</code>, checks the request against the adapter’s declared capabilities. Duration, aspect ratio, resolution, reference roles, audio, seeds, negative prompts, and candidate counts can vary between providers.
      </p>

      <p>
        When the stage reduces a request to fit those capabilities, it records the change in the recipe trace. That makes a dropped reference or adjusted duration visible during debugging.
      </p>

      <h2 id="provider-jobs-stay-behind-the-adapter">
        Provider jobs stay behind the adapter
      </h2>

      <p>
        The bundled <code>openrouterVideo()</code> adapter submits a generation job, polls its status, downloads the completed media, and returns bytes with provider job identifiers and usage information.
      </p>

      <p>
        The directing agent works with asset IDs and metadata. The asset store holds the video bytes.
      </p>

      <p>
        This boundary also allows custom adapters. The package contract has optional extension and transformation operations, but those depend on the adapter implementing them. The bundled OpenRouter adapter currently implements generation; it does not implement <code>extend</code> or <code>transform</code>.
      </p>

      <p>
        Image references can come from another store through a host-supplied resolver. That provides a bridge to <a href="/docs/image">glove-image</a>, for example when a project first creates a character reference or opening frame and then uses it in a video request.
      </p>

      <h2 id="a-sequence-becomes-a-resumable-flow">
        A sequence becomes a resumable flow
      </h2>

      <p>
        A video flow describes shots and their dependencies. For the lodge film, the application might define:
      </p>

      <ol>
        <li>An arrival shot establishing the traveler and location.</li>
        <li>A walk toward the lake, following the arrival.</li>
        <li>A terrace shot completing the sequence.</li>
      </ol>

      <p>
        Dependencies establish order. A continuity relationship can also pass the first output of a preceding shot forward, either as a reference or through an adapter’s extension operation.
      </p>

      <p>
        Those options remain subject to provider capabilities. The package does not automatically extract a final frame from the preceding clip.
      </p>

      <p>
        Before execution, the runner validates the dependency graph. Each run retains an immutable copy of its definition and saves state before and after each shot. Execution is sequential.
      </p>

      <p>
        If the third shot fails after the first two have been saved as successful, resuming skips those completed shots and retries the unfinished work. Recovery follows the saved checkpoints: an interrupted shot whose success was not recorded may need to run again.
      </p>

      <h2 id="review-evaluates-the-actual-clip">
        Review evaluates the actual clip
      </h2>

      <p>
        With review configured, generated videos remain internal drafts. The directing agent receives their identifiers and metadata, but generation does not immediately expose them as user-facing media.
      </p>

      <p>
        The review tool sends the stored video bytes to a separate, video-capable model. It can also include relevant identity, style, and first-frame images, allowing the reviewer to compare the result with visual references.
      </p>

      <p>
        For the lodge film, the reviewer might identify a changing jacket, unstable movement, or a terrace shot that fails to match the brief. Its response includes a score, pass-or-revise decision, structured issues, temporal evidence, and actionable revision guidance.
      </p>

      <p>
        Glove then applies the delivery policy deterministically. Delivery requires a passing decision, a score at or above the configured threshold, and no major or critical issue. A reviewer cannot offset a blocking defect with a high overall score.
      </p>

      <p>
        The directing agent decides how to respond: regenerate with feedback, compare another candidate, or use a supported transformation. The revised asset goes through review again.
      </p>

      <p>
        A flow delivery gate checks every selected shot and supports explicit reviewed replacements. One failed or unreviewed shot holds the sequence.
      </p>

      <p>
        Enable review and route presentation through the delivery tools to use this gate. The model supplies the assessment; the host’s score threshold and issue policy decide whether that assessment permits delivery.
      </p>

      <h2 id="storage-and-presentation-remain-application-concerns">
        Storage and presentation remain application concerns
      </h2>

      <p>
        In-memory stores are supplied for prototypes and tests. Production applications can implement asset storage over object storage and persist libraries, reviews, flow definitions, and checkpoints in a database.
      </p>

      <p>
        User-facing media references travel through <code>renderData</code>, separate from the ordinary tool data supplied to the directing model. The package defines video, gallery, and flow rendering shapes, but does not yet include a React renderer.
      </p>

      <p>
        It also leaves editing and assembly to other tools. Concatenation, transcoding, audio mixing, and frame extraction belong in <code>glove-env-media</code> or another media service.
      </p>

      <p>
        Start with one shot, a reusable visual reference, and a review rubric. Once that loop works, expand it into a flow. The <a href="https://github.com/porkytheblack/glove/blob/main/packages/glove-video/README.md">package guide</a> covers the tools and storage contracts; the <a href="/docs/video/gallery">video gallery</a> shows a recorded production workflow with candidates and review decisions.
      </p>
    </div>
  );
}
