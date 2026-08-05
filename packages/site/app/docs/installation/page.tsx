import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Installation",
  description:
    "Which Glove packages to install for which shape of app, plus model providers and environment variables.",
};

export default function InstallationPage() {
  return (
    <div className="docs-content">
      <h1>Installation</h1>

      <p>
        Glove is a set of small packages rather than one framework install. You
        add the runtime, the binding for your UI, and whichever capability
        packages the app actually needs. Nothing else is pulled in.
      </p>

      <h2 id="requirements">Requirements</h2>

      <ul>
        <li>
          <strong>Node.js 18+</strong> (20+ recommended — several packages use
          the modern <code>fetch</code> and web streams).
        </li>
        <li>
          <strong>TypeScript 5+</strong>, ESM. Every package ships{" "}
          <code>&quot;type&quot;: &quot;module&quot;</code> with bundled types.
        </li>
        <li>
          <strong>zod</strong> — tool input schemas are Zod schemas. Install it
          alongside the runtime.
        </li>
        <li>
          <strong>An API key</strong> for at least one model provider, or a
          local runtime (Ollama / LM Studio) that needs none.
        </li>
      </ul>

      <h2 id="pick-your-shape">Pick your shape</h2>

      <p>
        Four common shapes. Pick the row that matches what you are building —
        the rest of the docs assume one of them.
      </p>

      <table>
        <thead>
          <tr>
            <th>Building</th>
            <th>Install</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Next.js app (App Router)</td>
            <td>
              <code>glove-react glove-next zod</code>
            </td>
          </tr>
          <tr>
            <td>React app with your own backend</td>
            <td>
              <code>glove-react zod</code> (+ <code>glove-core</code> on the
              server)
            </td>
          </tr>
          <tr>
            <td>Node service, CLI, or worker</td>
            <td>
              <code>glove-core zod</code>
            </td>
          </tr>
          <tr>
            <td>Voice</td>
            <td>
              add <code>glove-voice</code>, or <code>glove-voice-s2s</code> for
              realtime speech-to-speech
            </td>
          </tr>
        </tbody>
      </table>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`# Full-stack (Next.js)
pnpm add glove-react glove-next zod

# Server-only (Node / CLI / worker)
pnpm add glove-core zod

# npm and yarn work the same way
npm install glove-react glove-next zod`}
      />

      <p>
        <code>glove-core</code> is a dependency of <code>glove-react</code>, so
        a full-stack install already has the runtime. Install it explicitly when
        you import from it directly on the server.
      </p>

      <h2 id="capability-packages">Capability packages</h2>

      <p>
        Everything else is opt-in and installed the same way. Each one has its
        own page — this is the map.
      </p>

      <table>
        <thead>
          <tr>
            <th>Need</th>
            <th>Package</th>
            <th>Docs</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Long-term memory across sessions</td>
            <td>
              <code>glove-memory</code>
            </td>
            <td>
              <a href="/docs/memory">Memory</a>
            </td>
          </tr>
          <tr>
            <td>Many tools behind one SQL tool</td>
            <td>
              <code>glove-scratchpad</code>, <code>glove-sql</code>
            </td>
            <td>
              <a href="/docs/scratchpad">Scratchpad</a>
            </td>
          </tr>
          <tr>
            <td>Many tools behind one code-eval tool</td>
            <td>
              <code>glove-js</code>, <code>glove-python</code>,{" "}
              <code>glove-lisp</code>
            </td>
            <td>
              <a href="/docs/code-execution">Code Execution</a>
            </td>
          </tr>
          <tr>
            <td>A sandboxed filesystem the agent works in</td>
            <td>
              <code>glove-working-environment</code> + <code>glove-env-*</code>
            </td>
            <td>
              <a href="/docs/working-environment">Working Environment</a>
            </td>
          </tr>
          <tr>
            <td>A measured, enforced egress boundary</td>
            <td>
              <code>glove-egress</code>
            </td>
            <td>
              <a href="/docs/egress">Egress Control</a>
            </td>
          </tr>
          <tr>
            <td>External tool servers (Notion, Linear, Gmail…)</td>
            <td>
              <code>glove-mcp</code>
            </td>
            <td>
              <a href="/docs/mcp">MCP</a>
            </td>
          </tr>
          <tr>
            <td>Agents that message each other</td>
            <td>
              <code>glove-mesh</code>
            </td>
            <td>
              <a href="/docs/mesh">Mesh</a>
            </td>
          </tr>
          <tr>
            <td>Scheduled / supervised agent processes</td>
            <td>
              <code>glove-continuum-signal</code>
            </td>
            <td>
              <a href="/docs/continuum">Continuum</a>
            </td>
          </tr>
          <tr>
            <td>Voice — cascade pipeline</td>
            <td>
              <code>glove-voice</code>, <code>glove-voice-native</code>
            </td>
            <td>
              <a href="/docs/voice">Voice</a>
            </td>
          </tr>
          <tr>
            <td>Voice — realtime, avatars, LiveKit</td>
            <td>
              <code>glove-voice-s2s</code>, <code>glove-voice-avatar</code>,{" "}
              <code>glove-voice-livekit</code>
            </td>
            <td>
              <a href="/docs/realtime-voice">Realtime Voice</a>
            </td>
          </tr>
          <tr>
            <td>Ship the agent as a container</td>
            <td>
              <code>glovebox-core</code>, <code>glovebox-kit</code>,{" "}
              <code>glovebox-client</code>
            </td>
            <td>
              <a href="/docs/glovebox">Glovebox</a>
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="model-providers">Model providers</h2>

      <p>
        One adapter factory covers every provider. Pass the provider name and a
        model; the key is read from the environment.
      </p>

      <CodeBlock
        filename="lib/model.ts"
        language="typescript"
        code={`import { createAdapter } from "glove-core/models/providers";

export const model = createAdapter({
  provider: "anthropic",              // see the table below
  model: "claude-sonnet-4-20250514",
  stream: true,
});`}
      />

      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Env variable</th>
            <th>Default model</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>openai</code>
            </td>
            <td>
              <code>OPENAI_API_KEY</code>
            </td>
            <td>
              <code>gpt-4.1</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>anthropic</code>
            </td>
            <td>
              <code>ANTHROPIC_API_KEY</code>
            </td>
            <td>
              <code>claude-sonnet-4-20250514</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>openrouter</code>
            </td>
            <td>
              <code>OPENROUTER_API_KEY</code>
            </td>
            <td>
              <code>anthropic/claude-sonnet-4</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>gemini</code>
            </td>
            <td>
              <code>GEMINI_API_KEY</code>
            </td>
            <td>
              <code>gemini-2.5-flash</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>minimax</code>
            </td>
            <td>
              <code>MINIMAX_API_KEY</code>
            </td>
            <td>
              <code>MiniMax-M2.5</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>kimi</code>
            </td>
            <td>
              <code>MOONSHOT_API_KEY</code>
            </td>
            <td>
              <code>kimi-k2.5</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>glm</code>
            </td>
            <td>
              <code>ZHIPUAI_API_KEY</code>
            </td>
            <td>
              <code>glm-4-plus</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>mimo</code>
            </td>
            <td>
              <code>MIMO_API_KEY</code> (+ optional <code>MIMO_BASE_URL</code>)
            </td>
            <td>
              <code>mimo-v2.5</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>bedrock</code>
            </td>
            <td>
              <code>AWS_ACCESS_KEY_ID</code>
            </td>
            <td>
              <code>anthropic.claude-3-5-sonnet-20241022-v2:0</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>ollama</code>
            </td>
            <td>none</td>
            <td>you specify</td>
          </tr>
          <tr>
            <td>
              <code>lmstudio</code>
            </td>
            <td>none</td>
            <td>you specify</td>
          </tr>
        </tbody>
      </table>

      <CodeBlock
        filename=".env.local"
        language="bash"
        code={`ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...`}
      />

      <h3 id="local-models">Local models</h3>

      <p>
        Ollama and LM Studio need no key. Point the adapter at the local server
        and name the model you pulled:
      </p>

      <CodeBlock
        filename="lib/model.ts"
        language="typescript"
        code={`const model = createAdapter({
  provider: "ollama",
  model: "llama3",
  baseURL: "http://localhost:11434/v1", // the default
});`}
      />

      <h3 id="reasoning-and-caching">Reasoning and prompt caching</h3>

      <p>
        Two switches worth knowing at install time, because they change cost and
        latency more than anything else you configure:
      </p>

      <CodeBlock
        filename="lib/model.ts"
        language="typescript"
        code={`// Capture provider reasoning traces (DeepSeek, Qwen3-Thinking, GLM, Kimi,
// MiniMax, o-series…). \`true\` for defaults, or an object to tune depth.
createAdapter({ provider: "openai", reasoning: { effort: "high" } });

// Provider prompt caching — breakpoints on the stable prefix and latest turn.
createAdapter({ provider: "anthropic", cache: { ttl: "1h" } });

// The same switches exist on the Next.js handler.
createChatHandler({ provider: "anthropic", cache: true });`}
      />

      <p>
        Cache usage is reported on every response (
        <code>cache_creation_input_tokens</code> /{" "}
        <code>cache_read_input_tokens</code>) and threaded through to{" "}
        <code>useGlove().stats</code>, so you can bill on it. Full detail in the{" "}
        <a href="/docs/core">Core API reference</a>.
      </p>

      <h2 id="from-source">Building from source</h2>

      <p>
        The repo is a pnpm workspace. Clone it if you want to run the examples
        or work on a package:
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`git clone https://github.com/porkytheblack/glove.git
cd glove
pnpm install
pnpm build       # build every package
pnpm typecheck`}
      />

      <p>
        Next:{" "}
        <a href="/docs/getting-started">build a working agent in 15 minutes</a>,
        or skim <a href="/docs/packages">All Packages</a> to see what is
        available before you commit to a shape.
      </p>
    </div>
  );
}
