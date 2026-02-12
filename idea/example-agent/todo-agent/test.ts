import {
  Agent,
  Context,
  Executor,
  Observer,
  PromptMachine,
  type StoreAdapter,
  type SubscriberAdapter,
} from "../../core";
import { AnthropicAdapter } from "./../../models/anthropic";
import { todoTools } from "./tools";

// ─── In-memory store (swap for SQLite/Redis in production) ────────────────────

class MemoryStore implements StoreAdapter {
  identifier: string;
  private data: Map<string, any> = new Map();

  constructor(id: string) {
    this.identifier = id;
  }

  async set(k: string, v: any) {
    this.data.set(k, v);
  }

  async get<V>(k: string): Promise<V> {
    return this.data.get(k) as V;
  }

  async resetPostCompaction() {
    // Keep the compacted messages, clear counters
    this.data.delete("TURN_COUNT");
    this.data.delete("CONSUMED_TOKENS");
  }
}

// ─── Console subscriber (logs events to stdout) ──────────────────────────────

class ConsoleSubscriber implements SubscriberAdapter {
  async record(event_type: string, data: any) {
    switch (event_type) {
      case "text_delta":
        process.stdout.write(data.text);
        break;
      case "tool_use":
        console.log(`\n🔧 Tool call: ${data.name}(${JSON.stringify(data.input)})`);
        break;
      case "tool_use_result":
        const icon = data.result.status === "success" ? "✅" : "❌";
        console.log(`${icon} ${data.tool_name}: ${JSON.stringify(data.result.data ?? data.result.message)}`);
        break;
      case "model_response":
        // Non-streaming: print the full text
        if (data.text) console.log(`\n🤖 ${data.text}`);
        if (data.tool_calls?.length) {
          for (const tc of data.tool_calls) {
            console.log(`🔧 Tool call: ${tc.tool_name}(${JSON.stringify(tc.input_args)})`);
          }
        }
        break;
      case "model_response_complete":
        console.log("\n--- turn complete ---");
        break;
    }
  }
}

// ─── Wire it all up ──────────────────────────────────────────────────────────

async function main() {
  const query = process.argv.slice(2).join(" ") || "Show me my todos";

  // 1. Store
  const store = new MemoryStore("todo-agent-session");

  // 2. Model adapter
  const model = new AnthropicAdapter({
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    systemPrompt: `You are a helpful todo list assistant. You manage a todo list stored in a local markdown file.

When the user asks to see, add, complete, edit, or remove todos, use the available tools.
Always read the current todos first before making modifications so you have accurate indexes.
Be concise in your responses.`,
    stream: false, // set true to see token-by-token output
  });

  // 3. Context
  const context = new Context(store);

  // 4. Prompt machine
  const promptMachine = new PromptMachine(model, context, model.name);
  const consoleSubscriber = new ConsoleSubscriber();
  promptMachine.addSubscriber(consoleSubscriber);

  // 5. Executor with todo tools
  const executor = new Executor();
  executor.addSubscriber(consoleSubscriber);
  for (const tool of todoTools) {
    executor.registerTool(tool);
  }

  // 6. Observer
  const observer = new Observer(
    store,
    context,
    promptMachine,
    25, // max turns
    "Summarize the conversation so far, preserving all todo changes made."
  );

  // 7. Agent
  const agent = new Agent(store, executor, context, observer, promptMachine);

  // 8. Run
  console.log(`\n📝 Query: "${query}"\n`);

  const result: any = await agent.ask({
    sender: "user",
    text: query,
  });

  // Print final result
  const finalMessages = result?.messages ?? [];
  const lastAgentMessage = finalMessages.filter((m: any) => m.sender === "agent").pop();

  if (lastAgentMessage?.text) {
    console.log(`\n📋 Final: ${lastAgentMessage.text}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});