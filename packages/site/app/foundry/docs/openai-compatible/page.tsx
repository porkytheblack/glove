import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "OpenAI-compatible API",
  description:
    "Point any OpenAI SDK at Foundry: /v1/models, /v1/chat/completions and /v1/responses backed by durable agent instances and conversations.",
};

export default function OpenAiCompatiblePage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / OpenAI-compatible API</span>
      <h1>OpenAI-compatible API</h1>
      <p className="blog-lede">
        Any OpenAI SDK, chat UI, LangChain-style client or eval harness can talk to a
        Foundry agent by changing its base URL. Behind the familiar request, each call is a
        durable run on a persisted agent instance: its own model, prompt, tools, memory,
        approvals and trace, in a conversation that survives the request.
      </p>

      <h2 id="what-you-get">What you get</h2>
      <table>
        <thead><tr><th>Endpoint</th><th>Behaviour</th></tr></thead>
        <tbody>
          <tr><td><code>GET /v1/models</code></td><td>Lists every agent instance as a model.</td></tr>
          <tr><td><code>POST /v1/chat/completions</code></td><td>Chat Completions, blocking or SSE streaming.</td></tr>
          <tr><td><code>POST /v1/responses</code></td><td>Responses API, blocking or SSE streaming, including image and file inputs.</td></tr>
        </tbody>
      </table>
      <p>
        All three live on the normal Foundry server (default{" "}
        <code>http://127.0.0.1:4141</code>), so the SDK base URL is{" "}
        <code>http://127.0.0.1:4141/v1</code>. Runs they create appear in the inspector and in
        WebChat like any other conversation. For fire-and-poll automation use{" "}
        <Link href="/foundry/docs/runtime#runs-api">/v1/runs</Link> instead.
      </p>

      <h2 id="quick-start">Quick start</h2>
      <p>
        The <code>model</code> you send is an <strong>agent instance</strong>, so create one
        first (once). With the dev server running:
      </p>
      <CodeBlock filename="terminal" language="bash" code={`# Persist an instance of agents/support/agent.ts with a readable id.
curl -s http://127.0.0.1:4141/api/agent-instances \\
  -H 'content-type: application/json' \\
  -d '{"definitionId":"support","id":"support-acme","workspaceId":"acme"}'

# It is now a "model".
curl -s http://127.0.0.1:4141/v1/models
# {"object":"list","data":[{"id":"support-acme","object":"model","created":1760518800,"owned_by":"glove-foundry:support"}]}`} />
      <CodeBlock filename="chat.ts" language="typescript" code={`import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "http://127.0.0.1:4141/v1",
  apiKey: process.env.FOUNDRY_API_TOKEN ?? "foundry-local", // see Authentication
});

// "model" is a Foundry agent instance id.
const { data: completion, response } = await openai.chat.completions
  .create(
    {
      model: "support-acme",
      messages: [{ role: "user", content: "Where is order 1042?" }],
    },
    { headers: { "x-foundry-conversation-id": "customer-881" } },
  )
  .withResponse();

console.log(completion.choices[0]?.message.content);
// The durable conversation id; send it back (or the same key) to continue.
console.log(response.headers.get("x-foundry-conversation-id")); // "openai-…"`} />

      <h2 id="models">Models are agent instances</h2>
      <p>
        <code>GET /v1/models</code> returns one entry per persisted instance:{" "}
        <code>id</code> is the instance id, <code>created</code> its creation time in Unix
        seconds and <code>owned_by</code> is <code>glove-foundry:&lt;definition route&gt;</code>.
        Definitions without instances are not listed. A request&apos;s <code>model</code>{" "}
        resolves to:
      </p>
      <ol>
        <li>the instance whose id equals <code>model</code>, otherwise</li>
        <li>the only instance of the definition route named <code>model</code> (e.g.{" "}
          <code>&quot;support&quot;</code> when exactly one support instance exists).</li>
      </ol>
      <p>
        Anything else is <code>404</code>{" "}
        <code>Foundry model &quot;…&quot; does not resolve to one agent instance.</code> These
        endpoints never create instances; create them with the{" "}
        <Link href="/foundry/docs/runtime">client or HTTP API</Link>, a playbook subscription, or
        the inspector. The model provider, system prompt and tools are whatever that
        instance&apos;s definition assembles — see{" "}
        <Link href="/foundry/docs/definitions-and-instances">Definitions &amp; instances</Link>.
      </p>

      <h2 id="auth">Authentication</h2>
      <p>
        OpenAI SDKs send <code>Authorization: Bearer &lt;apiKey&gt;</code> and refuse to start
        without a key. On loopback with no <code>requestAuthorization</code>, Foundry ignores the
        header, so any non-empty placeholder works. When <code>foundry.application.ts</code>{" "}
        configures <code>requestAuthorization</code>, the adapter receives that header on every
        request and the SDK&apos;s <code>apiKey</code> becomes your Foundry credential; a refusal
        is <code>401</code> with a <code>WWW-Authenticate</code> challenge.
      </p>
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import { defineApplication } from "glove-foundry";

const token = process.env.FOUNDRY_API_TOKEN ?? "";

function matches(header: string | undefined): boolean {
  const expected = Buffer.from(\`Bearer \${token}\`);
  const received = Buffer.from(header ?? "");
  return token.length > 0 && received.length === expected.length && timingSafeEqual(received, expected);
}

export default defineApplication({
  name: "Acme support",
  requestAuthorization: {
    identifier: "acme-bearer-token",
    challenge: 'Bearer realm="Acme support"',
    authorize: ({ authorization }) => Effect.sync(() => matches(authorization)),
  },
});`} />
      <p>
        The adapter gates the whole server, inspector included. Production setups (TLS,
        cookies for the inspector, proxies) are on{" "}
        <Link href="/foundry/docs/deploy">Deploy &amp; security</Link>.
      </p>

      <h2 id="chat-completions">Chat Completions</h2>
      <h3 id="chat-request">Request fields Foundry reads</h3>
      <table>
        <thead><tr><th>Field</th><th>Handling</th></tr></thead>
        <tbody>
          <tr><td><code>model</code></td><td>Required. Instance id or single-instance route.</td></tr>
          <tr><td><code>messages</code></td><td>Required, non-empty, must contain a <code>user</code> message. Roles: <code>system</code>, <code>user</code>, <code>assistant</code>, <code>tool</code>; any other role (including <code>developer</code>) is a <code>400</code>. Content is a string or an array of parts.</td></tr>
          <tr><td><code>stream</code></td><td><code>true</code> returns SSE chunks.</td></tr>
          <tr><td><code>conversation_id</code></td><td>Non-standard body field: conversation key.</td></tr>
          <tr><td><code>user</code></td><td>Conversation key when neither the header nor <code>conversation_id</code> is set.</td></tr>
          <tr><td>header <code>x-foundry-conversation-id</code></td><td>Conversation key; wins over both body fields.</td></tr>
        </tbody>
      </table>
      <p>
        Every other field — <code>tools</code>, <code>tool_choice</code>,{" "}
        <code>temperature</code>, <code>max_tokens</code>, <code>response_format</code>,{" "}
        <code>n</code>, <code>stop</code>, <code>metadata</code>, <code>stream_options</code>… —
        is ignored.
      </p>

      <h3 id="chat-mapping">How messages become one Foundry turn</h3>
      <p>
        Foundry keeps the history itself, so it sends the agent one new user turn per request:
      </p>
      <ul>
        <li>The <strong>last <code>user</code> message</strong> is the turn. Its string content, or its <code>text</code> parts plus <code>image_url</code> parts (converted to Glove image parts with a URL source), are used; other part types are dropped. Messages after it are ignored.</li>
        <li>If the conversation is <strong>new</strong> — first request for this key, or no key at all — every message before that user message is folded into the turn as text. If the conversation <strong>already exists</strong>, earlier messages are ignored because Foundry already holds them.</li>
        <li><code>system</code> messages never replace the agent&apos;s <code>systemPrompt</code>; they arrive as folded text like any other prior message.</li>
      </ul>
      <CodeBlock filename="what the agent receives for a new conversation" language="text" code={`<message role="system">
Reply in Spanish.
</message>
<message role="user">
Hi
</message>
<message role="assistant">
¡Hola! ¿En qué puedo ayudarte?
</message>
<current-user-message>
Where is order 1042?
</current-user-message>`} />
      <div className="docs-note"><span className="docs-note-icon">◆</span><p>
        A chat UI that resends the full history on every request works either way: pin a
        conversation key and Foundry uses only the newest user message after the first call;
        omit the key and every request starts a fresh conversation seeded with the folded
        history.
      </p></div>

      <h3 id="chat-response">Response</h3>
      <p>
        Non-streaming requests block until the run finishes (up to the run&apos;s{" "}
        <code>timeoutMs</code>, 300 000 ms by default) and return:
      </p>
      <CodeBlock filename="200 OK" language="json" code={`{
  "id": "chatcmpl-<runId>",
  "object": "chat.completion",
  "created": 1760518860,
  "model": "support-acme",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Order 1042 shipped on Monday and arrives Thursday." },
      "finish_reason": "stop"
    }
  ],
  "system_fingerprint": "glove-foundry"
}`} />
      <p>
        <code>content</code> is the run&apos;s <code>output.value</code>: the final assistant text,
        or the JSON string of a non-string value returned by a custom <code>run</code> handler.
        The run id is embedded in <code>id</code> after <code>chatcmpl-</code>; open{" "}
        <code>/runs/&lt;runId&gt;</code> in the inspector to see every tool call. There is no{" "}
        <code>usage</code> field. A run that fails, is cancelled or does not finish in time
        returns <code>502</code> <code>{"{ \"error\": \"…\" }"}</code>.
      </p>

      <h3 id="chat-streaming">Streaming</h3>
      <CodeBlock filename="stream.ts" language="typescript" code={`// openai: the client constructed in chat.ts above
const stream = await openai.chat.completions.create(
  {
    model: "support-acme",
    stream: true,
    messages: [{ role: "user", content: "Draft a reply to the customer about the delay." }],
  },
  { headers: { "x-foundry-conversation-id": "customer-881" } },
);
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta.content ?? "");
}`} />
      <CodeBlock filename="text/event-stream" language="text" code={`data: {"id":"chatcmpl-<runId>","object":"chat.completion.chunk","created":1760518860,"model":"support-acme","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-<runId>","object":"chat.completion.chunk","created":1760518860,"model":"support-acme","choices":[{"index":0,"delta":{"content":"Order 1042 "},"finish_reason":null}]}

data: {"id":"chatcmpl-<runId>","object":"chat.completion.chunk","created":1760518860,"model":"support-acme","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]`} />
      <ul>
        <li>The first chunk carries only <code>role</code>. Each later content chunk is one model <code>text_delta</code> event from that run, so text the model writes before a tool call is streamed too; the non-streaming body contains only the final message.</li>
        <li>If the model adapter does not stream (or a <code>run</code> handler produced the output), the whole answer arrives as one chunk just before <code>finish_reason: &quot;stop&quot;</code>.</li>
        <li>The HTTP status is already <code>200</code> when a run fails mid-stream, so the failure arrives as a content chunk <code>Foundry error: &lt;message&gt;</code> followed by <code>finish_reason: &quot;stop&quot;</code> and <code>[DONE]</code>.</li>
        <li>The <code>x-foundry-conversation-id</code> response header is sent with the stream headers.</li>
      </ul>

      <h2 id="responses">Responses API</h2>
      <CodeBlock filename="responses.ts" language="typescript" code={`// openai: the client constructed in chat.ts above
const response = await openai.responses.create(
  {
    model: "support-acme",
    instructions: "Answer in two sentences.",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "Is this box damaged enough for a refund?" },
          { type: "input_image", image_url: "https://example.com/damaged-box.jpg", detail: "auto" },
        ],
      },
    ],
  },
  { headers: { "x-foundry-conversation-id": "customer-881" } },
);
console.log(response.output_text);
console.log(response.metadata?.["glove.foundry.run_id"]);

// Streaming: typed events, ending in response.completed or response.failed.
const events = await openai.responses.create({
  model: "support-acme",
  input: "Summarise the conversation so far.",
  stream: true,
});
for await (const event of events) {
  if (event.type === "response.output_text.delta") process.stdout.write(event.delta);
}`} />
      <h3 id="responses-request">Request fields Foundry reads</h3>
      <table>
        <thead><tr><th>Field</th><th>Handling</th></tr></thead>
        <tbody>
          <tr><td><code>model</code></td><td>Required. Same resolution as above.</td></tr>
          <tr><td><code>input</code></td><td>Required. A string, or an array of items. From an array, the last item with <code>role: &quot;user&quot;</code> (else the last item) is the turn; every item before that user item is folded in as <code>&lt;message role=…&gt;</code> text — on every request, whether or not the conversation already exists.</td></tr>
          <tr><td>content parts</td><td><code>input_text</code>/<code>text</code> → text; <code>input_image</code>/<code>image_url</code> with a URL → image; <code>input_file</code> with <code>file_url</code> or <code>file_data</code> (data URL or raw base64) → document. Others are dropped.</td></tr>
          <tr><td><code>instructions</code></td><td>Prepended to the turn as <code>&lt;instructions&gt;…&lt;/instructions&gt;</code> text (not the system prompt) and echoed back.</td></tr>
          <tr><td><code>stream</code></td><td><code>true</code> returns typed SSE events.</td></tr>
          <tr><td><code>conversation_id</code>, <code>user</code>, header</td><td>Conversation key, same precedence as Chat Completions.</td></tr>
          <tr><td><code>context</code></td><td>Non-standard object merged into the run&apos;s <code>request.context</code>.</td></tr>
          <tr><td><code>store</code></td><td>Echoed only; Foundry always persists the run.</td></tr>
        </tbody>
      </table>
      <p>
        <code>previous_response_id</code>, <code>tools</code>, <code>temperature</code>,{" "}
        <code>max_output_tokens</code>, <code>reasoning</code> and <code>text.format</code> are
        ignored; continue a conversation with a key instead.
      </p>
      <h3 id="responses-response">Response</h3>
      <ul>
        <li><code>id</code> is <code>resp_&lt;runId&gt;</code>; <code>status</code> is <code>completed</code>, <code>failed</code> or <code>cancelled</code>.</li>
        <li><code>output</code> holds one assistant <code>message</code> with one <code>output_text</code> part when completed, otherwise <code>[]</code>, with <code>error: {"{ message, type: \"foundry_run_error\" }"}</code> when the run recorded an error.</li>
        <li><code>metadata</code> contains <code>glove.foundry.run_id</code> and <code>glove.foundry.conversation_id</code>.</li>
        <li><code>usage</code> is all zeros; <code>previous_response_id</code> is always <code>null</code>; <code>temperature</code>, <code>top_p</code>, <code>tool_choice</code> and <code>tools</code> are fixed placeholder values.</li>
        <li>HTTP <code>200</code> when completed, <code>502</code> (with the same response object) otherwise.</li>
      </ul>
      <p>
        Streaming emits, in order: <code>response.created</code>,{" "}
        <code>response.in_progress</code>, <code>response.output_item.added</code>,{" "}
        <code>response.content_part.added</code>, any number of{" "}
        <code>response.output_text.delta</code>, <code>response.output_text.done</code>,{" "}
        <code>response.content_part.done</code>, <code>response.output_item.done</code>, then{" "}
        <code>response.completed</code> or <code>response.failed</code>. Each frame is{" "}
        <code>event: &lt;type&gt;</code> plus <code>data</code> with <code>type</code> and an
        increasing <code>sequence_number</code>.
      </p>

      <h2 id="conversations">Continuing a conversation</h2>
      <p>Every request resolves a conversation key, in this order:</p>
      <ol>
        <li>the <code>x-foundry-conversation-id</code> request header,</li>
        <li>the <code>conversation_id</code> body field,</li>
        <li>the <code>user</code> body field,</li>
        <li>none: a brand-new conversation for this request.</li>
      </ol>
      <p>
        A key that already starts with the endpoint&apos;s prefix — <code>openai-</code> for Chat
        Completions, <code>responses-</code> for the Responses API — and is shorter than 128
        characters is used as the conversation id verbatim, so you can echo back the returned
        header. Any other key becomes a stable id derived from the instance id and the key
        (<code>openai-&lt;32 hex&gt;</code>): the same key on the same instance always reaches
        the same conversation, and the same key on another instance reaches a different one.
        Because the prefixes differ, the two endpoints never share a conversation. New
        conversations are titled &ldquo;OpenAI-compatible session&rdquo; and can be opened in
        WebChat or read with <code>conversationTranscript</code>.
      </p>
      <CodeBlock filename="chat.py" language="python" code={`from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:4141/v1", api_key="foundry-local")

raw = client.chat.completions.with_raw_response.create(
    model="support-acme",
    messages=[{"role": "user", "content": "Where is order 1042?"}],
    extra_headers={"x-foundry-conversation-id": "customer-881"},
)
completion = raw.parse()
print(completion.choices[0].message.content)
print(raw.headers.get("x-foundry-conversation-id"))

# Same key in the body field: same durable conversation.
stream = client.chat.completions.create(
    model="support-acme",
    messages=[{"role": "user", "content": "And when will it arrive?"}],
    stream=True,
    extra_body={"conversation_id": "customer-881"},
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`} />
      <CodeBlock filename="terminal" language="bash" code={`curl -s http://127.0.0.1:4141/v1/chat/completions \\
  -H 'content-type: application/json' \\
  -H 'authorization: Bearer foundry-local' \\
  -H 'x-foundry-conversation-id: customer-881' \\
  -d '{"model":"support-acme","messages":[{"role":"user","content":"Where is order 1042?"}]}'

curl -N http://127.0.0.1:4141/v1/responses \\
  -H 'content-type: application/json' \\
  -d '{"model":"support-acme","input":"Any update?","conversation_id":"customer-881","stream":true}'`} />

      <h2 id="differences">Differences from OpenAI</h2>
      <ul>
        <li><strong><code>model</code> is an agent, not an LLM.</strong> The instance&apos;s definition chooses the provider, prompt, tools and memory.</li>
        <li><strong>Tools run inside Foundry.</strong> Client-supplied <code>tools</code>/<code>functions</code> are ignored and no <code>tool_calls</code> are returned; you receive the final text. The tool calls are in the run trace.</li>
        <li><strong>Sampling parameters are ignored</strong> (<code>temperature</code>, <code>top_p</code>, <code>max_tokens</code>, <code>n</code>, <code>stop</code>, <code>seed</code>, <code>response_format</code>, <code>reasoning</code>…). Configure them on the definition&apos;s model adapter.</li>
        <li><strong>Server-side history.</strong> With a conversation key only the newest user message is new input; <code>previous_response_id</code> is not used.</li>
        <li><strong>One choice, always <code>finish_reason: &quot;stop&quot;</code></strong>, even when the run used tools.</li>
        <li><strong>No token usage.</strong> Chat Completions omits <code>usage</code>; Responses reports zeros. Token counts are on the conversation transcript (<code>tokenCount</code>, <code>tokenConsumption</code>).</li>
        <li><strong>Errors are <code>{"{ \"error\": \"message\" }"}</code></strong> (a string), with <code>400</code> for invalid bodies, <code>401</code> unauthorized, <code>404</code> for an unknown model or path, <code>413</code> for an oversized body and <code>502</code> for a failed run. SDKs surface these as their API error type.</li>
        <li><strong>Approvals can hold a request open.</strong> A permission-gated tool pauses the run while it waits for a person. The HTTP request stays open until the run finishes, times out, or the process stops. The approval itself does not expire unless you set <code>approvals.timeoutMs</code>, and resolving it after a restart continues the conversation in a new run. An expired or cancelled approval is denied. See <Link href="/foundry/docs/approvals">Approvals &amp; steering</Link>.</li>
        <li><strong>Long requests.</strong> Non-streaming calls wait for the whole run (default run timeout 5 minutes); set your client timeout above that, or stream.</li>
        <li><strong>Body size</strong> is capped at 1 MB unless <code>server.messageBodyBytes</code> is raised in <code>foundry.config.ts</code>.</li>
        <li><strong>Only these three endpoints exist.</strong> <code>/v1/embeddings</code>, <code>/v1/completions</code>, files and audio return <code>404</code>.</li>
      </ul>
    </article>
  );
}
