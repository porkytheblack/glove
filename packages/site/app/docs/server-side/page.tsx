import { CodeBlock } from "@/components/code-block";

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  marginTop: "1.5rem",
  marginBottom: "1.5rem",
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.875rem",
  minWidth: "540px",
};
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  fontWeight: 500,
  fontFamily: "var(--mono)",
  whiteSpace: "nowrap",
};
const thDescStyle: React.CSSProperties = {
  ...thStyle,
  fontFamily: undefined,
  whiteSpace: "normal",
};
const headRowStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--border)",
};
const bodyRowStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--border-subtle)",
};
const propCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--accent)",
  whiteSpace: "nowrap",
  fontSize: "0.825rem",
};
const typeCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
  fontSize: "0.825rem",
};
const descCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  whiteSpace: "normal",
  minWidth: "200px",
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

export default function ServerSidePage() {
  return (
    <div className="docs-content">
      <h1>Server-Side &amp; Non-React Agents</h1>

      <p>
        Glove&apos;s core package (<code>glove-core</code>) runs anywhere
        Node.js does. You don&apos;t need React, Next.js, or a browser to build
        an agent. This guide covers how to use the <code>Glove</code> builder
        directly to create agents for CLI tools, backend services, WebSocket
        servers, or any non-browser environment.
      </p>

      {/* ================================================================== */}
      {/* MINIMAL EXAMPLE                                                    */}
      {/* ================================================================== */}
      <h2 id="minimal-example">Minimal Example</h2>

      <p>
        The simplest possible agent needs four things: a store, a model, a
        display manager, and a system prompt.
      </p>

      <CodeBlock
        code={`import { Glove, Displaymanager, createAdapter } from "glove-core";
import z from "zod";

// 1. In-memory store (see below for implementation)
const store = new MemoryStore("my-session");

// 2. Model adapter from the provider registry
const model = createAdapter({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  stream: true,
});

// 3. Display manager — required, but can be empty if your
//    tools don't need interactive UI
const dm = new Displaymanager();

// 4. Build the agent
const agent = new Glove({
  store,
  model,
  displayManager: dm,
  systemPrompt: "You are a helpful assistant.",
  compaction_config: {
    compaction_instructions: "Summarize the conversation.",
  },
})
  .fold({
    name: "get_weather",
    description: "Get weather for a city.",
    inputSchema: z.object({ city: z.string() }),
    async do(input) {
      const res = await fetch(\`https://wttr.in/\${encodeURIComponent(input.city)}?format=j1\`);
      const data = await res.json();
      return { status: "success", data: data.current_condition?.[0] ?? {} };
    },
  })
  .build();

// 5. Send a message
const result = await agent.processRequest("What's the weather in Tokyo?");
console.log(result.messages[0]?.text);`}
        language="typescript"
      />

      <p>
        That&apos;s it. No React, no Next.js, no browser. The agent will call
        the model, execute tools, loop until done, and return the final result.
      </p>

      {/* ================================================================== */}
      {/* MEMORY STORE                                                       */}
      {/* ================================================================== */}
      <h2 id="memory-store">In-Memory Store</h2>

      <p>
        For server-side agents that don&apos;t need persistence across restarts,
        implement <code>StoreAdapter</code> with plain arrays and counters.
        This is the minimum viable store.
      </p>

      <CodeBlock
        code={`import type { StoreAdapter, Message } from "glove-core";

class MemoryStore implements StoreAdapter {
  identifier: string;
  private messages: Message[] = [];
  private tokenCount = 0;
  private turnCount = 0;

  constructor(id: string) {
    this.identifier = id;
  }

  async getMessages() { return this.messages; }
  async appendMessages(msgs: Message[]) { this.messages.push(...msgs); }
  async getTokenCount() { return this.tokenCount; }
  async addTokens(count: number) { this.tokenCount += count; }
  async getTurnCount() { return this.turnCount; }
  async incrementTurn() { this.turnCount++; }
  async resetCounters() { this.tokenCount = 0; this.turnCount = 0; }
}`}
        language="typescript"
      />

      <p>
        For persistent storage, use the built-in <code>SqliteStore</code>:
      </p>

      <CodeBlock
        code={`import { SqliteStore } from "glove-sqlite";

const store = new SqliteStore({
  dbPath: "./my-agent.db",
  sessionId: "session-123",
});`}
        language="typescript"
      />

      <p>
        The store interface is intentionally simple. You can implement it
        against Redis, Postgres, DynamoDB, or any backend. See the{" "}
        <a href="/docs/core#store-adapter">StoreAdapter</a> reference for
        the full interface, including optional methods for tasks and permissions.
      </p>

      {/* ================================================================== */}
      {/* TOOLS WITHOUT DISPLAY                                              */}
      {/* ================================================================== */}
      <h2 id="tools-without-display">Tools Without Display</h2>

      <p>
        Most server-side tools don&apos;t need a display manager. The{" "}
        <code>do</code> function receives the display manager as its second
        argument, but you can simply ignore it.
      </p>

      <CodeBlock
        code={`import z from "zod";

agent.fold({
  name: "search_database",
  description: "Search the product database.",
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().optional().default(10),
  }),
  async do(input) {
    // No display manager needed — just return the result
    const results = await db.products.search(input.query, input.limit);
    return {
      status: "success",
      data: results,
    };
  },
});`}
        language="typescript"
      />

      <p>
        The <code>do</code> function returns a <code>ToolResultData</code>{" "}
        object. For convenience, you can also return a plain string &mdash;
        the framework wraps it into{" "}
        <code>{`{ status: "success", data: yourString }`}</code> automatically.
      </p>

      <CodeBlock
        code={`async do(input) {
  const weather = await fetchWeather(input.city);
  // Returning a string works too
  return \`\${weather.temp}°C, \${weather.condition}\`;
}`}
        language="typescript"
      />

      {/* ================================================================== */}
      {/* SUBSCRIBING TO EVENTS                                              */}
      {/* ================================================================== */}
      <h2 id="subscribers">Subscribing to Events</h2>

      <p>
        Subscribers let you observe the agent in real time: streaming text,
        tool calls, results, and compaction events. This is how you wire up
        logging, WebSocket forwarding, metrics, or any side-channel output.
      </p>

      <CodeBlock
        code={`import type { SubscriberAdapter, SubscriberEvent, SubscriberEventDataMap } from "glove-core";

class LogSubscriber implements SubscriberAdapter {
  async record<T extends SubscriberEvent["type"]>(
    event_type: T,
    data: SubscriberEventDataMap[T],
  ) {
    switch (event_type) {
      case "text_delta": {
        const e = data as SubscriberEventDataMap["text_delta"];
        process.stdout.write(e.text);
        break;
      }
      case "tool_use": {
        const e = data as SubscriberEventDataMap["tool_use"];
        console.log(\`\\n[tool] \${e.name}(\${JSON.stringify(e.input)})\`);
        break;
      }
      case "tool_use_result": {
        const e = data as SubscriberEventDataMap["tool_use_result"];
        console.log(\`[result] \${e.tool_name}: \${e.result.status}\`);
        break;
      }
      case "model_response":
      case "model_response_complete": {
        const e = data as SubscriberEventDataMap["model_response"];
        console.log(\`\\n[done] tokens: \${e.tokens_in ?? 0} in, \${e.tokens_out ?? 0} out\`);
        break;
      }
    }
  }
}

// Register before or after build()
gloveBuilder.addSubscriber(new LogSubscriber());`}
        language="typescript"
      />

      <p>
        Events are fully typed. See the{" "}
        <a href="/docs/core#subscriber-events">Subscriber Events</a>{" "}
        reference for all event types and their data shapes.
      </p>

      <h3>Simplified subscriber</h3>

      <p>
        If you only care about a few events, you don&apos;t need the generic
        signature. A simple untyped subscriber works fine:
      </p>

      <CodeBlock
        code={`const subscriber: SubscriberAdapter = {
  async record(event_type, data) {
    if (event_type === "text_delta") {
      process.stdout.write((data as any).text);
    }
  },
};`}
        language="typescript"
      />

      {/* ================================================================== */}
      {/* WEBSOCKET SERVER                                                   */}
      {/* ================================================================== */}
      <h2 id="websocket-server">WebSocket Server Pattern</h2>

      <p>
        The coding agent example demonstrates the full pattern for a
        WebSocket-based agent server. Each connected client gets its own
        session with an isolated store, display manager, and subscriber.
      </p>

      <CodeBlock
        code={`import { WebSocketServer, WebSocket } from "ws";
import {
  Glove, Displaymanager,
  createAdapter, type SubscriberAdapter,
} from "glove-core";
import { SqliteStore } from "glove-sqlite";

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  // Each connection gets its own agent instance
  const store = new SqliteStore({ dbPath: "./agent.db", sessionId: randomUUID() });
  const dm = new Displaymanager();

  // Forward events to the WebSocket client
  const subscriber: SubscriberAdapter = {
    async record(event_type, data) {
      ws.send(JSON.stringify({ type: event_type, data }));
    },
  };

  const agent = new Glove({
    store,
    model: createAdapter({ provider: "anthropic", stream: true }),
    displayManager: dm,
    systemPrompt: "You are a helpful assistant.",
    compaction_config: {
      compaction_instructions: "Summarize the conversation.",
    },
  })
    .fold({ /* ... register tools ... */ })
    .addSubscriber(subscriber)
    .build();

  // Handle display slots — forward to client, resolve on response
  dm.subscribe(async (stack) => {
    for (const slot of stack) {
      if (dm.resolverStore.has(slot.id)) {
        ws.send(JSON.stringify({
          type: "slot_push",
          data: { id: slot.id, renderer: slot.renderer, input: slot.input },
        }));
      }
    }
  });

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw.toString());

    switch (msg.type) {
      case "chat":
        await agent.processRequest(msg.text);
        break;
      case "slot_resolve":
        dm.resolve(msg.slotId, msg.value);
        break;
      case "abort":
        // Use AbortController for cancellation
        break;
    }
  });
});`}
        language="typescript"
      />

      {/* ================================================================== */}
      {/* DISPLAY MANAGER                                                    */}
      {/* ================================================================== */}
      <h2 id="display-manager">When You Need a Display Manager</h2>

      <p>
        The <code>DisplayManager</code> is required in{" "}
        <code>GloveConfig</code>, but for purely autonomous agents you can pass
        an empty <code>new Displaymanager()</code> and never use it. It only
        matters when tools need to interact with a user mid-execution.
      </p>

      <PropTable
        headers={["Pattern", "Display Manager Usage", "Example"]}
        rows={[
          [
            "Autonomous agent",
            "Empty — tools return results directly",
            "CLI scripts, cron jobs, batch processing",
          ],
          [
            "Interactive server",
            "pushAndWait for user input, pushAndForget for status",
            "WebSocket servers, Slack bots, coding agents",
          ],
          [
            "Terminal UI",
            "Subscribe to stack changes, render with ink/blessed",
            "Weather agent, interactive CLI tools",
          ],
        ]}
      />

      <h3>Interactive tools with pushAndWait</h3>

      <p>
        When a tool calls <code>display.pushAndWait()</code>, the agent loop
        blocks until someone calls <code>dm.resolve(slotId, value)</code>.
        This is how you build tools that ask the user for confirmation,
        collect form input, or present choices.
      </p>

      <CodeBlock
        code={`gloveBuilder.fold({
  name: "confirm_action",
  description: "Ask the user to confirm a destructive action.",
  inputSchema: z.object({ action: z.string() }),
  async do(input, display) {
    // This blocks until your UI layer resolves the slot
    const confirmed = await display.pushAndWait({
      renderer: "confirm",
      input: { message: \`Proceed with: \${input.action}?\` },
    });

    if (!confirmed) {
      return { status: "error", data: null, message: "User cancelled." };
    }

    // ... perform the action ...
    return { status: "success", data: "Action completed." };
  },
});

// In your WebSocket/terminal handler, resolve when the user responds:
dm.resolve(slotId, true);  // or false to cancel`}
        language="typescript"
      />

      <h3>Non-blocking display with pushAndForget</h3>

      <p>
        Use <code>pushAndForget</code> for status indicators, progress
        updates, or any display that doesn&apos;t need user input.
      </p>

      <CodeBlock
        code={`async do(input, display) {
  // Show a loading indicator (non-blocking)
  const slotId = await display.pushAndForget({
    renderer: "loading",
    input: { message: "Fetching data..." },
  });

  const data = await fetchData(input.query);

  // Remove the loading indicator
  display.removeSlot(slotId);

  // Show the result (non-blocking)
  await display.pushAndForget({
    renderer: "result_card",
    input: data,
  });

  return { status: "success", data };
}`}
        language="typescript"
      />

      {/* ================================================================== */}
      {/* ABORT & CANCELLATION                                               */}
      {/* ================================================================== */}
      <h2 id="abort">Abort &amp; Cancellation</h2>

      <p>
        Pass an <code>AbortSignal</code> to <code>processRequest</code> to
        support cancellation. The signal propagates to the model adapter and
        tool execution.
      </p>

      <CodeBlock
        code={`const controller = new AbortController();

// Cancel after 30 seconds
setTimeout(() => controller.abort(), 30_000);

try {
  const result = await agent.processRequest("Analyze this codebase", controller.signal);
} catch (err) {
  if (err instanceof AbortError) {
    console.log("Request was cancelled.");
  }
}`}
        language="typescript"
      />

      <p>
        Mark tools as <code>unAbortable</code> if they perform mutations that
        must complete even when the request is cancelled:
      </p>

      <CodeBlock
        code={`gloveBuilder.fold({
  name: "save_to_database",
  description: "Persist data to the database.",
  inputSchema: z.object({ data: z.unknown() }),
  unAbortable: true,  // Runs to completion even if abort fires
  async do(input) {
    await db.save(input.data);
    return { status: "success", data: "Saved." };
  },
});`}
        language="typescript"
      />

      {/* ================================================================== */}
      {/* HOT-SWAPPING                                                       */}
      {/* ================================================================== */}
      <h2 id="hot-swap">Runtime Model Swapping</h2>

      <p>
        After building, you can swap the model adapter at runtime. This is
        useful for letting users choose their preferred model mid-session.
      </p>

      <CodeBlock
        code={`const agent = gloveBuilder.build();

// Later — swap to a different model
agent.setModel(createAdapter({
  provider: "openai",
  model: "gpt-4.1",
  stream: true,
}));

// Next processRequest uses the new model
await agent.processRequest("Continue our conversation.");`}
        language="typescript"
      />

      {/* ================================================================== */}
      {/* OPTIONAL FEATURES                                                  */}
      {/* ================================================================== */}
      <h2 id="optional-features">Optional Store Features</h2>

      <p>
        The <code>StoreAdapter</code> has several optional methods that
        unlock features automatically when implemented.
      </p>

      <PropTable
        headers={["Methods", "Feature", "What happens"]}
        rows={[
          [
            "getTasks, addTasks, updateTask",
            "Built-in task tool",
            "The glove_update_tasks tool is auto-registered, letting the model track work progress.",
          ],
          [
            "getPermission, setPermission",
            "Permission system",
            "Tools with requiresPermission: true will check/store user consent before execution.",
          ],
        ]}
      />

      <p>
        If your store doesn&apos;t implement these methods, the features are
        silently disabled. No errors, no configuration needed.
      </p>

      {/* ================================================================== */}
      {/* PATTERNS                                                           */}
      {/* ================================================================== */}
      <h2 id="patterns">Common Patterns</h2>

      <h3>CLI script</h3>

      <CodeBlock
        code={`#!/usr/bin/env npx tsx
import { Glove, Displaymanager, createAdapter } from "glove-core";
import z from "zod";

const agent = new Glove({
  store: new MemoryStore("cli"),
  model: createAdapter({ provider: "anthropic", stream: true }),
  displayManager: new Displaymanager(),
  systemPrompt: "You analyze code and report issues.",
  compaction_config: { compaction_instructions: "Summarize findings." },
})
  .fold({
    name: "read_file",
    description: "Read a file from disk.",
    inputSchema: z.object({ path: z.string() }),
    async do(input) {
      const fs = await import("fs/promises");
      return { status: "success", data: await fs.readFile(input.path, "utf-8") };
    },
  })
  .build();

const result = await agent.processRequest(\`Review \${process.argv[2]}\`);
console.log(result.messages.at(-1)?.text);`}
        language="typescript"
      />

      <h3>Background worker</h3>

      <CodeBlock
        code={`import { Glove, Displaymanager, createAdapter } from "glove-core";
import { SqliteStore } from "glove-sqlite";

async function processJob(job: { id: string; prompt: string }) {
  const store = new SqliteStore({ dbPath: "./jobs.db", sessionId: job.id });

  const agent = new Glove({
    store,
    model: createAdapter({ provider: "openai", stream: false }),
    displayManager: new Displaymanager(),
    systemPrompt: "You process data analysis jobs.",
    compaction_config: { compaction_instructions: "Summarize analysis." },
  })
    .fold({ /* tools */ })
    .build();

  return agent.processRequest(job.prompt);
}

// Process jobs from a queue
for await (const job of jobQueue) {
  const result = await processJob(job);
  await jobQueue.complete(job.id, result);
}`}
        language="typescript"
      />

      <h3>Multi-turn conversation loop</h3>

      <CodeBlock
        code={`import * as readline from "readline/promises";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const agent = buildAgent(); // your Glove builder setup

// Stream text as it arrives
agent.addSubscriber({
  async record(event_type, data) {
    if (event_type === "text_delta") {
      process.stdout.write((data as any).text);
    }
  },
});

while (true) {
  const input = await rl.question("\\n> ");
  if (input === "exit") break;

  // processRequest appends to the store, so context accumulates
  await agent.processRequest(input);
  console.log(); // newline after streamed response
}`}
        language="typescript"
      />

      {/* ================================================================== */}
      {/* ARCHITECTURE                                                       */}
      {/* ================================================================== */}
      <h2 id="architecture">How It Works</h2>

      <p>
        When you call <code>agent.processRequest(message)</code>, the
        framework runs the following loop internally:
      </p>

      <ol>
        <li>Append the user message to the store</li>
        <li>Load messages from the context (filtered to the last compaction point)</li>
        <li>Send messages + tool definitions to the model via <code>PromptMachine</code></li>
        <li>Append the model&apos;s response to the store</li>
        <li>
          If the model made tool calls: execute them via <code>Executor</code>,
          append tool results, and go to step 2
        </li>
        <li>
          If no tool calls: check compaction thresholds via{" "}
          <code>Observer</code>, then return the result
        </li>
      </ol>

      <p>
        Subscribers are notified at each step. The display manager is only
        involved when a tool explicitly calls <code>pushAndWait</code> or{" "}
        <code>pushAndForget</code>.
      </p>

      <h3>What you can skip</h3>

      <p>
        Compared to the React integration (<code>glove-react</code>), a
        server-side agent doesn&apos;t need:
      </p>

      <ul>
        <li>
          <code>GloveProvider</code> / <code>useGlove</code> &mdash; those are
          React hooks for state management
        </li>
        <li>
          <code>defineTool</code> / <code>ToolConfig</code> &mdash; those add
          React renderers. Use <code>.fold()</code> directly
        </li>
        <li>
          <code>&lt;Render&gt;</code> &mdash; the headless React component
          for chat UIs
        </li>
        <li>
          <code>createEndpointModel</code> / <code>createRemoteStore</code>{" "}
          &mdash; those are client-side adapters for talking to a server.
          On the server, you use model adapters directly
        </li>
      </ul>

      <p>
        You work directly with <code>glove-core</code>: the{" "}
        <code>Glove</code> builder, <code>Displaymanager</code>, and model
        adapters from <code>createAdapter</code> or instantiated directly
        (e.g. <code>new AnthropicAdapter({"{ ... }"})</code>). For persistent
        storage, use <code>SqliteStore</code> from <code>glove-sqlite</code>{" "}
        (or your own store).
      </p>
    </div>
  );
}
