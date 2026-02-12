import "dotenv/config"
import {
  Agent,
  Context,
  Executor,
  Observer,
  PromptMachine,
  type StoreAdapter,
  type SubscriberAdapter,
  type Message,
} from "../../core";
import { AnthropicAdapter } from "../../models/anthropic";
import { interactiveTools } from "./tools";
import { createInterface, type Interface as RLInterface } from "readline";
import ora, { type Ora } from "ora";
import chalk from "chalk";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// In-memory store
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Drawing helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const WIDTH = () => Math.min(process.stdout.columns || 80, 90);

const TOOL_ICONS: Record<string, string> = {
  deploy: "🚀",
  scaffold_project: "🏗️ ",
  db_migrate: "🗃️ ",
  inject_secret: "🔐",
  collect_form: "📋",
};

function tIcon(name: string) {
  return TOOL_ICONS[name] ?? "⚙️ ";
}

function hr() {
  return chalk.dim("─".repeat(WIDTH()));
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max) + chalk.dim(`… (${s.length} chars)`);
}

function formatMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function stripAnsi(s: string) {
  return s.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

function box(
  content: string,
  opts: { maxLines?: number; color?: typeof chalk; label?: string } = {}
) {
  const maxLines = opts.maxLines ?? 14;
  const c = opts.color ?? chalk.dim;

  const lines = content.split("\n");
  const display = lines.slice(0, maxLines);
  const clipped = lines.length > maxLines;
  const innerW = WIDTH() - 10;

  const topLabel = opts.label ? ` ${opts.label} ` : "";
  const topPad = Math.max(0, innerW - topLabel.length);
  console.log(c(`    ┌${topLabel}${"─".repeat(topPad + 1)}┐`));

  for (const l of display) {
    const visible = l.slice(0, innerW);
    const pad = Math.max(0, innerW - stripAnsi(visible).length);
    console.log(c("    │ ") + visible + " ".repeat(pad) + c(" │"));
  }

  if (clipped) {
    const msg = `… ${lines.length - maxLines} more lines`;
    const pad = Math.max(0, innerW - msg.length);
    console.log(c("    │ ") + chalk.dim(msg) + " ".repeat(pad) + c(" │"));
  }

  console.log(c(`    └${"─".repeat(innerW + 2)}┘`));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The handOver implementation — this is the star of the show
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates the delegateToCaller function that tools call when they need human input.
 *
 * Tools send objects like:
 *   { type: "confirm", message: "Deploy to prod?", options: ["yes", "no"] }
 *   { type: "input", message: "Enter project name:" }
 *   { type: "secret", message: "Enter API key:", sensitive: true }
 *   { type: "select", message: "Pick a license:", options: ["MIT", "Apache"] }
 *
 * This function renders appropriate UI and returns the human's response.
 */
 function createHandOver(spinner: Ora) {
   return async (request: unknown): Promise<unknown> => {
     if (spinner.isSpinning) spinner.stop();
 
     const req = request as {
       type?: string;
       message?: string;
       options?: string[];
       default?: string;
       sensitive?: boolean;
       field_name?: string;
     };
 
     const type = req.type ?? "input";
     const message = req.message ?? "Input needed:";
     const options = req.options ?? [];
     const defaultVal = req.default ?? "";
 
     console.log("");
     console.log(chalk.yellow.bold("  ⏸  Human input required"));
     console.log("");
 
     box(message, { label: " 🧑 ", color: chalk.yellow, maxLines: 20 });
 
     if (options.length > 0) {
       console.log(
         chalk.dim("    Options: ") +
           options.map((o) => chalk.cyan(o)).join(chalk.dim(" · "))
       );
     }
 
     if (defaultVal) {
       console.log(chalk.dim(`    Default: ${defaultVal}`));
     }
 
     console.log("");
 
     // ── Fresh readline for each prompt — no nesting issues ────────
     return new Promise<string>((resolve) => {
       const promptRl = createInterface({
         input: process.stdin,
         output: process.stdout,
       });
 
       const promptChar =
         type === "secret"
           ? chalk.red.bold("  🔑 ")
           : type === "confirm"
             ? chalk.yellow.bold("  ? ")
             : chalk.cyan.bold("  → ");
 
       promptRl.question(promptChar, (answer) => {
         promptRl.close(); // ← dispose immediately
         process.stdin.resume();
 
         const value = answer.trim() || defaultVal;
 
         if (type === "secret") {
           console.log(chalk.dim("    (value received, not displayed)"));
         } else if (type === "confirm") {
           const isYes = value.toLowerCase().startsWith("y");
           console.log(
             isYes
               ? chalk.green("    ✓ Confirmed")
               : chalk.red("    ✗ Declined")
           );
         } else {
           console.log(chalk.dim(`    → ${value}`));
         }
         console.log("");
 
         spinner.text = chalk.dim("Continuing…");
         spinner.indent = 4;
         spinner.start();
 
         resolve(value);
       });
     });
   };
 }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Terminal subscriber
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TerminalSubscriber implements SubscriberAdapter {
  private spinner: Ora;
  private toolTimers: Map<string, number> = new Map();
  private isStreaming = false;
  private toolCount = 0;

  totalTokensIn = 0;
  totalTokensOut = 0;
  turnCount = 0;
  wasStreaming = false

  constructor(spinner: Ora) {
    this.spinner = spinner;
  }

  resetToolCount() {
    this.toolCount = 0;
    this.wasStreaming = false
  }

  async record(event_type: string, data: any) {
    switch (event_type) {
      case "text_delta": {
        if (this.spinner.isSpinning) this.spinner.stop();
        if (!this.isStreaming) {
          this.isStreaming = true;
          this.wasStreaming = true
          process.stdout.write("\n  ");
        }
        process.stdout.write(data.text);
        break;
      }

      case "tool_use": {
        if (this.isStreaming) {
          process.stdout.write("\n");
          this.isStreaming = false;
        }
        if (this.spinner.isSpinning) this.spinner.stop();

        this.toolCount++;
        const key = data.name + ":" + (data.id ?? this.toolCount);
        this.toolTimers.set(key, Date.now());

        const ic = tIcon(data.name);
        const inputStr = truncate(JSON.stringify(data.input ?? {}), 60);
        console.log(`\n  ${ic} ${chalk.bold.white(data.name)} ${chalk.dim(inputStr)}`);

        this.spinner.text = chalk.dim(`Running ${data.name}…`);
        this.spinner.indent = 4;
        this.spinner.start();
        break;
      }

      case "tool_use_result": {
        let elapsed = 0;
        for (const [k, v] of this.toolTimers.entries()) {
          if (k.startsWith(data.tool_name + ":")) {
            elapsed = Date.now() - v;
            this.toolTimers.delete(k);
            break;
          }
        }
        const elapsedStr = formatMs(elapsed);

        if (data.result.status === "success") {
          this.spinner.stopAndPersist({
            symbol: chalk.green("    ✓"),
            text: chalk.dim(elapsedStr),
          });
          const output = String(data.result.data ?? "");
          if (output.trim()) {
            box(output, { maxLines: 14 });
          }
        } else {
          this.spinner.stopAndPersist({
            symbol: chalk.red("    ✗"),
            text: `${chalk.red("failed")} ${chalk.dim(elapsedStr)}`,
          });
          const msg = String(data.result.message ?? data.result.data ?? "");
          box(msg, { maxLines: 8, color: chalk.red, label: "error" });
        }

        this.spinner.text = chalk.dim("Thinking…");
        this.spinner.indent = 4;
        this.spinner.start();
        break;
      }

      case "model_response": {
        this.turnCount++;
        this.totalTokensIn += data.tokens_in ?? 0;
        this.totalTokensOut += data.tokens_out ?? 0;
        break;
      }

      case "model_response_complete": {
        if (this.isStreaming) {
          process.stdout.write("\n");
          this.isStreaming = false;
        }
        if (this.spinner.isSpinning) this.spinner.stop();
        break;
      }
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// System prompt
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SYSTEM_PROMPT = `You are a DevOps assistant that helps with deployments, project scaffolding, database migrations, and configuration management.

## Tools
- **deploy**: Deploy a service to an environment (staging/production/dev). Will ask the user for confirmation.
- **scaffold_project**: Create a new project from a template. Will ask for project details interactively.
- **db_migrate**: Run database migrations up or down. Will ask for confirmation, with extra verification for rollbacks.
- **inject_secret**: Securely inject API keys or secrets into config files. Will prompt the user to enter the secret value.
- **collect_form**: Collect structured data from the user through a series of questions.

## Important
- All tools are interactive — they will pause and ask the user for input during execution.
- You don't need to collect information yourself before calling a tool. The tool will ask.
- For deployments, always specify the service name and environment.
- For migrations, specify direction ('up' or 'down') and optionally the number of steps.
- Be helpful and explain what each tool will do before calling it.

## Example interactions
User: "deploy my auth service to staging"
→ Call deploy with service="auth-service", environment="staging"
→ Tool will show pre-flight checks and ask user to confirm

User: "create a new typescript project called my-api"  
→ Call scaffold_project with name="my-api", template="node-ts"
→ Tool will ask for description, author, license interactively

User: "I need to add a Stripe key to my env file"
→ Call inject_secret with key_name="STRIPE_KEY", target=".env"
→ Tool will securely prompt for the actual key value`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Agent factory
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function createAgent(subscriber: TerminalSubscriber) {
  const store = new MemoryStore("interactive-session");

  const model = new AnthropicAdapter({
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    systemPrompt: SYSTEM_PROMPT,
    stream: true,
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  const context = new Context(store);
  const promptMachine = new PromptMachine(model, context, model.name);
  promptMachine.addSubscriber(subscriber);

  const executor = new Executor();
  executor.addSubscriber(subscriber);
  for (const tool of interactiveTools) {
    executor.registerTool(tool);
  }

  const observer = new Observer(
    store,
    context,
    promptMachine,
    30,
    `Summarize: what was deployed/created/migrated, user decisions made, current state.`
  );

  return new Agent(store, executor, context, observer, promptMachine);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REPL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  const spinner = ora({ color: "cyan", spinner: "dots" });
  const subscriber = new TerminalSubscriber(spinner);
  const agent = createAgent(subscriber);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // The handOver callback — shared across all agent.ask() calls
  const handOver = createHandOver(spinner);

  // ── Header ──────────────────────────────────────────────────────
  console.log("");
  console.log(chalk.bold.magenta("  🤝 Ozone Interactive Agent"));
  console.log(chalk.dim(`  📁 ${process.cwd()}`));
  console.log(`  ${hr()}`);
  console.log(chalk.dim("  Tools with human-in-the-loop:"));
  console.log(
    chalk.dim(
      `    🚀 deploy  🏗️  scaffold  🗃️  migrate  🔐 secrets  📋 forms`
    )
  );
  console.log(`  ${hr()}`);
  console.log(
    chalk.dim(
      `  ${chalk.white("exit")} quit  ·  ${chalk.white("stats")} usage`
    )
  );
  console.log(`  ${hr()}`);
  console.log("");
  console.log(
    chalk.dim("  Try: ") +
      chalk.italic('"deploy my auth service to production"')
  );
  console.log(
    chalk.dim("       ") +
      chalk.italic('"scaffold a new typescript API called my-api"')
  );
  console.log(
    chalk.dim("       ") +
      chalk.italic('"run pending database migrations"')
  );
  console.log(
    chalk.dim("       ") +
      chalk.italic('"add my Stripe secret key to .env"')
  );
  console.log("");

  const prompt = () => {
    rl.question(chalk.bold.green("  ❯ "), async (raw) => {
      const input = raw.trim();
      if (!input) return prompt();

      if (input === "exit" || input === "quit") {
        console.log("");
        console.log(`  ${hr()}`);
        console.log(
          chalk.dim(
            `  📊 ${subscriber.turnCount} turns · ` +
              `${subscriber.totalTokensIn.toLocaleString()} in · ` +
              `${subscriber.totalTokensOut.toLocaleString()} out`
          )
        );
        console.log(chalk.dim("  👋 See you later!"));
        console.log("");
        rl.close();
        process.exit(0);
      }

      if (input === "stats") {
        console.log("");
        console.log(
          chalk.dim(
            `  📊 ${subscriber.turnCount} turns · ` +
              `${subscriber.totalTokensIn.toLocaleString()} in · ` +
              `${subscriber.totalTokensOut.toLocaleString()} out`
          )
        );
        console.log("");
        return prompt();
      }

      try {
        console.log("");
        subscriber.resetToolCount();
        spinner.text = chalk.dim("Thinking…");
        spinner.indent = 4;
        spinner.start();

        const t0 = Date.now();

        // ═══════════════════════════════════════════════════════════
        // THIS IS THE KEY LINE — passing handOver as delegateToCaller
        // ═══════════════════════════════════════════════════════════
        const result: any = await agent.ask(
          { sender: "user", text: input },
          handOver // ← tools can now call this to ask the human
        );

        if (spinner.isSpinning) spinner.stop();

        const elapsed = formatMs(Date.now() - t0);
        const last = (result?.messages ?? [])
          .filter((m: Message) => m.sender === "agent")
          .pop();

        if (last?.text && !subscriber.wasStreaming) {
          console.log("");
          for (const line of last.text.split("\n")) {
            console.log(`  ${line}`);
          }
        }

        console.log("");
        console.log(chalk.dim(`  ⏱  ${elapsed}  ·  turn ${subscriber.turnCount}`));
        console.log("");
      } catch (err: any) {
        if (spinner.isSpinning) spinner.stop();
        console.log("");
        console.log(`  ${chalk.red.bold("✗")} ${chalk.red(err.message)}`);
        console.log("");
      }

      prompt();
    });
  };

  prompt();
}

main();