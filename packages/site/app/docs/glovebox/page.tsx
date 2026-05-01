import { CodeBlock } from "@/components/code-block";

export default async function GloveboxPage() {
  return (
    <div className="docs-content">
      <h1>
        Glovebox{" "}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            marginLeft: 10,
            padding: "2px 8px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            borderRadius: 4,
            background: "rgba(94, 156, 211, 0.14)",
            color: "#5e9cd3",
            verticalAlign: "middle",
          }}
        >
          beta
        </span>
      </h1>

      <p
        style={{
          padding: "10px 14px",
          margin: "0 0 20px",
          borderLeft: "3px solid #5e9cd3",
          background: "rgba(94, 156, 211, 0.06)",
          fontSize: 14,
          color: "#5e9cd3",
        }}
      >
        Glovebox is in beta. The wire protocol and authoring API are stable
        for v1, but several pieces — JWT auth, multiplex prompt execution,
        hot reload, GCS/Azure storage adapters — are deferred to v2. Expect
        the surface to grow, not break.
      </p>

      <p>
        Glovebox packages a Glove agent as an isolated, network-addressable
        service. You write a Glove agent the way you always do — fold tools,
        wire a model adapter, build the runnable — then wrap it with{" "}
        <code>glovebox.wrap(runnable, config)</code> and run{" "}
        <code>glovebox build</code>. The output is a Dockerfile, a{" "}
        <code>nixpacks.toml</code>, a server bundle, a manifest, and an auth
        key. The deployed container exposes a single authenticated WebSocket
        endpoint per session; a matching client SDK speaks to it over the wire.
      </p>

      <p>
        The point is to factor environment-heavy work out of your host
        process. Some agents need <code>ffmpeg</code>, or{" "}
        <code>pdftk</code>, or a headless Chromium, or a custom Python
        toolchain. Bundling all that into the same Node process that serves
        your web app is impractical: cold starts balloon, the container needs
        elevated capabilities, and a single misbehaving agent can drag down
        every other request. Glovebox keeps that machinery in a dedicated
        sandbox and gives the host a thin client to talk to it.
      </p>

      {/* ================================================================== */}
      <h2>The three packages</h2>

      <p>
        Glovebox is shipped as three coordinated packages. Each one solves a
        single piece of the lifecycle:
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Where it runs</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>glovebox</code></td>
            <td>Author&apos;s machine / build step</td>
            <td>
              Authoring kit and <code>glovebox build</code> CLI. Exposes{" "}
              <code>glovebox.wrap</code>, the storage policy DSL
              (<code>rule.*</code> / <code>composite</code>), and the wire
              types every side shares.
            </td>
          </tr>
          <tr>
            <td><code>glovebox-kit</code></td>
            <td>Inside the container</td>
            <td>
              The runtime. Reads the wrapped app, validates env + storage
              policy, injects the standard skills/hooks, mounts the WS
              endpoint, and serves the file routes.
            </td>
          </tr>
          <tr>
            <td><code>glovebox-client</code></td>
            <td>Caller (host app, CLI, worker, …)</td>
            <td>
              <code>GloveboxClient</code> + <code>Box</code> SDK. Manages the
              WebSocket, multiplexes prompts, marshals input/output{" "}
              <code>FileRef</code>s through pluggable client storage.
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        The protocol — defined in <code>glovebox/protocol</code> — is the
        only contract between them. Anything else is private to the side
        that ships it.
      </p>

      {/* ================================================================== */}
      <h2>Authoring</h2>

      <p>
        A Glovebox app is an ordinary Glove runnable handed to{" "}
        <code>glovebox.wrap</code>. The wrap call is opaque from your
        perspective — the kit reads it at boot to discover the runnable and
        the resolved config, then layers its own injections on top. The
        runnable still exposes the usual <code>processRequest</code>,{" "}
        <code>defineSkill</code>, <code>defineHook</code>, and{" "}
        <code>addSubscriber</code> surface.
      </p>

      <CodeBlock
        filename="glovebox.ts"
        language="typescript"
        code={`import { glovebox, rule, composite } from "glovebox-core";
import { agent } from "./my-agent";

export default glovebox.wrap(agent, {
  name: "media-extractor",
  version: "0.1.0",
  base: "glovebox/media",
  packages: {
    apt: ["jq"],
    npm: ["yt-dlp-exec"],
  },
  env: {
    OPENAI_API_KEY: { required: true, secret: true },
  },
  storage: {
    inputs: composite([rule.url(), rule.inline()]),
    outputs: composite([
      rule.inline({ below: "1MB" }),
      rule.localServer({ ttl: "1h" }),
    ]),
  },
  limits: { cpu: "2", memory: "2Gi", timeout: "5m" },
});`}
      />

      <p>
        Every field is optional. Omit <code>base</code> and you get{" "}
        <code>glovebox/base</code>. Omit <code>storage</code> and the
        defaults apply: <code>url</code> then <code>inline</code> for
        inputs, inline-under-1MB then <code>localServer</code> with a
        one-hour TTL for outputs. The <code>fs</code> map defaults to{" "}
        <code>/work</code> (writable), <code>/input</code> (read-only),
        and <code>/output</code> (writable) — the same layout the base
        images set up.
      </p>

      <h3>Storage policy DSL</h3>

      <p>
        Storage policies decide how each <code>FileRef</code> is materialised.
        Inputs are how the client hands bytes to the agent; outputs are how
        the agent hands bytes back. The DSL is intentionally tiny — four
        rule constructors and a <code>composite</code> combiner. Rules are
        evaluated in declaration order; the first match wins.
      </p>

      <CodeBlock
        filename="storage policies"
        language="typescript"
        code={`import { rule, composite } from "glovebox-core";

// Outputs: tiny files inline, anything bigger goes to S3.
composite([
  rule.inline({ below: "256KB" }),
  rule.s3({ bucket: "agent-outputs", region: "us-east-1", prefix: "v1/" }),
]);

// Inputs: prefer URLs (no bytes on the wire), fall back to inline.
composite([rule.url(), rule.inline()]);

// Outputs: keep small reports inline, ship larger artefacts via the
// container's own /files/:id route with a 24h TTL.
composite([
  rule.inline({ below: "1MB" }),
  rule.localServer({ ttl: "24h" }),
]);`}
      />

      <p>
        Each rule&apos;s <code>below</code> / <code>above</code> bounds
        accept human-readable sizes (<code>B</code>, <code>KB</code>,{" "}
        <code>MB</code>, <code>GB</code>). The kit validates the outputs
        policy at boot — every referenced adapter must be registered, and
        the policy must include a terminal rule (no bound, or marked{" "}
        <code>always</code>) so every file size has a home. The{" "}
        <code>url</code> adapter is read-only; pointing an outputs rule at
        it fails fast.
      </p>

      {/* ================================================================== */}
      <h2>Building</h2>

      <p>
        <code>glovebox build</code> imports your wrap module, reads the
        resolved config, and emits a self-contained <code>dist/</code>{" "}
        directory. There is no other build step — no manual Dockerfile, no
        hand-tuned <code>nixpacks.toml</code>, no separate manifest to keep
        in sync.
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm exec glovebox build ./glovebox.ts
# or with overrides
pnpm exec glovebox build ./glovebox.ts --out ./dist --name media-extractor`}
      />

      <p>What ends up in <code>dist/</code>:</p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>Dockerfile</code></td>
            <td>
              <code>FROM</code> the resolved base image, layers in declared
              apt/pip/npm packages, copies the bundled server, links the
              prebuilt <code>better-sqlite3</code> from the base for known
              images, and runs as the <code>glovebox</code> user on port
              8080.
            </td>
          </tr>
          <tr>
            <td><code>nixpacks.toml</code></td>
            <td>
              Equivalent recipe for Railway / Fly / any nixpacks host that
              prefers a buildpack to a raw Dockerfile.
            </td>
          </tr>
          <tr>
            <td><code>server/</code></td>
            <td>
              Esbuild-bundled entry: your wrap module, the kit, and a
              minimal launcher. Includes a copy of <code>glovebox.json</code>{" "}
              next to <code>index.js</code> so the runtime resolves it via{" "}
              <code>import.meta.url</code>.
            </td>
          </tr>
          <tr>
            <td><code>glovebox.json</code></td>
            <td>
              Manifest: name, version, base, fs layout, env spec, key
              fingerprint, full storage policy, packages, protocol version.
            </td>
          </tr>
          <tr>
            <td><code>glovebox.key</code></td>
            <td>
              Per-build bearer token. The container reads it via the{" "}
              <code>GLOVEBOX_KEY</code> env var; the kit verifies its
              fingerprint against the manifest at boot.
            </td>
          </tr>
          <tr>
            <td><code>.env.example</code></td>
            <td>
              Template populated from the <code>env</code> map in your wrap
              config (required vs optional, <code>secret</code> markers,
              defaults).
            </td>
          </tr>
        </tbody>
      </table>

      {/* ================================================================== */}
      <h2>The base images</h2>

      <p>
        Five published base images cover the workloads agents typically
        outgrow when run in-process. They all live under{" "}
        <code>ghcr.io/porkytheblack/</code>, ship the same{" "}
        <code>glovebox</code> user (uid 10001) and{" "}
        <code>/work</code> + <code>/input</code> + <code>/output</code> +{" "}
        <code>/var/glovebox</code> layout, and bake in the same prebuilt{" "}
        <code>better-sqlite3</code> at{" "}
        <code>/opt/glovebox-prebuilt/node_modules</code>.
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tag</th>
            <th>Ships</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>glovebox/base:1.0</code></td>
            <td>Node 20, the standard layout, prebuilt better-sqlite3.</td>
          </tr>
          <tr>
            <td><code>glovebox/media:1.4</code></td>
            <td><code>ffmpeg</code>, <code>imagemagick</code>, <code>sox</code>, <code>yt-dlp</code>.</td>
          </tr>
          <tr>
            <td><code>glovebox/docs:1.2</code></td>
            <td><code>pandoc</code>, <code>qpdf</code>, <code>pdftk-java</code>, headless LibreOffice.</td>
          </tr>
          <tr>
            <td><code>glovebox/python:1.3</code></td>
            <td><code>uv</code> with <code>numpy</code>, <code>pandas</code>, <code>pillow</code>, <code>scipy</code>, <code>matplotlib</code>.</td>
          </tr>
          <tr>
            <td><code>glovebox/browser:1.1</code></td>
            <td>Playwright + Chromium, fonts, system deps for headless runs.</td>
          </tr>
        </tbody>
      </table>

      <p>
        The build CLI resolves <code>glovebox/&lt;name&gt;</code> to the
        published tag automatically. Set <code>GLOVEBOX_REGISTRY</code> to
        point at a fork or private mirror; pass a fully-qualified reference
        (anything containing a colon, or anything not under{" "}
        <code>glovebox/</code>) and the resolver leaves it alone. Non-standard
        bases trigger a fallback path that does the user/layout setup itself
        and runs <code>npm install</code> instead of linking the prebuilt
        modules.
      </p>

      {/* ================================================================== */}
      <h2>The wire protocol</h2>

      <p>
        One WebSocket per client session, authenticated on upgrade with{" "}
        <code>Authorization: Bearer &lt;key&gt;</code>. Multiple prompts are
        multiplexed by an <code>id</code> the client picks. The full type
        definitions live in <code>glovebox/protocol</code>; the table below
        is the at-a-glance version.
      </p>

      <h3>Client → server</h3>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Message</th>
            <th>Shape</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>prompt</code></td>
            <td><code>{`{ id, text, inputs?, outputs_policy? }`}</code></td>
            <td>Start a turn. <code>inputs</code> is a name → <code>FileRef</code> map.</td>
          </tr>
          <tr>
            <td><code>abort</code></td>
            <td><code>{`{ id }`}</code></td>
            <td>Cancel an in-flight prompt by id.</td>
          </tr>
          <tr>
            <td><code>display_resolve</code></td>
            <td><code>{`{ slot_id, value }`}</code></td>
            <td>Resolve a server-pushed display slot.</td>
          </tr>
          <tr>
            <td><code>display_reject</code></td>
            <td><code>{`{ slot_id, error }`}</code></td>
            <td>Reject a server-pushed display slot.</td>
          </tr>
          <tr>
            <td><code>ping</code></td>
            <td><code>{`{ ts }`}</code></td>
            <td>Liveness check — server replies with a matching <code>pong</code>.</td>
          </tr>
        </tbody>
      </table>

      <h3>Server → client</h3>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Message</th>
            <th>Shape</th>
            <th>Carries</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>event</code></td>
            <td><code>{`{ id, event_type, data }`}</code></td>
            <td>Subscriber events (text deltas, tool uses, compaction). Mirrors glove-core 1:1.</td>
          </tr>
          <tr>
            <td><code>display_push</code></td>
            <td><code>{`{ slot }`}</code></td>
            <td>The agent pushed a display slot — caller renders it and resolves later.</td>
          </tr>
          <tr>
            <td><code>display_clear</code></td>
            <td><code>{`{ slot_id }`}</code></td>
            <td>The agent removed a slot.</td>
          </tr>
          <tr>
            <td><code>complete</code></td>
            <td><code>{`{ id, message, outputs }`}</code></td>
            <td>Final assistant text + the resolved outputs map.</td>
          </tr>
          <tr>
            <td><code>error</code></td>
            <td><code>{`{ id, error: { code, message } }`}</code></td>
            <td>Terminal failure for a specific prompt.</td>
          </tr>
        </tbody>
      </table>

      <p>
        Two HTTP routes live alongside the WebSocket:{" "}
        <code>GET /health</code> is public and returns{" "}
        <code>{`{ ok, name, version }`}</code>;{" "}
        <code>GET /environment</code> requires the bearer token and returns
        the manifest spec the client SDK&apos;s <code>box.environment()</code>{" "}
        consumes. Server-stored outputs are streamed by{" "}
        <code>GET /files/:id</code> (also bearer-authed); appending{" "}
        <code>?consume=1</code> deletes the file after read for one-shot
        downloads.
      </p>

      {/* ================================================================== */}
      <h2>FileRefs</h2>

      <p>
        Raw bytes never cross the wire as part of a protocol message. Every
        file is a discriminated <code>FileRef</code> the receiving side
        materialises through a storage adapter. Five kinds are defined; the
        kit ships built-in handlers for the first three.
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Carries</th>
            <th>Use for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>inline</code></td>
            <td>base64 bytes</td>
            <td>Small payloads (under ~1MB). Ships in the message itself.</td>
          </tr>
          <tr>
            <td><code>url</code></td>
            <td><code>url</code> + optional headers</td>
            <td>Public or pre-signed URLs the kit fetches at request time.</td>
          </tr>
          <tr>
            <td><code>server</code></td>
            <td><code>id</code> + <code>url</code></td>
            <td>Files stored on the box itself. Read via <code>GET /files/:id</code>.</td>
          </tr>
          <tr>
            <td><code>s3</code></td>
            <td><code>bucket</code> + <code>key</code> + optional <code>region</code></td>
            <td>Object storage. The S3 adapter requires caller-supplied upload/download functions.</td>
          </tr>
          <tr>
            <td><code>gcs</code></td>
            <td><code>bucket</code> + <code>object</code></td>
            <td>Google Cloud Storage. Same pattern as S3 — caller wires the SDK.</td>
          </tr>
        </tbody>
      </table>

      <p>
        On the kit side, adapters live behind the <code>StorageAdapter</code>{" "}
        interface (<code>InlineStorage</code>, <code>UrlStorage</code>,{" "}
        <code>LocalServerStorage</code>, <code>S3Storage</code>). Pass extra
        adapters into <code>startGlovebox({`{ adapters }`})</code> and they
        merge into the registry by name. The <code>pickAdapter</code>{" "}
        helper applies the policy rules in order and picks the first match
        for a given file size.
      </p>

      {/* ================================================================== */}
      <h2>Boot-time injections</h2>

      <p>
        Wrapping a runnable hands control to the kit at boot. Before the WS
        endpoint comes up, the kit layers four glovebox-flavored
        extensions onto your agent and prepends an environment block to the
        existing system prompt — once, statically. The agent code itself
        stays untouched.
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Extension</th>
            <th>Kind</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>environment</code></td>
            <td>Skill (exposed to agent)</td>
            <td>
              Returns the live spec — name, version, base, fs layout,
              installed packages, limits.
            </td>
          </tr>
          <tr>
            <td><code>workspace</code></td>
            <td>Skill (exposed to agent)</td>
            <td>
              Lists the current contents of every <code>fs</code> mount.
              Cheap way for the model to discover what landed in{" "}
              <code>/input</code>.
            </td>
          </tr>
          <tr>
            <td><code>/output</code></td>
            <td>Hook</td>
            <td>
              Tags an absolute path for exfiltration. Anything outside{" "}
              <code>/output</code> the agent wants to ship back to the
              caller goes through this.
            </td>
          </tr>
          <tr>
            <td><code>/clear-workspace</code></td>
            <td>Hook</td>
            <td>
              Empties <code>/work</code> between turns. Useful for
              deterministic, test-style prompts.
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        On <code>complete</code>, the kit lists <code>/output</code>, picks
        an adapter per file via the resolved policy, plus any extra paths
        the <code>/output</code> hook tagged during the turn. The resulting{" "}
        FileRefs land on the <code>complete</code> message&apos;s{" "}
        <code>outputs</code> field.
      </p>

      {/* ================================================================== */}
      <h2>Client SDK</h2>

      <p>
        <code>glovebox-client</code> is the host-side SDK. Construct one{" "}
        <code>GloveboxClient</code> per app, with one named entry per
        deployed glovebox. Boxes are lazy — the underlying WebSocket only
        opens on first <code>prompt</code>.
      </p>

      <CodeBlock
        filename="caller.ts"
        language="typescript"
        code={`import { GloveboxClient } from "glovebox-client";

