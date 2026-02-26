import { CodeBlock } from "@/components/code-block";

const tableWrapStyle = {
  overflowX: "auto" as const,
  marginTop: "1.5rem",
  marginBottom: "1.5rem",
};
const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: "0.875rem",
};
const thStyle = {
  textAlign: "left" as const,
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  fontWeight: 500,
  fontFamily: "var(--mono)",
};
const thDescStyle = {
  ...thStyle,
  fontFamily: undefined as string | undefined,
};
const headRowStyle = { borderBottom: "1px solid var(--border)" };
const bodyRowStyle = { borderBottom: "1px solid var(--border-subtle)" };
const propCell = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--accent)",
};
const typeCell = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--text-secondary)",
};
const descCell = {
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
};

function PropTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: [string, string, string][];
}) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={headRowStyle}>
            {headers.map((h, i) => (
              <th key={h} style={i < 2 ? thStyle : thDescStyle}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([prop, type, desc]) => (
            <tr key={prop + type} style={bodyRowStyle}>
              <td style={propCell}>{prop}</td>
              <td style={typeCell}>{type}</td>
              <td style={descCell}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function NextPage() {
  return (
    <div className="docs-content">
      <h1>glove-next</h1>

      <p>
        API reference for the Next.js integration package. Provides a
        server-side handler that turns any Next.js App Router API route into a
        streaming chat endpoint compatible with <code>glove-react</code>.
      </p>

      {/* ================================================================== */}
      {/* createChatHandler                                                  */}
      {/* ================================================================== */}
      <h2 id="create-chat-handler">createChatHandler</h2>

      <p>
        Factory function that returns a Next.js App Router <code>POST</code>{" "}
        handler. The handler accepts incoming chat requests, forwards them to
        the configured language model, and streams the response back as
        Server-Sent Events.
      </p>

      <p>
        The appropriate SDK (<code>openai</code> or{" "}
        <code>@anthropic-ai/sdk</code>) is lazy-loaded based on the
        provider&apos;s format, so only the SDK you use needs to be installed.
      </p>

      <CodeBlock
        filename="app/api/chat/route.ts"
        code={`import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  maxTokens: 4096,
});`}
        language="typescript"
      />

      <h3>Signature</h3>

      <CodeBlock
        code={`function createChatHandler(
  config: ChatHandlerConfig
): (req: Request) => Promise<Response>`}
        language="typescript"
      />

      <p>
        Returns a function with the signature{" "}
        <code>(req: Request) =&gt; Promise&lt;Response&gt;</code>, which is
        the shape Next.js expects for route handlers.
      </p>

      {/* ================================================================== */}
      {/* ChatHandlerConfig                                                  */}
      {/* ================================================================== */}
      <h2 id="chat-handler-config">ChatHandlerConfig</h2>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "provider",
            "string",
            'The provider ID. Required. One of: "openai", "anthropic", "openrouter", "gemini", "minimax", "kimi", "glm", "ollama", "lmstudio", "bedrock".',
          ],
          [
            "model?",
            "string",
            "The model name to use. Defaults to the provider's default model (e.g., \"gpt-4o\" for openai, \"claude-sonnet-4-20250514\" for anthropic).",
          ],
          [
            "apiKey?",
            "string",
            "API key for the provider. Defaults to the provider's environment variable (see Environment Variables below).",
          ],
          [
            "maxTokens?",
            "number",
            "Maximum number of output tokens per response. Defaults to the provider's default max tokens.",
          ],
          [
            "baseURL?",
            "string",
            "Override the provider's default base URL (e.g., custom port for local LLMs).",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* Supported Providers                                                */}
      {/* ================================================================== */}
      <h2 id="supported-providers">Supported Providers</h2>

      <p>
        Any provider registered in <code>glove-core</code> can be used. Each
        provider maps to an SDK format (either OpenAI-compatible or
        Anthropic-compatible), which determines which SDK is loaded at runtime.
      </p>

      <PropTable
        headers={["Provider", "SDK Format", "Default Model"]}
        rows={[
          ["openai", "openai", "gpt-4o"],
          ["anthropic", "anthropic", "claude-sonnet-4-20250514"],
          ["openrouter", "openai", "openai/gpt-4o"],
          ["gemini", "openai", "gemini-2.0-flash"],
          ["minimax", "openai", "MiniMax-Text-01"],
          ["kimi", "openai", "moonshot-v1-auto"],
          ["glm", "openai", "glm-4-plus"],
          ["ollama", "openai", "(user-specified)"],
          ["lmstudio", "openai", "(user-specified)"],
          ["bedrock", "bedrock", "anthropic.claude-3-5-sonnet-20241022-v2:0"],
        ]}
      />

      <p>
        Providers with <code>openai</code> format use the{" "}
        <code>openai</code> npm package. Providers with{" "}
        <code>anthropic</code> format use <code>@anthropic-ai/sdk</code>.
        Install only the SDK you need as a peer dependency.
      </p>

      {/* ================================================================== */}
      {/* Environment Variables                                              */}
      {/* ================================================================== */}
      <h2 id="environment-variables">Environment Variables</h2>

      <p>
        Each provider reads its API key from a default environment variable.
        Override with the <code>apiKey</code> config option if needed.
      </p>

      <PropTable
        headers={["Provider", "Environment Variable", "Description"]}
        rows={[
          ["openai", "OPENAI_API_KEY", "OpenAI API key."],
          ["anthropic", "ANTHROPIC_API_KEY", "Anthropic API key."],
          ["openrouter", "OPENROUTER_API_KEY", "OpenRouter API key."],
          ["gemini", "GEMINI_API_KEY", "Google Gemini API key."],
          ["minimax", "MINIMAX_API_KEY", "MiniMax API key."],
          ["kimi", "MOONSHOT_API_KEY", "Moonshot (Kimi) API key."],
          ["glm", "ZHIPUAI_API_KEY", "ZhipuAI (GLM) API key."],
          ["ollama", "(none)", "No API key needed. Runs locally on port 11434 by default."],
          ["lmstudio", "(none)", "No API key needed. Runs locally on port 1234 by default."],
          ["bedrock", "AWS_ACCESS_KEY_ID", "AWS credentials (also needs AWS_SECRET_ACCESS_KEY)."],
        ]}
      />

      {/* ================================================================== */}
      {/* Request Format                                                     */}
      {/* ================================================================== */}
      <h2 id="request-format">Request Format</h2>

      <p>
        The handler expects a JSON <code>POST</code> body matching the{" "}
        <code>RemotePromptRequest</code> shape. This is what{" "}
        <code>glove-react</code>&apos;s <code>createEndpointModel</code>{" "}
        sends automatically.
      </p>

      <h3>RemotePromptRequest</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "systemPrompt",
            "string",
            "The system prompt for this request.",
          ],
          [
            "messages",
            "Message[]",
            "The conversation history.",
          ],
          [
            "tools?",
            "SerializedTool[]",
            "Tool definitions serialized as JSON Schema objects.",
          ],
        ]}
      />

      <h3>SerializedTool</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          ["name", "string", "The tool name."],
          ["description", "string", "The tool description."],
          [
            "parameters",
            "Record<string, unknown>",
            "JSON Schema representation of the tool's input parameters.",
          ],
        ]}
      />

      {/* ================================================================== */}
      {/* SSE Response Protocol                                              */}
      {/* ================================================================== */}
      <h2 id="sse-protocol">SSE Response Protocol</h2>

      <p>
        The handler streams responses back as Server-Sent Events. Each event
        is a <code>RemoteStreamEvent</code>, sent as a JSON-encoded{" "}
        <code>data:</code> line. The client-side <code>parseSSEStream</code>{" "}
        utility in <code>glove-react</code> deserializes these events
        automatically.
      </p>

      <h3>RemoteStreamEvent</h3>

      <CodeBlock
        code={`type RemoteStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "done"; message: Message; tokens_in: number; tokens_out: number };`}
        language="typescript"
      />

      <PropTable
        headers={["Event Type", "Fields", "Description"]}
        rows={[
          [
            "text_delta",
            "text: string",
            "A chunk of streaming text from the model. Sent as the model generates tokens.",
          ],
          [
            "tool_use",
            "id: string, name: string, input: unknown",
            "The model wants to invoke a tool. Contains the call ID, tool name, and input arguments.",
          ],
          [
            "done",
            "message: Message, tokens_in: number, tokens_out: number",
            "The stream is complete. Contains the final Message object and token usage counts.",
          ],
        ]}
      />

      <p>
        The raw SSE wire format looks like this:
      </p>

      <CodeBlock
        code={`data: {"type":"text_delta","text":"Hello"}

data: {"type":"text_delta","text":", how"}

data: {"type":"text_delta","text":" can I help?"}

data: {"type":"done","message":{"sender":"agent","text":"Hello, how can I help?"},"tokens_in":42,"tokens_out":8}`}
        language="text"
      />

      {/* ================================================================== */}
      {/* Full Example                                                       */}
      {/* ================================================================== */}
      <h2 id="full-example">Full Working Example</h2>

      <p>
        A complete setup with <code>glove-next</code> on the server and{" "}
        <code>glove-react</code> on the client.
      </p>

      <h3>Server: API Route</h3>

      <CodeBlock
        filename="app/api/chat/route.ts"
        code={`import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "openai",
  model: "gpt-4o",
});`}
        language="typescript"
      />

      <h3>Client: GloveClient Setup</h3>

      <CodeBlock
        filename="lib/glove.ts"
        code={`import { GloveClient } from "glove-react";
import { z } from "zod";

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful coding assistant.",
  tools: [
    {
      name: "search_docs",
      description: "Search the documentation for a query.",
      inputSchema: z.object({
        query: z.string().describe("The search query."),
      }),
      async do(input) {
        const res = await fetch(\`/api/docs/search?q=\${encodeURIComponent(input.query)}\`);
        return res.json();
      },
    },
  ],
  compaction: {
    compaction_instructions: "Summarize the conversation, preserving any code snippets discussed.",
    max_turns: 40,
  },
});`}
        language="typescript"
      />

      <h3>Client: Provider and Chat Component</h3>

      <CodeBlock
        filename="app/providers.tsx"
        code={`"use client";

import { GloveProvider } from "glove-react";
import { gloveClient } from "@/lib/glove";

export function Providers({ children }: { children: React.ReactNode }) {
  return <GloveProvider client={gloveClient}>{children}</GloveProvider>;
}`}
        language="tsx"
      />

      <CodeBlock
        filename="app/chat.tsx"
        code={`"use client";

import { useGlove } from "glove-react";
import { useRef, FormEvent } from "react";

export default function Chat() {
  const { timeline, streamingText, busy, sendMessage } = useGlove();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = inputRef.current?.value?.trim();
    if (!text || busy) return;
    sendMessage(text);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <div>
        {timeline.map((entry, i) => (
          <div key={i}>
            {entry.kind === "user" && <p><strong>You:</strong> {entry.text}</p>}
            {entry.kind === "agent_text" && <p><strong>Agent:</strong> {entry.text}</p>}
            {entry.kind === "tool" && (
              <p><em>Tool: {entry.name} ({entry.status})</em></p>
            )}
          </div>
        ))}
        {streamingText && <p><strong>Agent:</strong> {streamingText}</p>}
      </div>
      <form onSubmit={handleSubmit}>
        <input ref={inputRef} disabled={busy} placeholder="Type a message..." />
        <button type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}`}
        language="tsx"
      />

      <h3>Environment</h3>

      <CodeBlock
        filename=".env.local"
        code={`OPENAI_API_KEY=sk-your-api-key-here`}
        language="text"
      />

      <p>
        The <code>createEndpointModel</code> adapter inside{" "}
        <code>GloveClient</code> handles SSE parsing, streaming text
        aggregation, and tool call deserialization. The{" "}
        <code>createChatHandler</code> on the server handles SDK initialization,
        request translation, and SSE encoding. Together they form a complete
        client-server pipeline with no manual plumbing required.
      </p>
    </div>
  );
}
