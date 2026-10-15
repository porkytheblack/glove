import { CodeBlock } from "@/components/code-block";
import { docsMetadata } from "@/lib/docs-nav";

export const metadata = docsMetadata("/docs/v4");

export default function V4ReleaseNotesPage() {
  return (
    <div className="docs-content">
      <h1>Glove v4 release notes</h1>

      <p>
        <code>glove-core</code> 4.0.0 changes where live state reaches the
        model. Goals, forms and pinned context no longer rewrite the system
        prompt: they are resolved by <strong>runtime context providers</strong>{" "}
        before each model iteration and appended at the model-input tail, as
        transient snapshots that never enter saved conversation history. That
        is the one breaking change in v4, and it only affects custom runnables,
        custom builders and exhaustive subscriber handlers.
      </p>

      <p>
        4.1, 4.2 and 4.3 are minor releases on top: Foundry&apos;s production
        controls and native goals, facts and forms; browser and sandbox mounts
        with Station 3 as the first backend; and the Vercel AI Gateway as a
        built-in provider. The current release is <strong>4.3.0</strong>. The
        other Glove packages are versioned independently.
      </p>

      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Highlights</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <a href="#breaking">4.0.0</a>
            </td>
            <td>
              Live runtime context at the model-input tail. Breaking for custom{" "}
              <code>IGloveRunnable</code> / <code>IGloveBuilder</code>{" "}
              implementations and exhaustive subscriber handlers.
            </td>
          </tr>
          <tr>
            <td>
              <a href="#v4-1">4.1.0</a>
            </td>
            <td>
              Foundry production controls; lazy goals, facts and forms;
              durable SQLite memory adapters; an interactive project
              initializer; MCP stdio transport.
            </td>
          </tr>
          <tr>
            <td>
              <a href="#v4-2">4.2.0</a>
            </td>
            <td>
              Browser scripting and persistent sandbox mounts (Station 3);
              runtime context accepts content parts as well as text.
            </td>
          </tr>
          <tr>
            <td>
              <a href="#v4-3">4.3.0</a>
            </td>
            <td>Vercel AI Gateway provider.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="breaking">Breaking change in 4.0</h2>

      <p>
        Changing memory state stays out of system prompts. Before each
        iteration, core resolves every registered context provider and appends
        the results at the tail of the model input, after stored history and
        complete tool-result bundles. Saved conversation history is not
        changed, and the resolved snapshots are exposed to tracing. Goals,
        forms and pinned context all use this mechanism. Realtime voice injects
        changed snapshots silently at startup and after tools, with an explicit
        refresh for external changes (see{" "}
        <a href="/docs/realtime-voice#live-context">Keeping a live session current</a>
        ).
      </p>

      <p>
        Your own application state can use the same channel. A provider returns
        the current state, or <code>null</code> / <code>undefined</code> when it
        has nothing to add, and registration returns a function that removes it:
      </p>

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`const removeContext = agent.addContextProvider(async (signal) => {
  const order = await loadOrder(orderId, signal);
  return order ? \`Order \${order.id} is \${order.status}.\` : null;
});

// Later, when the state no longer applies:
removeContext();`}
      />

      <h3 id="migration">Migrating from v3</h3>

      <p>
        The standard <code>Glove</code> class implements everything below. You
        only have work to do if you wrote one of these yourself:
      </p>

      <ol>
        <li>
          <strong>Custom <code>IGloveRunnable</code>.</strong> Implement{" "}
          <code>addContextProvider(provider)</code>, which returns an
          unregister function, and <code>getRuntimeContext(signal?)</code>,
          which resolves to the current snapshot messages. A wrapper around
          another runnable can forward both:
          <CodeBlock
            filename="runnable-proxy.ts"
            language="typescript"
            code={`import type { IGloveRunnable } from "glove-core";

// Spread into a wrapper that delegates to an inner runnable.
export function forwardRuntimeContext(
  inner: IGloveRunnable,
): Pick<IGloveRunnable, "addContextProvider" | "getRuntimeContext"> {
  return {
    addContextProvider: (provider) => inner.addContextProvider(provider),
    getRuntimeContext: (signal) => inner.getRuntimeContext(signal),
  };
}`}
          />
        </li>
        <li>
          <strong>Custom <code>IGloveBuilder</code>.</strong> Implement{" "}
          <code>addContextProvider</code> with the same signature.
        </li>
        <li>
          <strong>Exhaustive subscriber handlers.</strong> Handle the new{" "}
          <code>runtime_context</code> event. Its data is{" "}
          <code>{"{ messages: Message[] }"}</code>: the resolved snapshots,
          outside persisted history.
        </li>
        <li>
          <strong>Goals, forms and pinned context are live snapshots.</strong>{" "}
          They are appended at the model-input tail on every iteration, not
          written into the system prompt. Anything that expected to find that
          state in the system prompt or in saved history should read the{" "}
          <code>runtime_context</code> snapshots instead.
        </li>
      </ol>

      <p>
        4.0.0 also preserves real user-turn boundaries when runtime context,
        inbox reminders, skills or compaction markers are present. Current-turn
        tool results stay full, pending reminders are appended after complete
        tool-result bundles, and structured image and video content survives
        when the OpenAI-compatible, OpenRouter and MiMo adapters merge adjacent
        user messages.
      </p>

      <h2 id="v4-1">4.1</h2>

      <ul>
        <li>
          <strong>Foundry production controls.</strong>{" "}
          <a href="/foundry">Glove Foundry</a> now builds on the core
          runtime-context and multimodal contracts, and adds durable
          single-host data, authoritative conversation transcripts,
          adapter-owned HTTP authorization, expiring tool approvals,
          interrupt-and-restart steering and bounded programmatic tool
          composition.
        </li>
        <li>
          <strong>Goals, facts and forms in Foundry.</strong> First-class lazy
          goals, facts, forms and native context-provider fields, with typed
          execution handles, conversation or instance scoping, opt-in shared
          preparation and metadata-only inspector progress. The SQLite bundle
          gains durable goal and form adapters and fact saves protected by
          process-death-safe locks. See{" "}
          <a href="/docs/goal-oriented-agents">Goal-oriented agents</a> and{" "}
          <a href="/foundry/docs/guidance">Goals, facts &amp; forms in Foundry</a>.
        </li>
        <li>
          <strong>Durable memory.</strong> Opt-in{" "}
          <code>glove-memory/sqlite</code> adapters for entity, episodic,
          resource and pinned-context memory on Node 22.13+, with isolated
          namespaces, transactional writes, cross-process reads and corruption
          checks. The browser-safe entry points are unchanged.
        </li>
        <li>
          <strong>Project initializer.</strong>{" "}
          <code>npx glove-foundry init</code> is now an interactive initializer with
          target, starter and package-manager choices, a review before writing
          files, cancellation and optional dependency installation.
          Non-interactive flags still work for automation. It requires Node
          20.12+ (22.13+ is recommended for SQLite memory). See{" "}
          <a href="/foundry/docs/getting-started">Install &amp; CLI</a>.
        </li>
        <li>
          <strong>MCP.</strong> stdio transport, tool allowlists, sanitized
          resources and prompts, bounded timeouts, lease-safe child recycling,
          live tool refresh and deactivation cleanup. See{" "}
          <a href="/docs/mcp">MCP</a>.
        </li>
        <li>
          Core tool-registry updates are atomic, and Gemini keeps provider
          thought signatures across tool turns. Foundry requires Station 2.3.0
          or newer.
        </li>
      </ul>

      <h2 id="v4-2">4.2</h2>

      <ul>
        <li>
          <strong>Browser and sandbox mounts.</strong> Adapter-backed browser
          scripting and persistent sandbox mounts, with Station 3 as the first
          backend. They use the existing mount approach and add no browser,
          sandbox or Station dependencies to <code>glove-core</code>. Retained
          browser scopes and a portable UTF-8 sandbox <code>writeText</code>{" "}
          ship with them. See <a href="/docs/execution">Browsers &amp; Sandboxes</a>.
        </li>
        <li>
          <strong>Multimodal runtime context.</strong> Context providers can
          return portable content parts as well as text. Browser mounts use
          this channel without replacing the agent&apos;s model, and media
          bytes and URLs are left out of <code>runtime_context</code>{" "}
          telemetry.
        </li>
        <li>
          <strong>Foundry and Station.</strong> Agent jobs move into a separate
          managed Station daemon process, and Foundry now requires Node 22+.
          An optional application-level <code>stationDaemon</code> setting lets
          that daemon host browser and sandbox provider adapters alongside
          agent jobs. Mounts can register cleanup with Foundry. See{" "}
          <a href="/foundry/docs/browser-and-sandbox">Browser &amp; sandbox
          agent</a>.
        </li>
        <li>
          Scheduled activation transitions are serialized, so a pause, update
          or cancellation can no longer be overwritten by a stale dispatch or
          completion write.
        </li>
      </ul>

      <h2 id="v4-3">4.3</h2>

      <p>
        The <strong>Vercel AI Gateway</strong> is a built-in provider. It routes
        through <code>https://ai-gateway.vercel.sh/v1</code> using{" "}
        <code>AI_GATEWAY_API_KEY</code>, and inside a Vercel deployment falls
        back to the injected <code>VERCEL_OIDC_TOKEN</code>. With{" "}
        <code>cache</code> enabled, <code>cache_control</code> breakpoints are
        placed at the message level so they reach Anthropic models upstream.{" "}
        <code>createChatHandler({"{ provider: \"vercel\" }"})</code> in{" "}
        <code>glove-next</code> works the same way.
      </p>

      <CodeBlock
        filename="model.ts"
        language="typescript"
        code={`import { createAdapter } from "glove-core/models/providers";

const model = createAdapter({
  provider: "vercel",
  model: "anthropic/claude-sonnet-4",
  cache: true,
});`}
      />

      <p>
        <code>ProviderDef</code> gains an optional <code>fallbackEnvVars</code>{" "}
        list, and the new <code>resolveProviderApiKey(def)</code> helper reads{" "}
        <code>envVar</code> first, then each fallback in order. See{" "}
        <a href="/docs/core#providers">Providers</a>.
      </p>

      <h2 id="read-more">Where to read more</h2>

      <ul>
        <li>
          <a href="/blog/fresh-context-in-the-agent-loop">
            Fresh context belongs inside the agent loop
          </a>{" "}
          — why v4 moved live state out of the system prompt.
        </li>
        <li>
          <a href="/docs/memory">Memory</a> — pinned context, forms and goals
          as context providers.
        </li>
        <li>
          <a href="/docs/v3">v3.0.0 release notes</a> — the previous major
          release.
        </li>
        <li>
          <a
            href="https://github.com/porkytheblack/glove/blob/main/packages/glove/CHANGELOG.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            glove-core CHANGELOG on GitHub
          </a>{" "}
          — full per-version history.
        </li>
      </ul>
    </div>
  );
}
