import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Image Workflows",
  description:
    "Agentic image generation for Glove — prompt pipelines with enhancer inbetweens, durable characters and scenes, reference images, editing, assembly, vision review, and per-call cost tracking.",
};

export default async function ImagePage() {
  return (
    <div className="docs-content">
      <h1>Image Workflows</h1>

      <p>
        <code>glove-image</code> makes image generation a <strong>workflow</strong>{" "}
        rather than a single call. An agent gets durable{" "}
        <a href="#characters">characters</a> and{" "}
        <a href="#scenes">scenes</a>, a{" "}
        <a href="#pipeline">prompt pipeline</a> it does not have to assemble by
        hand, <a href="#refs">reference images</a> with roles, deterministic{" "}
        <a href="#assembly">assembly</a>, <a href="#vision">eyes</a> to check its
        own output, and <a href="#usage">spend accounting</a> on every call. The
        image model itself is an adapter you bring.
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-image`}
      />

      <p>
        If you would rather see it than read it, the{" "}
        <a href="/docs/image/gallery">image gallery</a> is a worked campaign —
        every frame shown with the prompt that produced it, the pipeline trace,
        and what it cost, plus a canvas diagramming how one image was built.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="why">Why not just one generate_image tool</h2>

      <p>
        The usual shape is a single tool that takes a prompt string and returns
        a URL. It works exactly once. The moment the work is a workflow, four
        things break:
      </p>

      <ul>
        <li>
          <strong>Prompts are built, not typed.</strong> The prompt that
          actually works is the user&apos;s intent <em>plus</em> house style,{" "}
          <em>plus</em> the character&apos;s canonical description,{" "}
          <em>plus</em> the scene&apos;s palette, <em>plus</em> a
          model-specific rewrite. That is a pipeline with stages, and inlining
          it loses every intermediate state — including the reason the final
          prompt looks the way it does.
        </li>
        <li>
          <strong>Characters drift.</strong> &ldquo;Draw Mira again, but at the
          harbor&rdquo; only works if Mira is a durable thing — a description,
          reference images, a negative list — and not a phrase the model
          half-remembers from six turns ago.
        </li>
        <li>
          <strong>Scenes are settings, not sentences.</strong> The same neon
          market should look like the same neon market across ten generations.
        </li>
        <li>
          <strong>Existing images are inputs.</strong> Users bring photos,
          earlier generations become references, results get composited into
          sheets and storyboards. Image bytes need a home that is not the
          context window.
        </li>
      </ul>

      <p>
        Each of those becomes a named primitive here, with a storage seam,
        following the same posture as the rest of the stack: adapter contracts
        you implement, reference in-memory adapters for dev, one{" "}
        <code>mountImage</code> that folds the tools, Zod schemas throughout.
      </p>

      <h3>When to use it</h3>

      <ul>
        <li>
          The app generates images repeatedly with recurring subjects, styles,
          or settings — character art, storyboards, product shots, brand assets.
        </li>
        <li>
          You want prompt construction to be inspectable and composable rather
          than a template string.
        </li>
        <li>Users bring their own images in, and outputs feed back in as inputs.</li>
        <li>You need to know what the generation actually cost.</li>
      </ul>

      <p>
        If you need exactly one &ldquo;make me a picture&rdquo; tool, a
        hand-rolled <code>glove.fold(...)</code> around your provider is still
        simpler. <code>glove-image</code> earns its keep when generation is a
        workflow.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="model">Mental model</h2>

      <p>Four pieces, deliberately separated:</p>

      <table>
        <thead>
          <tr>
            <th>Piece</th>
            <th>What it is</th>
            <th>Contract</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Assets</strong>
            </td>
            <td>
              Every image the workflow touches — imported, generated, edited,
              assembled — stored with metadata and lineage. Bytes never enter
              model context; the model works with asset ids.
            </td>
            <td>
              <code>ImageAssetStore</code>
            </td>
          </tr>
          <tr>
            <td>
              <strong>Library</strong>
            </td>
            <td>
              Durable characters and scenes, curated by the agent or the host
              app, referenced by name in generation calls.
            </td>
            <td>
              <code>ImageLibraryAdapter</code>
            </td>
          </tr>
          <tr>
            <td>
              <strong>Pipeline</strong>
            </td>
            <td>
              An ordered list of <em>inbetweens</em> that turn a raw intent into
              the final request — expanding characters and scenes, injecting
              style, running an LLM rewrite — each stage recorded in a trace.
            </td>
            <td>
              <code>PromptEnhancer[]</code>
            </td>
          </tr>
          <tr>
            <td>
              <strong>Model</strong>
            </td>
            <td>
              The image model behind a capability-declaring adapter — generate,
              edit, variations.
            </td>
            <td>
              <code>ImageModelAdapter</code>
            </td>
          </tr>
        </tbody>
      </table>

      <CodeBlock
        filename="flow"
        language="text"
        code={`intent + { characters, scene, refs }
        │
        ▼
  Prompt pipeline (inbetweens, in order)
    expandCharacters → expandScenes → styleDirective → llmEnhance → fitToModel
        │                                  each stage appends to draft.trace
        ▼
  ImageModelAdapter.generate(request)
        │
        ▼
  candidates → ImageAssetStore (with Recipe lineage + usage)`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="quickstart">Quickstart</h2>

      <p>
        Build the agent as normal, then mount the image surface before or after{" "}
        <code>build()</code> — same convention as{" "}
        <a href="/docs/mcp">
          <code>mountMcp</code>
        </a>{" "}
        and{" "}
        <a href="/docs/mesh">
          <code>mountMesh</code>
        </a>
        .
      </p>

      <CodeBlock
        filename="studio.ts"
        language="typescript"
        code={`import { Glove, Displaymanager, MemoryStore, createAdapter } from "glove-core";
import {
  mountImage,
  InMemoryImageAssetStore,
  InMemoryImageLibrary,
  expandCharacters,
  expandScenes,
  styleDirective,
  llmEnhance,
  openrouterImages,
} from "glove-image";

const glove = new Glove({
  store: new MemoryStore("studio"),
  model: createAdapter({ provider: "anthropic" }),
  displayManager: new Displaymanager(),
  systemPrompt: "You are an art director. Use the image tools to create and refine images.",
  compaction_config: { compaction_instructions: "Summarize the art direction so far." },
  serverMode: true,
});

await mountImage(glove, {
  // The image model — reads OPENROUTER_API_KEY, defaults to google/gemini-2.5-flash-image
  adapter: openrouterImages(),

  // Storage seams — swap for your own in production
  assets: new InMemoryImageAssetStore(),
  library: new InMemoryImageLibrary(),

  // An LLM slot the pipeline's rewrite pass uses
  model: createAdapter({ provider: "openrouter", model: "openai/gpt-4o-mini", stream: false }),

  // The middle of the pipeline. fitToModel() is always appended.
  pipeline: [
    expandCharacters(),
    expandScenes(),
    styleDirective("hand-painted gouache, muted palette, soft rim light"),
    llmEnhance({ instructions: "Tighten composition language." }),
  ],
});

glove.build();

await glove.processRequest(
  "Create a character called Mira — a wiry sky-courier in her 20s with a patched flight jacket. " +
    "Then draw her landing at a neon night market.",
);
// Agent: glove_image_character_save({ name: "mira", ... })
//        glove_image_scene_save({ name: "neon-market", ... })
//        glove_image_generate({ intent: "Mira landing", characters: ["mira"], scene: "neon-market" })`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="pipeline">The prompt pipeline</h2>

      <p>
        This is the spine of the package. A generation call never sends the
        model&apos;s raw text to the image model. It builds a{" "}
        <code>PromptDraft</code> and runs it through the configured inbetweens{" "}
        <strong>in order</strong>. Each inbetween is a small named transform;
        each appends to a trace, so the final request is fully explainable —
        and every degradation is visible rather than silent.
      </p>

      <CodeBlock
        filename="types"
        language="typescript"
        code={`interface PromptDraft {
  intent: string;                   // the original ask — never mutated
  positive: string;                 // the working prompt
  negative?: string;
  refs: RefImage[];                 // accumulated reference images
  params: GenerationParams;         // { size?, seed?, candidates?, extra? }
  requested: { characters: string[]; scene?: string };  // names from the call
  characters: CharacterDef[];       // resolved by expandCharacters()
  scene?: SceneDef;                 // resolved by expandScenes()
  trace: TraceEntry[];              // one entry per stage
}

interface PromptEnhancer {
  name: string;
  run(draft: PromptDraft, ctx: EnhancerContext): Promise<PromptDraft | void>;
}

interface EnhancerContext {
  library: ImageLibraryReader;           // read-only character/scene lookup
  assets: Pick<ImageAssetStore, "get" | "list">;
  model?: ModelAdapter;                  // the mount's LLM slot
  capabilities: ImageModelCapabilities;  // what the target model supports
  note(message: string): void;           // explain what this stage did
  recordUsage(usage: Partial<ImageUsage>): void;  // report model spend
  signal?: AbortSignal;
}`}
      />

      <h3>Built-in inbetweens</h3>

      <table>
        <thead>
          <tr>
            <th>Inbetween</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>expandCharacters()</code>
            </td>
            <td>
              For each name in the call&apos;s <code>characters</code>, loads the
              library record, splices its canonical appearance block into the
              prompt, merges its negative, and attaches its reference images as{" "}
              <code>identity</code> refs. A missing name is a clear error naming
              what <em>is</em> available — never a silent skip.
            </td>
          </tr>
          <tr>
            <td>
              <code>expandScenes()</code>
            </td>
            <td>
              The same for the call&apos;s <code>scene</code> — setting, palette,
              lighting, mood, plus <code>composition</code> and{" "}
              <code>style</code> refs.
            </td>
          </tr>
          <tr>
            <td>
              <code>styleDirective(text)</code>
            </td>
            <td>Appends a fixed house-style clause. The dumb, reliable one.</td>
          </tr>
          <tr>
            <td>
              <code>negativeDefaults(list)</code>
            </td>
            <td>
              Merges a standing negative list (&ldquo;extra fingers,
              watermark&rdquo;) without clobbering per-call negatives or
              duplicating entries.
            </td>
          </tr>
          <tr>
            <td>
              <code>llmEnhance({"{ model?, instructions? }"})</code>
            </td>
            <td>
              One LLM rewrite pass over the working prompt. The contract is
              strict: preserve character-appearance wording verbatim (identity
              consistency dies in paraphrase) and return only the rewritten
              prompt. Uses the mount&apos;s <code>model</code> unless given its
              own, and skips with a trace note when neither exists.
            </td>
          </tr>
          <tr>
            <td>
              <code>fitToModel()</code>
            </td>
            <td>
              Terminal, always appended automatically. Clamps the draft to the
              adapter&apos;s declared capabilities — folds <code>negative</code>{" "}
              into the prompt as an &ldquo;Avoid:&rdquo; clause when the model
              has no negative slot, drops refs whose roles are unsupported,
              clamps ref count (identity refs survive first), snaps size to a
              supported value, clamps candidates, drops an unsupported seed.
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        <strong>Ordering is yours.</strong> The default pipeline is{" "}
        <code>[expandCharacters(), expandScenes()]</code>; anything you pass to{" "}
        <code>mountImage</code> replaces the middle, and{" "}
        <code>fitToModel()</code> runs last whether or not you list it.
      </p>

      <h3>Every degradation is traced</h3>

      <p>
        A model that silently gets fewer reference images than it asked for
        produces a confusing result and no explanation.{" "}
        <code>fitToModel()</code> writes each adjustment into the trace, and the
        tool result hands those notes back to the agent as{" "}
        <code>degradations</code>:
      </p>

      <CodeBlock
        filename="tool result (data)"
        language="json"
        code={`{
  "assets": [{ "id": "img_124dea9c7c51", "width": 1024, "height": 1024 }],
  "degradations": [
    "expand-characters: Expanded 1 character(s).",
    "expand-scenes: Expanded scene \\"neon-market\\".",
    "llm-enhance: Rewritten by LLM pass.",
    "fit-to-model: No negative-prompt slot — folded into the prompt as an Avoid clause."
  ],
  "usage": { "requests": 1, "tokens_in": 9, "tokens_out": 1301, "cost_usd": 0.0387302 }
}`}
      />

      <h3>Writing your own inbetween</h3>

      <p>
        It is a two-property object. A brand-system lookup, a watermark policy,
        a translation pass, a seasonal palette — all the same shape:
      </p>

      <CodeBlock
        filename="brand.ts"
        language="typescript"
        code={`import type { PromptEnhancer } from "glove-image";

export function brandPalette(brand: string): PromptEnhancer {
  return {
    name: "brand-palette",
    async run(draft, ctx) {
      const tokens = await lookupBrandTokens(brand);   // your system
      draft.positive = \`\${draft.positive}\\n\\nPalette: \${tokens.palette.join(", ")}\`;
      ctx.note(\`Applied \${brand} palette.\`);
    },
  };
}`}
      />

      <p>
        Enhancer names must be unique — <code>mountImage</code> throws on
        duplicates rather than letting two stages quietly share a trace line.
      </p>

      <h3>Why arguments, not inline syntax</h3>

      <p>
        Characters and scenes are referenced through tool arguments (
        <code>characters: [&quot;mira&quot;]</code>), never parsed out of prose.{" "}
        <code>@</code> is already Glove&apos;s subagent routing signal,{" "}
        <code>/</code> is the extension trigger, and inline{" "}
        <code>{"{{character:mira}}"}</code> templating puts a parser between the
        model and its own prompt. The tool schema is the interface; the model
        reads the library with the list tools and passes names.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="characters">Characters</h2>

      <p>
        A character is a durable identity: wording that must stay stable, images
        that anchor likeness, and negatives that fence off drift.
      </p>

      <CodeBlock
        filename="types"
        language="typescript"
        code={`interface CharacterDef {
  name: string;              // library key, kebab-case ("mira")
  display_name?: string;
  /** One-paragraph canonical appearance. Spliced VERBATIM into prompts. */
  appearance: string;
  /** Non-visual notes for the agent. NEVER sent to the image model. */
  notes?: string;
  negative?: string;         // e.g. "no goggles, never smiling"
  ref_images?: Array<{ asset: string; label?: string }>;  // identity anchors
  tags?: string[];
  created_at: string;
  updated_at: string;
}`}
      />

      <p>Three rules the tools enforce:</p>

      <ul>
        <li>
          <strong>
            <code>appearance</code> is prompt text, owned by the library.
          </strong>{" "}
          <code>expandCharacters()</code> splices it verbatim and{" "}
          <code>llmEnhance</code> is instructed not to reword it. Consistency
          comes from repetition, not from the model remembering.
        </li>
        <li>
          <strong>Ref images are assets.</strong> A character&apos;s reference
          images live in the asset store like everything else, so promoting a
          good generation to a character ref is one{" "}
          <code>glove_image_character_save</code> call with the asset id — the
          canonical &ldquo;lock in this look&rdquo; move.
        </li>
        <li>
          <strong>
            <code>notes</code> never reach the image model.
          </strong>{" "}
          Personality belongs to the agent&apos;s reasoning, not the prompt.
        </li>
      </ul>

      <CodeBlock
        filename="agent transcript"
        language="text"
        code={`User: Mira should always have a scar over her left eyebrow.

Agent → glove_image_character_save({
  name: "mira",
  appearance: "a wiry sky-courier in her mid-20s, short windswept black hair,
    a thin scar over the left eyebrow, patched olive flight jacket with brass buckles",
  negative: "no goggles",
})

# Every later generation that names "mira" now carries the scar, word for word.`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="scenes">Scenes</h2>

      <p>
        Same shape, pointed at settings. A scene holds the location, era,
        palette, lighting and mood as one prompt-ready block, plus optional
        style and composition references.
      </p>

      <CodeBlock
        filename="types"
        language="typescript"
        code={`interface SceneDef {
  name: string;
  display_name?: string;
  /** Canonical setting block. Prompt-ready, spliced verbatim. */
  setting: string;
  negative?: string;
  ref_images?: Array<{ asset: string; role: "style" | "composition"; label?: string }>;
  tags?: string[];
  created_at: string;
  updated_at: string;
}`}
      />

      <p>
        Characters and scenes are orthogonal: any character can appear in any
        scene, and both splice into the same draft. Negatives from both merge
        without duplicating entries.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="refs">Bringing images in</h2>

      <p>
        Three distinct doors, because &ldquo;use this image&rdquo; means three
        different things:
      </p>

      <ol>
        <li>
          <strong>Import.</strong> <code>glove_image_import</code> takes an
          http(s) URL, a <code>data:</code> URL, or raw base64 and lands it in
          the asset store as a first-class asset. Format and dimensions are
          sniffed from the bytes (PNG, JPEG, GIF, WebP) — no image library
          needed to catalog it.
        </li>
        <li>
          <strong>Reference.</strong> Any asset can ride a generation call as a{" "}
          <code>RefImage</code> with a <em>role</em>. Adapters declare which
          roles they honour and <code>fitToModel()</code> reconciles.
        </li>
        <li>
          <strong>Assemble.</strong> Deterministic compositing of existing
          assets into one image, with no model call at all — see below.
        </li>
      </ol>

      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>identity</code>
            </td>
            <td>This face / this likeness. Survives ref clamping first.</td>
          </tr>
          <tr>
            <td>
              <code>style</code>
            </td>
            <td>This look — brushwork, grade, era.</td>
          </tr>
          <tr>
            <td>
              <code>composition</code>
            </td>
            <td>This framing and layout.</td>
          </tr>
          <tr>
            <td>
              <code>content</code>
            </td>
            <td>Image-to-image base to transform.</td>
          </tr>
          <tr>
            <td>
              <code>mask</code>
            </td>
            <td>Edit region — white is editable, black stays.</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2 id="assembly">Assembly</h2>

      <p>
        Contact sheets, storyboard grids, side-by-sides and layered comps are
        not generation problems — they are compositing problems, and a model
        should not be guessing at them.{" "}
        <code>glove_image_assemble</code> paints existing assets onto a canvas
        deterministically:
      </p>

      <CodeBlock
        filename="tool call"
        language="typescript"
        code={`glove_image_assemble({
  canvas: { width: 2100, height: 1100, background: "#111111" },
  layers: [
    { asset: "img_124dea9c7c51", x: 20,   y: 50, width: 1000, height: 1000, fit: "contain" },
    { asset: "img_2a5f08e54493", x: 1060, y: 50, width: 1000, height: 1000, fit: "contain" },
  ],
  name: "before-after",
})`}
      />

      <p>
        Layers paint in order (first at the bottom) and support{" "}
        <code>fit</code>, <code>rotate</code> and <code>opacity</code>. Backed by{" "}
        <a href="https://sharp.pixelplumbing.com">sharp</a> as an{" "}
        <strong>optional peer</strong> — the tool refuses with an install hint
        when sharp is absent and the rest of the package keeps working. Apps
        already running{" "}
        <a href="/docs/working-environment">
          <code>glove-working-environment</code>
        </a>{" "}
        with <code>env:images</code> can do arbitrarily fancier pixel work
        there; <code>AssemblySpec</code> covers the declarative 90% in one call.
      </p>

      <p>
        Generative assembly — &ldquo;put Mira <em>into</em> this photo&rdquo; —
        is not assembly. That is <code>glove_image_edit</code> with{" "}
        <code>content</code> and <code>mask</code> refs.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="lineage">Lineage and regeneration</h2>

      <p>
        Every generated, edited or assembled asset records how it was made. That
        record is what makes &ldquo;same but at dusk&rdquo; a single call rather
        than a re-derivation:
      </p>

      <CodeBlock
        filename="types"
        language="typescript"
        code={`interface Recipe {
  kind: "generated" | "edited" | "assembled";
  intent?: string;          // the raw ask, untouched
  finalPrompt?: string;     // what actually went to the model
  negative?: string;
  params?: GenerationParams;
  adapter?: string;         // which ImageModelAdapter
  characters?: string[];    // library names as requested
  scene?: string;
  refs?: Array<{ asset: string; role: RefRole }>;
  trace?: TraceEntry[];     // the full pipeline trace
  parent?: string;          // for "edited": the source asset
  spec?: AssemblySpec;      // for "assembled"
  usage?: ImageUsage;       // what this asset cost to make
}`}
      />

      <CodeBlock
        filename="tool call"
        language="typescript"
        code={`glove_image_regenerate({ asset: "img_124dea9c7c51", tweak: "at dusk" })
// Replays the recipe through the CURRENT pipeline, with the tweak appended
// to the original intent. Library edits since the first run are picked up —
// fix a character's appearance once and regenerate everything that used it.`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="vision">Giving the agent eyes</h2>

      <p>
        A model cannot see what it generated unless you hand it a vision model.{" "}
        <code>mountImage</code> takes one in the <code>review</code> slot — any
        vision-capable <code>ModelAdapter</code>, the same type as the
        agent&apos;s own model — and it powers two things.
      </p>

      <CodeBlock
        filename="studio.ts"
        language="typescript"
        code={`await mountImage(glove, {
  adapter: openrouterImages(),
  assets, library,
  review: {
    vision: createAdapter({ provider: "openrouter", model: "openai/gpt-4o-mini", stream: false }),
    rounds: 1,                    // max refine rounds after the first generation; 0 = critique off
    rubric: "The character must match the appearance block. Flag anatomy errors.",
  },
});`}
      />

      <p>
        <strong>
          1. <code>glove_image_describe</code> gains a visual description.
        </strong>{" "}
        The context-safe way to look at an asset — bytes stay in the store, a
        paragraph comes back:
      </p>

      <CodeBlock
        filename="describe result"
        language="text"
        code={`visual_description: "A confident young woman with majestic wings walking through a
vibrant, bustling street market illuminated by neon signs. She wears a green jacket
adorned with patches, jeans, and boots, and carries a bag slung over her shoulder..."`}
      />

      <p>
        <strong>2. Generations can self-check.</strong> With{" "}
        <code>rounds &gt; 0</code>, each generation is critiqued against the
        intent, the character appearance blocks, and your rubric. On PASS it is
        done; on FAIL the critique is appended to the draft as revision notes
        (traced as the <code>review</code> stage) and one more round runs,
        bounded by <code>rounds</code>. Every critique lands in the final recipe
        — inspectable like the rest of the pipeline.
      </p>

      <p>
        Vision is <strong>opt-in</strong> because it costs real tokens per look
        — an image is roughly 25k input tokens on a small vision model. Without
        it, <code>describe</code> returns metadata and lineage only, and
        generations are not reviewed. Spend from vision calls is attributed
        separately in the usage report (<code>describe</code> and{" "}
        <code>review</code> buckets), so you can see exactly what looking cost.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="usage">Usage and cost tracking</h2>

      <p>
        Generation spends real money, so every model-touching path is metered —
        image generations and edits, the <code>llmEnhance</code> rewrite pass,
        vision review rounds, and vision describes. The unit is:
      </p>

      <CodeBlock
        filename="types"
        language="typescript"
        code={`interface ImageUsage {
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd?: number;   // when the provider reports real spend
}`}
      />

      <p>
        <code>cost_usd</code> is filled when the provider reports actual spend —
        the OpenRouter adapter asks for it with{" "}
        <code>usage: {"{ include: true }"}</code>, so a generation comes back
        with its true dollar cost rather than an estimate. Adapters that report
        nothing still count <code>{"{ requests: 1 }"}</code>, so request counts
        stay honest either way.
      </p>

      <p>Spend surfaces in four places:</p>

      <table>
        <thead>
          <tr>
            <th>Scope</th>
            <th>Where</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Per call</td>
            <td>
              <code>data.usage</code> on generate / edit / regenerate results —
              the whole call, including the enhance pass and any review rounds.
              The model sees what each action cost.
            </td>
          </tr>
          <tr>
            <td>Per asset</td>
            <td>
              <code>Recipe.usage</code>, so any image can answer &ldquo;what did
              this cost to make&rdquo; forever.{" "}
              <code>glove_image_describe</code> includes it.
            </td>
          </tr>
          <tr>
            <td>Per session</td>
            <td>
              A <code>UsageMeter</code> with per-source attribution (
              <code>generate</code>, <code>edit</code>, <code>enhance</code>,{" "}
              <code>review</code>, <code>describe</code>). Read it host-side, or
              let the agent read it via <code>glove_image_usage</code>.
            </td>
          </tr>
          <tr>
            <td>Your accounting</td>
            <td>
              The <code>onUsage</code> callback fires on every spend event —
              wire it to <code>store.addTokens(...)</code>, a billing table, or
              metrics.
            </td>
          </tr>
        </tbody>
      </table>

      <CodeBlock
        filename="metering.ts"
        language="typescript"
        code={`import { UsageMeter } from "glove-image";

const meter = new UsageMeter();

await mountImage(glove, {
  adapter: openrouterImages(),
  assets, library,
  usage: meter,
  onUsage: (source, u) => metrics.increment(\`image.\${source}\`, u.cost_usd ?? 0),
});

// ...later, host-side:
meter.report();
// {
//   total: { requests: 3, tokens_in: 51186, tokens_out: 1388, cost_usd: 0.0387653 },
//   by_source: {
//     generate: { requests: 1, tokens_in: 51,    tokens_out: 1310, cost_usd: 0.0387653 },
//     describe: { requests: 1, tokens_in: 25516, tokens_out: 77 },
//     review:   { requests: 1, tokens_in: 25619, tokens_out: 1 },
//   },
// }`}
      />

      <p>
        Note what that report makes obvious: the two vision calls cost{" "}
        <em>five hundred times</em> more input tokens than the generation
        prompt. That is the kind of thing you want to see before the invoice.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="tools">The tools</h2>

      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Input</th>
            <th>Behaviour</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>glove_image_generate</code>
            </td>
            <td>
              <code>
                {"{ intent, characters?, scene?, refs?, negative?, size?, seed?, candidates?, name?, tags? }"}
              </code>
            </td>
            <td>
              Builds the draft, runs the pipeline, calls the adapter, stores
              every candidate with its recipe and usage.
            </td>
          </tr>
          <tr>
            <td>
              <code>glove_image_edit</code>
            </td>
            <td>
              <code>{"{ asset, instruction, mask?, refs?, name? }"}</code>
            </td>
            <td>
              Edit or inpaint an existing asset. Records <code>parent</code> in
              the recipe. Errors if the adapter lacks an edit mode.
            </td>
          </tr>
          <tr>
            <td>
              <code>glove_image_regenerate</code>
            </td>
            <td>
              <code>{"{ asset, tweak? }"}</code>
            </td>
            <td>
              Replays a generated asset&apos;s recipe through the current
              pipeline.
            </td>
          </tr>
          <tr>
            <td>
              <code>glove_image_import</code>
            </td>
            <td>
              <code>{"{ url? | data?, mime?, name?, tags? }"}</code>
            </td>
            <td>
              Lands an external image in the store; format and dimensions
              sniffed from the bytes.
            </td>
          </tr>
          <tr>
            <td>
              <code>glove_image_describe</code>
            </td>
            <td>
              <code>{"{ asset }"}</code>
            </td>
            <td>
              Metadata, lineage and cost at zero model cost; adds a visual
              description when vision is configured.
            </td>
          </tr>
          <tr>
            <td>
              <code>glove_image_asset_list</code>
            </td>
            <td>
              <code>{"{ source?, tags?, name_contains? }"}</code>
            </td>
            <td>Browse the store — ids, names, dimensions, sources, tags.</td>
          </tr>
          <tr>
            <td>
              <code>glove_image_assemble</code>
            </td>
            <td>
              <code>{"{ canvas, layers, name? }"}</code>
            </td>
            <td>Deterministic compositing. Needs the optional sharp peer.</td>
          </tr>
          <tr>
            <td>
              <code>glove_image_usage</code>
            </td>
            <td>
              <code>{"{}"}</code>
            </td>
            <td>Session spend: total and per-source.</td>
          </tr>
          <tr>
            <td>
              <code>glove_image_character_*</code>
            </td>
            <td>
              <code>save</code> / <code>get</code> / <code>list</code> /{" "}
              <code>remove</code>
            </td>
            <td>
              Library CRUD. Writes only folded when <code>curate</code> is true
              (the default).
            </td>
          </tr>
          <tr>
            <td>
              <code>glove_image_scene_*</code>
            </td>
            <td>
              <code>save</code> / <code>get</code> / <code>list</code> /{" "}
              <code>remove</code>
            </td>
            <td>Same, for scenes.</td>
          </tr>
        </tbody>
      </table>

      <p>
        Tool-result discipline throughout: <code>data</code> (model-facing)
        carries asset ids, dimensions, trace summaries and usage;{" "}
        <code>renderData</code> (client-only, and{" "}
        <a href="/docs/core">stripped by model adapters</a>) carries thumbnail
        data-URLs for renderers. Bytes never enter <code>data</code>, so context
        cost is flat no matter how many images a session touches.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="adapters">Model adapters</h2>

      <p>
        The image model sits behind a small interface that declares its
        capabilities up front, so <code>fitToModel()</code> can reconcile
        requests before they are sent. Adapters may assume every request they
        receive is already in-capability.
      </p>

      <CodeBlock
        filename="types"
        language="typescript"
        code={`interface ImageModelCapabilities {
  modes: Array<"generate" | "edit" | "variation">;
  maxRefs: number;              // 0 = text-only
  refRoles: RefRole[];          // which roles it honours
  sizes: string[] | "flexible";
  negativePrompt: boolean;
  seed: boolean;
  maxCandidates: number;
}

interface ImageModelAdapter {
  name: string;
  capabilities: ImageModelCapabilities;
  generate(req: ImageGenerateRequest, signal?: AbortSignal): Promise<ImageModelResult>;
  edit?(req: ImageEditRequest, signal?: AbortSignal): Promise<ImageModelResult>;
}`}
      />

      <p>
        The mount resolves reference bytes before calling the adapter, so
        adapters stay storage-agnostic — they receive materialised bytes and
        never touch the store. Returning <code>usage</code> on the result is how
        an adapter participates in cost tracking.
      </p>

      <h3>
        <code>glove-image/openrouter</code>
      </h3>

      <p>
        The reference adapter. Plain <code>fetch</code>, no SDK dependency.
        Drives image-output models through OpenRouter&apos;s chat endpoint,
        defaulting to <code>google/gemini-2.5-flash-image</code>:
      </p>

      <CodeBlock
        filename="adapter.ts"
        language="typescript"
        code={`import { openrouterImages } from "glove-image/openrouter";

const adapter = openrouterImages({
  apiKey: process.env.OPENROUTER_API_KEY,  // this is the default
  model: "google/gemini-2.5-flash-image",  // also the default
  referer: "https://my-app.example.com",   // optional attribution
  title: "My Studio",
});`}
      />

      <p>
        It supports generate and edit, passes references as labelled image
        inputs (each one told what it is for), fans candidates out as parallel
        requests, and aggregates their usage. Bring your own for Stability,
        Replicate, fal, ComfyUI, or anything running locally — the interface is
        two methods and a capability object.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="storage">Storage seams</h2>

      <p>
        Two contracts, both with in-memory reference implementations that are
        process-local and lose everything on restart. Production swaps them for
        object storage and a database; neither is more than a handful of
        methods, and neither pulls in an SDK.
      </p>

      <CodeBlock
        filename="types"
        language="typescript"
        code={`interface ImageAssetStore {
  identifier: string;
  put(bytes: Uint8Array, meta: Omit<ImageAsset, "id" | "created_at">): Promise<ImageAsset>;
  get(id: string): Promise<ImageAsset | null>;
  bytes(id: string): Promise<Uint8Array>;
  list(filter?: AssetFilter): Promise<ImageAsset[]>;
  remove(id: string): Promise<void>;
  /** Optional — downscaled bytes for renderData. Falls back to full bytes. */
  thumbnail?(id: string, maxEdge: number): Promise<Uint8Array>;
}

interface ImageLibraryAdapter extends ImageLibraryReader {
  identifier: string;
  saveCharacter(def: CharacterDef): Promise<void>;   // upsert by name
  removeCharacter(name: string): Promise<void>;
  saveScene(def: SceneDef): Promise<void>;
  removeScene(name: string): Promise<void>;
}`}
      />

      <p>
        Apps already running <a href="/docs/memory">glove-memory</a> can back
        the library onto the entity graph — the contracts stay independent so
        neither package requires the other.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="permissions">Permissions and spend control</h2>

      <p>
        <code>requirePermission: true</code> marks{" "}
        <code>glove_image_generate</code>, <code>glove_image_edit</code> and{" "}
        <code>glove_image_regenerate</code> as gated, riding the existing{" "}
        <a href="/docs/core">(tool, input) permission flow</a> — so hosts get
        per-call consent with the standard store keying.
      </p>

      <p>
        <code>candidates</code> is clamped to the lower of the adapter&apos;s{" "}
        <code>maxCandidates</code> and the mount&apos;s own{" "}
        <code>candidates</code> config, so a model cannot fan out spend on its
        own initiative.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="mount">mountImage reference</h2>

      <CodeBlock
        filename="config"
        language="typescript"
        code={`await mountImage(glove, {
  adapter,             // ImageModelAdapter                              (required)
  assets,              // ImageAssetStore                                (required)
  library,             // ImageLibraryAdapter                            (required)
  pipeline,            // PromptEnhancer[] — default [expandCharacters(), expandScenes()]
  model,               // ModelAdapter for llmEnhance — usually the agent's own
  review,              // { vision, rounds?, rubric? } — vision off unless set
  usage,               // UsageMeter — pass your own to read it host-side
  onUsage,             // (source, usage) => void
  curate,              // default true; false folds read-only library tools
  candidates,          // default 1; clamped to capabilities.maxCandidates
  requirePermission,   // default false
});`}
      />

      <p>
        Async and non-chainable, callable before or after <code>build()</code>.
        It validates the pipeline, appends <code>fitToModel()</code>, and folds
        the tools.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="status">Status and what is next</h2>

      <p>
        Draft v0.1. The core contracts, pipeline, tool surface, in-memory
        adapters, OpenRouter adapter, vision paths and cost tracking are
        implemented and tested, including live end-to-end runs. Planned:
      </p>

      <ul>
        <li>
          React renderers (<code>glove-image/react</code>) and a multi-candidate
          picker slot.
        </li>
        <li>Direct OpenAI (gpt-image-1) and Gemini adapters.</li>
        <li>
          System-prompt priming — today the tool descriptions carry that
          context.
        </li>
        <li>
          <code>from_message</code> import, pulling image parts straight off the
          user&apos;s message.
        </li>
        <li>
          Bridges to <a href="/docs/scratchpad">scratchpad</a> (assets as
          queryable tables) and{" "}
          <a href="/docs/working-environment">working environment</a> (assets
          mounted for scripted post-processing).
        </li>
      </ul>

      <p>
        Deliberately out of scope for now: generative <strong>video</strong>{" "}
        (the natural next surface, and a separate package when it lands),
        fine-tuning and LoRA training, upscaling models, CDN and serving
        concerns, and estimating costs for providers that do not report them.
      </p>

      <p>
        Related reading:{" "}
        <a href="/docs/working-environment">Working Environment</a> for pixel-level
        batch work (<code>env:images</code>) and video rendering (
        <code>env:motion</code>) · <a href="/docs/core">Core API</a> for the
        tool and permission model · <a href="/docs/glovebox">Glovebox</a> for
        shipping an image agent as a sandboxed service.
      </p>
    </div>
  );
}