const client = GloveboxClient.make({
  endpoints: {
    media: {
      url: "wss://media.example.com/run",
      key: process.env.GLOVEBOX_MEDIA_KEY!,
    },
  },
});

const box = client.box("media");

const result = box.prompt("Trim the first 30 seconds and add a watermark.", {
  files: {
    "input.mp4": { mime: "video/mp4", bytes: await readFile("./clip.mp4") },
  },
});

// Stream subscriber events as they arrive.
for await (const ev of result.events) {
  if (ev.event_type === "text_delta") {
    process.stdout.write((ev.data as { text: string }).text);
  }
}

// Resolve display slots the agent pushed during the turn.
for await (const ev of result.display) {
  if (ev.type === "push" && ev.slot?.renderer === "confirm") {
    result.resolve(ev.slot.id, true);
  }
}

await result.message;                     // final assistant text
const outputs = await result.outputs;     // Record<string, FileRef>
const trimmed = await result.read("trimmed.mp4");
await client.close();`}
      />

      <p>
        <code>events</code> and <code>display</code> are async iterables — a
        small queue per stream, closed when <code>complete</code> or{" "}
        <code>error</code> arrives. <code>message</code> and{" "}
        <code>outputs</code> are promises that settle on the same boundary.
        <code>read(name)</code> dispatches through the configured{" "}
        <code>ClientStorage</code>, which knows how to fetch{" "}
        <code>server</code> refs (with the bearer token), open{" "}
        <code>url</code> refs directly, and decode <code>inline</code> refs
        in place. <code>resolve</code> / <code>reject</code> /{" "}
        <code>abort</code> are fire-and-forget — failures surface through{" "}
        <code>box.onSendError(...)</code> if you wire a listener.
      </p>

      <p>
        <code>box.environment()</code> hits the bearer-authed{" "}
        <code>GET /environment</code> route once and caches the result. It
        is the right call when an app holds many endpoints and needs to pick
        one based on installed packages, the protocol version, or limits —
        nothing the developer-facing config encodes is hidden from the
        client.
      </p>

      {/* ================================================================== */}
      <h2>Deploying</h2>

      <p>
        The simplest path is a plain <code>docker run</code>. The image
        listens on 8080 and reads its key from the <code>GLOVEBOX_KEY</code>{" "}
        env var.
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`docker build -t my-glovebox dist/
GLOVEBOX_KEY=$(cat dist/glovebox.key) docker run \\
  -p 8080:8080 \\
  -e GLOVEBOX_KEY \\
  -e OPENAI_API_KEY \\
  my-glovebox`}
      />

      <p>
        Railway, Fly, and any other nixpacks-aware host pick up the
        generated <code>nixpacks.toml</code> instead. Push <code>dist/</code>{" "}
        as the deploy root, set <code>GLOVEBOX_KEY</code> plus whatever
        secrets your <code>env</code> map declared, and the platform builds
        the same layout. The pre-built base images are pulled from{" "}
        <code>ghcr.io/porkytheblack/glovebox/*</code> by default; a private
        mirror can be substituted via <code>GLOVEBOX_REGISTRY</code> at
        build time.
      </p>

      <p>
        Behind a load balancer, terminate TLS upstream and forward both the{" "}
        <code>HTTP/1.1 Upgrade</code> handshake and the WebSocket frames.
        Sessions are sticky to a single container — there is no
        cross-instance state.
      </p>

      {/* ================================================================== */}
      <h2>Limits and what&apos;s deferred to v2</h2>

      <p>
        v1 is intentionally narrow. A few things to know before you wire it
        into anything load-bearing:
      </p>

      <ul>
        <li>
          <strong>Prompts serialize per session.</strong> Glove&apos;s{" "}
          <code>PromptMachine</code> + <code>Context</code> are not
          concurrency-safe, so the kit chains prompts through a single
          promise per WS connection. Multiplex by opening multiple
          sessions; do not rely on parallel turns inside one.
        </li>
        <li>
          <strong>Auth is a static bearer key.</strong> JWT (with rotation,
          per-tenant claims, expiry) is on the v2 list. Today the build
          emits one key per artefact; rotate by rebuilding.
        </li>
        <li>
          <strong>No hot reload.</strong> Updating tools or the system
          prompt means a fresh build and a fresh deploy. The kit reads the
          manifest once at boot.
        </li>
        <li>
          <strong>Reconnect is best-effort.</strong> If the WebSocket
          drops, in-flight prompts reject and the SDK clears its state. v2
          will land resumable streams keyed by request id.
        </li>
        <li>
          <strong>S3 / GCS adapters are deferred.</strong> The kit ships the
          shapes and a thin <code>S3Storage</code> wrapper, but you supply
          the upload/download functions. This keeps the runtime image free
          of provider SDKs.
        </li>
      </ul>

      {/* ================================================================== */}
      <h2>See it in practice</h2>

      <p>
        The <a href="/docs/showcase/glovebox">Glovebox showcase</a> walks
        through a PDF-extraction agent end-to-end — wrap config, a
        representative tool, and the host-side invocation — built on top of{" "}
        <code>glovebox/docs:1.2</code>.
      </p>
    </div>
  );
}
