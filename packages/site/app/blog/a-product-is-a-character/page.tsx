import { CodeBlock } from "@/components/code-block";
import { BlogPostHeader } from "@/components/blog-post-header";
import { getPost, postMetadata } from "@/lib/blog";
import { gallery } from "@/lib/gallery-data";

const post = getPost("a-product-is-a-character")!;

export const metadata = postMetadata(post);

/** Pull a shot from the generated gallery manifest so the post cannot drift
 *  from what was actually produced. */
const shot = (slug: string) => gallery.shots.find((s) => s.slug === slug)!;

const consistency = gallery.shots.filter((s) => s.set === "consistency");
const matrix = gallery.shots.filter((s) => s.set === "matrix");
const styles = gallery.shots.filter((s) => s.set === "style");
const tweaks = gallery.shots.filter((s) => s.set === "regenerate");

function Figure({
  slugs,
  caption,
  cols,
}: {
  slugs: string[];
  caption: string;
  cols?: 2 | 3 | 4 | 5;
}) {
  return (
    <figure className="blog-figure">
      <div className={`blog-figure-grid cols-${cols ?? slugs.length}`}>
        {slugs.map((slug) => {
          const s = shot(slug);
          return (
            <img
              key={slug}
              src={`/image-gallery/${s.file}`}
              alt={`${s.title} — ${s.intent}`}
              width={s.width}
              height={s.height}
              loading="lazy"
            />
          );
        })}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export default async function Post() {
  const hero = shot("consistency-kilimani-rooftop");
  const total = gallery.usage.total;

  return (
    <div className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        A single <code>generate_image(prompt)</code> tool works exactly once.
        The moment images become a repeated job — the same subject, the same
        product, ten different settings — it stops being a tool problem and
        starts being a workflow problem.
      </p>

      <Figure
        slugs={["consistency-kilimani-rooftop", "consistency-karura-forest", "consistency-maasai-market"]}
        cols={3}
        caption="Same model, same bag, three locations. Only one argument changed between these calls."
      />

      <p>
        A friend of mine runs a service in Nairobi: businesses send him their
        inventory, and he produces catalog imagery — the product worn or carried
        by a model, photographed around the city. Rooftops in Kilimani, the
        red-earth paths of Karura, the stalls at Maasai Market.
      </p>

      <p>
        It is a good business and a miserable workflow. Twenty items across five
        locations is a hundred setups, and each one is a fresh chance for the
        model&apos;s face to shift, the bag to change colour, or the light to
        stop matching the rest of the set. That is the problem{" "}
        <a href="/docs/image">
          <code>glove-image</code>
        </a>{" "}
        was built for.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="prompts">Prompts are built, not typed</h2>

      <p>
        The prompt that actually works is never the sentence a user says. It is
        their intent, <em>plus</em> the house style, <em>plus</em> the
        character&apos;s canonical description, <em>plus</em> the scene&apos;s
        palette, <em>plus</em> whatever rewriting the target model responds to.
        That is a pipeline with stages, and most implementations inline it into
        a template string and lose every intermediate state — including the
        reason the final prompt looks the way it does.
      </p>

      <p>
        So the pipeline is the primitive. An intent runs through ordered{" "}
        <em>inbetweens</em>, each a small named transform, each appending to a
        trace:
      </p>

      <CodeBlock
        filename="mount.ts"
        language="typescript"
        code={`await mountImage(glove, {
  adapter: openrouterImages(),
  assets, library,
  pipeline: [
    expandCharacters(),   // splice each character's canonical wording, verbatim
    expandScenes(),       // splice the setting block
    styleDirective("editorial catalog photography, natural daylight"),
    llmEnhance(),         // one rewrite pass — forbidden from touching identity wording
  ],
  // fitToModel() is always appended last.
});`}
      />

      <p>
        The last stage is the one that earns its place.{" "}
        <code>fitToModel()</code> reconciles the request against what the
        adapter actually supports — folding negatives into the prompt when the
        model has no negative slot, dropping reference roles it does not honour,
        snapping sizes, clamping candidates. Every one of those adjustments is
        written into the trace and handed back to the agent:
      </p>

      <CodeBlock
        filename="tool result"
        language="json"
        code={JSON.stringify(
          {
            assets: [{ id: "img_…", width: 1024, height: 1024 }],
            degradations: hero.trace.filter((t) => t.note).map((t) => `${t.enhancer}: ${t.note}`),
            usage: { requests: 1, cost_usd: hero.costUsd },
          },
          null,
          2,
        )}
      />

      <p>
        This matters more than it sounds. A model that silently receives fewer
        reference images than it asked for produces a confusing result and no
        explanation. Telling it what changed is the difference between a bug and
        a fact.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="characters">Consistency is repetition, not memory</h2>

      <p>
        &ldquo;Draw Mira again, but at the harbour&rdquo; only works if Mira is
        a durable thing. Not a phrase the model half-remembers from six turns
        ago — an actual record, with wording that does not move.
      </p>

      <CodeBlock
        filename="library.ts"
        language="typescript"
        code={`glove_image_character_save({
  name: "amara",
  appearance:
    "a Kenyan woman in her late 20s, warm dark brown skin, short natural afro, " +
    "delicate gold hoop earrings, wearing a fitted cream linen jumpsuit and tan sandals",
  notes: "House model, SS26 line.",   // never sent to the image model
  negative: "no sunglasses, no hat",
})`}
      />

      <p>
        That <code>appearance</code> paragraph is spliced into every prompt that
        names this character, <strong>word for word</strong>. The LLM rewrite
        pass is explicitly instructed not to touch it, because identity
        consistency dies in paraphrase — &ldquo;short natural afro&rdquo;
        rewritten to &ldquo;cropped curls&rdquo; is a different person.
      </p>

      <Figure
        slugs={consistency.map((s) => s.slug)}
        cols={5}
        caption="Five locations, five calls. The gold hoops, the cream linen, the tan sandals and the bag's burnt-orange band are not luck and not a seed — they are the same sentences arriving five times."
      />

      {/* ---------------------------------------------------------------- */}
      <h2 id="products">A product is a character too</h2>

      <p>
        Here is the part that took me a while to see. A character in this system
        is not &ldquo;a person&rdquo;. It is a <em>durable visual identity</em>:
        wording that must stay stable, reference images that anchor it, and
        negatives that fence off drift.
      </p>

      <p>
        A handwoven kiondo tote is exactly that. So is a beaded cuff. So is
        every item in a client&apos;s inventory. The packshot the business
        already sent becomes the product&apos;s identity reference, and the item
        joins the library beside the model:
      </p>

      <Figure
        slugs={["packshot-kiondo", "packshot-cuff"]}
        cols={2}
        caption="The client's inventory photos. In a real workflow these are imported, not generated — and pinned to a character as its identity anchor."
      />

      <CodeBlock
        filename="library.ts"
        language="typescript"
        code={`glove_image_character_save({
  name: "kiondo-tote",
  appearance:
    "a handwoven Kenyan kiondo tote bag in natural cream sisal with a band of " +
    "burnt-orange and black geometric pattern, tan leather handles and trim",
  ref_images: [{ asset: packshotId, label: "packshot" }],
})

// Then both, in one frame:
glove_image_generate({
  intent: "Amara walking, carrying the tote on her shoulder",
  characters: ["amara", "kiondo-tote"],
  scene: "kilimani-rooftop",
})`}
      />

      <p>
        Once products are characters, the catalog matrix collapses. Adding a
        second item is not a second project — it is another name in an array:
      </p>

      <Figure
        slugs={matrix.map((s) => s.slug)}
        cols={3}
        caption="A second inventory item across the same locations. Twenty items × five locations is a loop over two lists, not a hundred prompt-writing sessions."
      />

      {/* ---------------------------------------------------------------- */}
      <h2 id="recipes">Revisions should not re-derive the brief</h2>

      <p>
        Clients do not ask for new images. They ask for <em>the same image,
        but</em> — at dusk, in the rain, with the other colourway. If the only
        record of how a shot was made is the conversation that produced it, then
        every revision is a reconstruction.
      </p>

      <p>
        So every generated asset stores its own <code>Recipe</code>: the intent,
        the final prompt, the characters and scene, the refs, the full trace,
        and what it cost. &ldquo;Same but at dusk&rdquo; is then one call.
      </p>

      <CodeBlock
        filename="revision.ts"
        language="typescript"
        code={`glove_image_regenerate({ asset: "img_…", tweak: "at dusk, city lights just coming on" })`}
      />

      <Figure
        slugs={tweaks.map((s) => s.slug)}
        cols={2}
        caption="Two revisions of the rooftop shot. The recipe is replayed through the current pipeline — so if a character's definition was corrected in the meantime, the replay picks that up."
      />

      <p>
        The same logic covers house style. Identical intent, identical
        characters, identical scene — one line of the pipeline changes, and the
        catalog is re-shot for a different channel:
      </p>

      <Figure
        slugs={styles.map((s) => s.slug)}
        cols={4}
        caption="One styleDirective, four values: editorial, 35mm film, high-key studio, hand-painted gouache. Nothing else about the call changed."
      />

      {/* ---------------------------------------------------------------- */}
      <h2 id="cost">Know what it cost</h2>

      <p>
        Generation spends real money, and a service business needs to price a
        job before quoting it. Every model-touching call is metered — the
        generation, the LLM rewrite pass, any vision review — and attributed by
        source.
      </p>

      <p>
        The images on this page, and every other image in the{" "}
        <a href="/docs/image/gallery">gallery</a>, came from one scripted run:{" "}
        <strong>
          {gallery.shots.length} images for ${(total.cost_usd ?? 0).toFixed(2)}
        </strong>
        , about four cents each, with no hand-picking and no retries. The agent
        can read the same figures mid-conversation with{" "}
        <code>glove_image_usage</code>; a host can stream them into billing
        through an <code>onUsage</code> callback.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="limits">Where this stops working</h2>

      <div className="blog-note">
        <strong>These are approximations, not photographs.</strong> Woven,
        textile and craft goods hold up well — the images above are honest about
        what the pipeline produces. A product carrying an exact logo, a precise
        brand colourway, or fine hardware detail will <em>not</em> reproduce
        faithfully, even with its own packshot pinned as an identity reference.
        For those, treat the output as styling reference and shoot the hero
        frames properly.
      </div>

      <p>
        I would rather say that here than have someone discover it on a client
        job. The useful version of this tool is the one whose limits you know
        before you quote.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="try">Try it</h2>

      <CodeBlock filename="terminal" language="bash" code={`pnpm add glove-image`} />

      <p>
        The <a href="/docs/image">guide</a> covers the full design — pipeline
        internals, writing your own inbetween, reference roles, editing,
        assembly, the vision review loop, and the storage seams you replace in
        production. The <a href="/docs/image/gallery">gallery</a> shows every
        image with the prompt that produced it and a canvas drawing one
        image&apos;s real provenance. And{" "}
        <code>examples/image-studio</code> in the repo is a runnable
        art-director agent that does all of this from plain conversation.
      </p>

      <p>
        The obvious next thing is video. The package is deliberately scoped to
        stills for now.
      </p>
    </div>
  );
}
