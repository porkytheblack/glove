import { CodeBlock } from "@/components/code-block";
import { BlogPostHeader } from "@/components/blog-post-header";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("silent-failures")!;

export const metadata = postMetadata(post);

export default async function Post() {
  return (
    <div className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        The working environment learned to make things that move. Getting there
        took six diagnostic rounds, and every single failure reported success —
        a video that renders one frame ninety times, a still that captures the
        moment before the animation starts, a build that passes locally and
        fails in CI. None of them threw. Here is what each one changed.
      </p>

      <p>
        A silent failure is worse than a crash by roughly the cost of finding
        it. A crash names a file and a line. A render that produces ninety
        identical frames produces a valid mp4, a plausible file size, and a
        success message — and the only way to know is to watch it. Most of the
        work described below is not the feature. It is moving each of these
        failures to the earliest point where something could still be done about
        it.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="routes">First: a fourth way in</h2>

      <p>
        The <a href="/docs/working-environment">working environment</a> exposes
        host libraries to agent scripts through three routes, picked by the
        shape of the library: <code>defineAdapter</code> for anything doing I/O,{" "}
        <code>defineBuilder</code> for stateful builder APIs, and{" "}
        <code>definePureModule</code> for synchronous computation.
      </p>

      <p>
        All three assume a <em>library</em>. There was no route for a{" "}
        <em>capability</em> — an MCP server, a model, an HTTP API — and the
        difference turns out to be economic rather than aesthetic.
      </p>

      <p>
        Consider checking a forty-page PDF for visual defects. As a{" "}
        <strong>verb</strong>, <code>view_image</code> costs one tool call per
        page and every answer lands in the context window: forty round trips,
        and a conversation buried under forty paragraphs about page margins. As
        a <strong>function</strong> a script can call, it is a loop:
      </p>

      <CodeBlock
        filename="/scripts/check-pages.js"
        language="javascript"
        code={`import { rasterize } from 'env:render';
import { look } from 'env:vision';

const { pages } = await rasterize('/out/report.pdf', '/tmp/pages');
const bad = [];
for (const p of pages) {
  const answer = await look({ path: p.path, prompt: 'Is any text cut off at the page edge?' });
  if (/yes/i.test(answer)) bad.push(p.page);
}
return bad.length ? \`clipped text on pages \${bad.join(', ')}\` : 'all pages clean';`}
      />

      <p>
        Forty answers land in a variable. One line comes back.{" "}
        <code>defineTools</code> is the fourth route, and it takes the same{" "}
        <code>ToolFn</code> catalog <code>glove-scratchpad</code> already used —
        so <code>fnsFromMcp(conn)</code> produces the list directly, and an MCP
        server becomes an importable module with no adapter written at all.
      </p>

      <div className="blog-note">
        <strong>The decision underneath.</strong> A verb and a function are the
        same capability with different economics, and the right choice depends
        on how many times it gets called. Rather than pick, mount both: the same
        vision model appears as <code>view_image</code> for spot-checking one
        page and as <code>env:vision</code> for looping over forty.
      </div>

      {/* ---------------------------------------------------------------- */}
      <h2 id="present">Writing a file is not delivering it</h2>

      <p>
        By the end of a real task, <code>/out</code> holds the report, the
        superseded draft of the report, and the intermediate workbook that fed
        it. Only the agent knows which was the answer. Every host was left
        guessing from filenames and timestamps.
      </p>

      <p>
        <code>present</code> is the explicit hand-off — one call per finished
        artifact, with a caption, refused for any path outside <code>/out</code>
        . It only exists when the host wires <code>onPresent</code>; without
        that the verb is absent from the tool set entirely, which is the rule
        the environment already applied to <code>view_image</code>. An agent is
        never shown a capability that would fail on use.
      </p>

      <p>
        There is a tail to this that only appeared later. <code>present</code>{" "}
        reports a media type, and the media type is what a host uses to decide
        between a player and a download prompt. It knew about PDFs, decks,
        workbooks and images. When the environment learned to render video, an
        mp4 arrived as <code>application/octet-stream</code> — an opaque blob,
        delivered successfully.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="time">Time has to be replaced, not measured</h2>

      <p>
        The environment could already produce a PDF, a deck, a workbook and a
        resized image. It could not produce anything that <em>moves</em>. The
        reason was never the encoder — ffmpeg has been in{" "}
        <code>env:media</code> for a while. It was that nothing could draw a
        frame.
      </p>

      <p>
        A browser can draw frames, and that is the whole problem. A browser
        animation is a function of wall-clock time. Screenshot the same scene
        twice and you get two different pictures; a renderer that fell behind by
        4ms emits a frame from the wrong moment. For video, where frame{" "}
        <em>N</em> must be exactly <em>N</em>, neither is acceptable.
      </p>

      <p>
        So <code>env:motion</code> does not measure time. It{" "}
        <strong>replaces</strong> it. Before any scene code runs,{" "}
        <code>requestAnimationFrame</code> becomes a queue nobody drains except
        the renderer, and <code>performance.now()</code> and{" "}
        <code>Date.now()</code> return a number the renderer sets. One advance
        is one frame.
      </p>

      <p>
        Measured: two independent runs of the same 60-frame scene produce
        byte-identical PNGs for every frame. That is what makes a re-render
        after an edit a real diff, and it is the property everything else is
        built on.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="five">Five ways a scene renders frame 1 forever</h2>

      <p>
        The goal was React Native Reanimated scenes rendering unchanged — real
        motion code, not a reimplementation. Five things stood in the way. Each
        one produces the identical symptom: the first frame renders, nothing
        moves, no error, nothing to grep for.
      </p>

      <table>
        <thead>
          <tr>
            <th>What went wrong</th>
            <th>Why it is silent</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Worklets need the Babel plugin, and esbuild does not run Babel</td>
            <td>
              <code>useAnimatedStyle(() =&gt; …)</code> compiles to a perfectly
              valid closure that nothing ever calls
            </td>
          </tr>
          <tr>
            <td>
              The plugin&apos;s preset calls <code>api.assertVersion(7)</code>
            </td>
            <td>
              Under Babel 8 it fails with a message about the wrong thing
              entirely
            </td>
          </tr>
          <tr>
            <td>
              <code>.web.js</code> must resolve before <code>.js</code>
            </td>
            <td>
              Otherwise the native runtime bundles and quietly does nothing in a
              browser
            </td>
          </tr>
          <tr>
            <td>The clock shim must install before the bundle</td>
            <td>
              Install it after and the scene captured the real clock on the way
              past
            </td>
          </tr>
          <tr>
            <td>
              <code>page.setContent()</code> does not run{" "}
              <code>addInitScript</code>
            </td>
            <td>
              Only navigation does. The shim is simply absent, and the scene
              reads an undefined frame
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        That last one cost the most and is worth stating plainly, because it is
        not in any of the obvious places: in Playwright,{" "}
        <strong>
          <code>addInitScript</code> runs on navigation, not on{" "}
          <code>setContent</code>
        </strong>
        . The fix is to write the page to disk and reach it with{" "}
        <code>goto(pathToFileURL(...))</code>. It was confirmed by probing
        directly — the globals are absent after <code>setContent</code> and
        present after <code>goto</code> — rather than by reasoning about it,
        which is the only way to settle a question like that.
      </p>

      <div className="blog-note">
        <strong>Where they live now.</strong> Not one of these is host
        configuration. The package owns Babel, the presets, React and ffmpeg as{" "}
        <em>dependencies</em>, resolves the host&apos;s copy first and its own
        second, and fixes the resolution and init order internally. A host
        cannot hold it wrong because there is nothing to hold. The only genuine
        opt-in left is <code>react-native-reanimated</code> itself.
      </div>

      {/* ---------------------------------------------------------------- */}
      <h2 id="mode">Deleting the switch that was always set wrong</h2>

      <p>
        Scenes come in two shapes. A <code>useFrame()</code> scene is a pure
        function of the frame number. A Reanimated scene is driven by its own
        clock. The first design asked the caller which one they had.
      </p>

      <p>
        Picking wrong produced a valid video of a still image — the sixth silent
        failure, and this one was self-inflicted. The fix was to stop asking:
        the renderer advances <em>both</em> signals on every frame, and each
        signal is inert for the other kind of scene. Any scene animates with no
        configuration, and the two stay consistent by construction, because
        frame <em>f</em> is always <em>t = f/fps</em>.
      </p>

      <CodeBlock
        filename="capture.ts"
        language="typescript"
        code={`// Both signals, every frame. A clock-driven scene ignores setFrame;
// a frame-driven scene ignores the clock. Neither has to be declared —
// "auto" is the default, and mode survives only as an override.
const drive = async (f: number) => {
  if (options.mode !== "clock") await setFrame(f);
  if (options.mode !== "frame") await advance(f === 0 ? 0 : step);
  await settle();
};`}
      />

      <p>
        Removing the switch also fixed a bug nobody had reported yet. Stills
        were implemented as &ldquo;render frame N&rdquo;, which for a
        clock-driven scene meant screenshotting before the animation had moved —
        so a Reanimated still always captured the initial state. Now a
        frame-driven scene is <em>jumped</em> straight to the requested frame
        and a clock-driven one is <em>walked</em> there without intermediate
        screenshots. Spot-checking frame 90 is cheap either way, and correct
        either way.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="refuse">Refuse early, and name the fix</h2>

      <p>
        Every frame is a browser screenshot — about 330ms. A ten-second clip at
        30fps is 300 frames. The environment&apos;s default script budget is 30
        seconds, so the first honest render died at the timeout with a generic
        message, four minutes of work discarded.
      </p>

      <p>
        Raising the default would be wrong: a 30-second ceiling is right for a
        script that reads a spreadsheet. Instead the adapter reads the
        environment&apos;s own <code>runTimeoutMs</code>, estimates the render
        before starting it, and refuses up front with the exact line to add:
      </p>

      <CodeBlock
        filename="terminal"
        language="text"
        code={`env:motion.render: a 300-frame render needs roughly 119s — a browser launch,
then a screenshot per frame — but this environment's script budget
(limits.runTimeoutMs) is 30s, so it would be killed mid-render. Create the
environment with limits: { runTimeoutMs: 180000 } (this package exports
MOTION_LIMITS as a good default), or render fewer frames.`}
      />

      <p>
        The same principle produced <code>glove-motion-doctor</code>. Whether a
        host can render at all depends on a browser it may not have, and
        discovering that by burning a render is the expensive way to find out.
        One diagnosis is published on three surfaces: a CLI for the developer
        with a fix command per failing row, <code>capabilities()</code> for the
        agent at runtime, and an &ldquo;on this host&rdquo; section in the
        generated <code>/std/motion/README.md</code> the agent reads before it
        writes anything.
      </p>

      <CodeBlock
        filename="terminal"
        language="text"
        code={`$ pnpm exec glove-motion-doctor
✓ browser     /opt/pw-browsers/chromium-1194/chrome-linux/chrome
✓ ffmpeg      bundled with the package (…/@ffmpeg-installer/linux-x64/ffmpeg)
✓ react       bundled with glove-env-motion — no install needed
✓ reanimated  installed with react-native-web and the worklets plugin — React Native motion code renders here

ready — env:motion can render on this host`}
      />

      {/* ---------------------------------------------------------------- */}
      <h2 id="platform">The check that only passed on Linux</h2>

      <p>
        Browser and ffmpeg discovery was written on Linux, for Linux —{" "}
        <code>/usr/bin</code>, a snap path, an ELF binary. It would have failed
        on every developer machine running macOS.
      </p>

      <p>
        The fix is ordinary — check <code>/Applications</code> on macOS, Program
        Files and LOCALAPPDATA on Windows — but the testable version is not.
        Discovery is <strong>parameterized by platform</strong> rather than
        reading <code>process.platform</code> internally, so Linux CI can assert
        that the macOS candidate list contains the right paths. A cross-platform
        code path that can only be exercised on the platform it was written for
        is not covered; it is just untested in a way nobody notices.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="zones">One gateway, every surface</h2>

      <p>
        Separately: hosts wanted to hand an agent reference material — a corpus,
        a real source tree — that it can read and grep but never edit.
      </p>

      <p>
        The implementation question was where to enforce it, and the answer had
        already been decided by an earlier design choice. Every mutation in the
        environment goes through one function, <code>assertMutable</code>. Verbs
        go through it. Scripts using <code>env:fs</code> go through it. Stdlib
        adapter handles go through it. So <code>readOnlyPaths</code> is one
        check in one place, and it binds all of them at once — including{" "}
        <code>undo</code>, which would otherwise have been a side door.
      </p>

      <CodeBlock
        filename="env.ts"
        language="typescript"
        code={`const env = await createWorkingEnvironment({
  filesystem: hostDirectory("./project"),
  readOnlyPaths: ["/src"],          // read and grep the source; write only elsewhere
});

await env.mount("./handbook.pdf", "/corpus/handbook.pdf");   // the host door stays open`}
      />

      <p>
        Two deliberate asymmetries. <code>env.mount()</code> bypasses the check,
        because seeding content the agent can only read is the entire point of
        the option — while <code>env.fs</code>, the <em>guarded</em> host
        handle, obeys exactly the same rules as the model. And the zones are
        announced in the orientation file the agent reads at startup, so the
        boundary is learned by reading rather than by being refused. A refusal
        still carries the fix (<code>cp</code> it to <code>/tmp</code> and work
        on the copy), but it should be the second way an agent finds out, not
        the first.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="example">The example is where the wiring gets tested</h2>

      <p>
        <a href="https://github.com/porkytheblack/glove/tree/main/examples/document-desk">
          <code>examples/document-desk</code>
        </a>{" "}
        is an agent with a real working environment: upload documents, ask for
        something, watch the code it writes. It now mounts <code>env:motion</code>{" "}
        alongside the six document adapters — which immediately surfaced three
        things that were invisible while motion lived only in its own test
        suite.
      </p>

      <p>
        The <strong>media type</strong> gap above, found because a rendered mp4
        arrived as an opaque blob. The <strong>budget</strong>, because the
        desk&apos;s 60-second script ceiling was generous for a PDF and far too
        small for a render — so every render was refused, correctly and
        uselessly, until the ceiling became <code>MOTION_LIMITS</code>. And the
        obvious one: a video you cannot watch is not a deliverable. A presented
        video or image now plays inline in the transcript, and the file explorer
        previews both instead of offering a download.
      </p>

      <p>
        There is also a check that needs no model and no API key, because a
        render is the one capability here that depends on something outside the
        repo:
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm --filter glove-document-desk check:motion
# doctor rows, then a real mp4 on disk — 90 frames at 960x540 in 14.2s`}
      />

      <p>
        Driven by an actual model, the round trip is more convincing than the
        numbers. Asked for an animated revenue counter, the agent wrote the
        scene, rendered it, then wrote a <em>second</em> script to render frame
        60 and confirm the count had reached the right figure — checking its own
        work, unprompted, because the environment&apos;s skills tell it to.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="codecs">A black rectangle with working controls</h2>

      <p>
        One more, found while screenshotting that UI. The player showed a black
        rectangle. The controls worked. The duration was correct. No error
        anywhere.
      </p>

      <p>
        The mp4 was fine —{" "}
        <code>ffprobe</code> confirmed a valid H.264 stream. The <em>browser</em>{" "}
        could not decode it: Chromium builds without proprietary codecs,
        including the one <code>playwright-core install</code> puts on disk, have
        no H.264 decoder. <code>canPlayType(&apos;video/mp4; codecs=&quot;avc1.42E01E&quot;&apos;)</code>{" "}
        returns an empty string there and{" "}
        <code>&quot;probably&quot;</code> for VP9.
      </p>

      <p>
        Chrome, Edge, Safari and Firefox all play it, so mp4 remains the right
        default for anything a person opens — but if you preview a render in a
        bare Chromium and get a black box, the file is not the problem. Render{" "}
        <code>.webm</code> there. It is now written down in three places,
        because the next person to hit it will have no reason to suspect the
        browser.
      </p>

      <div className="blog-note">
        <strong>A correction worth recording.</strong> The first fix for that
        black rectangle was a <code>#t=0.1</code> media fragment, complete with
        a confident comment explaining why it was load-bearing. It was not — the
        codec was. Measuring first would have cost less than the comment did,
        and a wrong explanation in a comment outlives the bug it was written
        for.
      </div>

      {/* ---------------------------------------------------------------- */}
      <h2 id="ci">The failure that belonged to nobody</h2>

      <p>
        The last one was not in any package. A site build passed locally and
        failed on Vercel, on a monorepo install that had been narrowed to the
        four projects the site actually needs.
      </p>

      <p>
        The site had never declared <code>@types/node</code>. It had been
        free-riding on a hoisted copy that some other workspace package pulled
        in — which is invisible while the whole monorepo installs together, and
        fatal the moment the install is scoped. The dependency was real, used on
        every build, and simply not written down.
      </p>

      <p>
        Worth generalising: an undeclared dependency is not a latent bug, it is
        a bug that happens to be masked. The masking is provided by an unrelated
        package&apos;s dependency list, which nobody has promised to keep
        stable.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="pattern">The pattern</h2>

      <p>
        Reading these back, the fixes are all the same fix applied at different
        distances from the user.
      </p>

      <table>
        <thead>
          <tr>
            <th>Failed at</th>
            <th>Now fails at</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Render time, silently (worklets, clock, resolution order)</td>
            <td>Never — the package owns the toolchain</td>
          </tr>
          <tr>
            <td>Render time, as a generic timeout</td>
            <td>Before the render starts, naming the limit to raise</td>
          </tr>
          <tr>
            <td>Render time, as a missing browser</td>
            <td>A doctor command, with the install line</td>
          </tr>
          <tr>
            <td>Whenever the caller guessed the mode wrong</td>
            <td>Never — there is no mode to guess</td>
          </tr>
          <tr>
            <td>The first write into a read-only zone</td>
            <td>Startup, in the orientation the agent reads</td>
          </tr>
          <tr>
            <td>A bad <code>readOnlyPaths</code> config, at run time</td>
            <td>Environment creation, to the host</td>
          </tr>
        </tbody>
      </table>

      <p>
        None of that makes the software do more. It moves each diagnosis to the
        earliest point where it is still actionable, and puts the fix in the
        message. For a system whose primary user is a model that cannot ask a
        colleague what went wrong, that is not polish. It is most of the
        interface.
      </p>

      <p>
        <a href="/docs/working-environment#motion">env:motion</a> ·{" "}
        <a href="/docs/working-environment#delivering">present</a> ·{" "}
        <a href="/docs/working-environment#routes">
          the four authoring routes
        </a>
      </p>
    </div>
  );
}
