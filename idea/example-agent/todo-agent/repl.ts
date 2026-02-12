import "dotenv/config"
import {
  Agent,
  Context,
  Executor,
  Observer,
  PromptMachine,
  type StoreAdapter,
  type SubscriberAdapter,
} from "../../core";
import { AnthropicAdapter } from "../../models/anthropic";
import { todoTools } from "./tools";
import { createInterface } from "readline";

// ─── In-memory store ─────────────────────────────────────────────────────────

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
    this.data.delete("TURN_COUNT");
    this.data.delete("CONSUMED_TOKENS");
  }
}

// ─── Console subscriber ─────────────────────────────────────────────────────

class ConsoleSubscriber implements SubscriberAdapter {
  async record(event_type: string, data: any) {
    switch (event_type) {
      case "text_delta":
        process.stdout.write(data.text);
        break;
      case "tool_use":
        console.log(
          `\n  🔧 ${data.name}(${JSON.stringify(data.input)})`
        );
        break;
      case "tool_use_result": {
        const icon = data.result.status === "success" ? "✅" : "❌";
        const detail = data.result.data ?? data.result.message;
        console.log(
          `  ${icon} ${data.tool_name} → ${typeof detail === "string" ? detail : JSON.stringify(detail)}`
        );
        break;
      }
      case "model_response":
        if (data.tool_calls?.length) {
          for (const tc of data.tool_calls) {
            console.log(
              `  🔧 ${tc.tool_name}(${JSON.stringify(tc.input_args)})`
            );
          }
        }
        break;
    }
  }
}

// ─── Build the agent ─────────────────────────────────────────────────────────

function createAgent() {
  const store = new MemoryStore("todo-session");

  const model = new AnthropicAdapter({
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    systemPrompt: `You are a helpful todo list assistant. You manage a todo list stored in a local markdown file.

When the user asks to see, add, complete, edit, or remove todos, use the available tools.
Always read the current todos first before making modifications so you have accurate indexes.
Be concise in your responses.`,
    stream: true,
    apiKey: process.env.ANTHROPIC_API_KEY!
  });

  const context = new Context(store);
  const promptMachine = new PromptMachine(model, context, model.name);
  const subscriber = new ConsoleSubscriber();
  promptMachine.addSubscriber(subscriber);

  const executor = new Executor();
  executor.addSubscriber(subscriber);
  for (const tool of todoTools) {
    executor.registerTool(tool);
  }

  const observer = new Observer(
    store,
    context,
    promptMachine,
    25,
    "Summarize the conversation so far, preserving all todo changes made."
  );

  return new Agent(store, executor, context, observer, promptMachine);
}

// ─── REPL ────────────────────────────────────────────────────────────────────

async function main() {
  const agent = createAgent();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("📝 Todo Agent CLI");
  console.log("Type your message and press enter. Ctrl+C to exit.\n");

  const prompt = () => {
    rl.question("you > ", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === "exit" || trimmed === "quit") {
        console.log("👋 Bye!");
        rl.close();
        process.exit(0);
      }

      try {
        console.log("");
        const result: any = await agent.ask({
          sender: "user",
          text: trimmed,
        });

        const messages = result?.messages ?? [];
        const last = messages.filter((m: any) => m.sender === "agent").pop();
        if (last?.text) {
          console.log(`\n🤖 ${last.text}\n`);
        } else {
          console.log("");
        }
      } catch (err: any) {
        console.error(`\n❌ Error: ${err.message}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main();