import { CodeBlock } from "@/components/code-block";

export default async function TerminalAgentPage() {
  return (
    <div className="docs-content">
      <h1>Build a Terminal Coding Agent</h1>

      <p>
        In this tutorial you will build an AI coding assistant that runs
        entirely in your terminal — no React, no Next.js. Just{" "}
        <code>@glove/core</code> and Node.js. The agent reads files, edits
        code, runs shell commands, and proposes plans — all through a REPL
        with streaming output and interactive prompts.
      </p>

      <p>
        The other showcase tutorials use <code>@glove/react</code> to render
        tools as React components. This tutorial shows that the same core
        engine powers terminal UIs too. The display stack still works — instead
        of rendering React components, you render terminal prompts. The{" "}
        <code>do</code> function, tool registration, and agent loop are
        identical.
      </p>

      <p>
        <strong>Prerequisites:</strong> You should have read{" "}
        <a href="/docs/concepts">Concepts</a>. Familiarity with Node.js and
        TypeScript is assumed.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>What you will build</h2>

      <p>
        A REPL-based coding agent. You type a prompt, the AI streams its
        response to your terminal, and when it needs to run a tool:
      </p>

      <ol>
        <li>
          <strong>Read and edit files</strong> — the tools have direct access
          to the file system (no API routes, no <code>fetch</code>)
        </li>
        <li>
          <strong>Run shell commands</strong> — with a permission prompt that
          asks you to approve before executing
        </li>
        <li>
          <strong>Propose plans</strong> — the agent presents a numbered plan
          and waits for you to approve, reject, or request changes
        </li>
        <li>
          <strong>Stream output</strong> — text from the AI appears
          character-by-character in real time
        </li>
      </ol>

      <p>
        Four tools, one subscriber, one display handler. The entire agent fits
        in two files.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Architecture: core vs. React</h2>

      <p>
        In the React tutorials, tools run in the browser and call server API
        routes via <code>fetch</code>. In the terminal, everything runs in the
        same Node.js process:
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Concern</th>
            <th>React (<code>@glove/react</code>)</th>
            <th>Terminal (<code>@glove/core</code>)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Tool execution</td>
            <td>Browser — <code>do</code> runs client-side</td>
            <td>Server — <code>do</code> runs in Node.js</td>
          </tr>
          <tr>
            <td>File access</td>
            <td><code>fetch(&quot;/api/fs/read&quot;)</code></td>
            <td><code>readFile(path)</code> directly</td>
          </tr>
          <tr>
            <td>Display stack</td>
            <td>React components via <code>render()</code></td>
            <td>Terminal prompts via <code>readline</code></td>
          </tr>
          <tr>
            <td>Streaming</td>
            <td>React state updates</td>
            <td><code>process.stdout.write()</code></td>
          </tr>
          <tr>
            <td>LLM proxy</td>
            <td><code>createChatHandler</code> on server</td>
            <td>Model adapter in same process</td>
          </tr>
        </tbody>
      </table>

      <p>
        The core engine — <code>Glove</code>, <code>Agent</code>,{" "}
        <code>Executor</code>, <code>DisplayManager</code> — is the same. Only
        the UI layer changes.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>1. Project setup</h2>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`mkdir my-terminal-agent && cd my-terminal-agent
pnpm init
pnpm add @glove/core zod
pnpm add -D tsx`}
      />

      <p>
        <code>@glove/core</code> includes the Anthropic SDK, OpenAI SDK, and
        SQLite driver as dependencies. <code>tsx</code> lets you run TypeScript
        directly without a build step.
      </p>

      <p>
        Create a <code>tsconfig.json</code>:
      </p>

      <CodeBlock
        filename="tsconfig.json"
        language="json"
        code={`{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>2. Define the tools</h2>

      <p>
        Tools are defined as objects that match the <code>.fold()</code>{" "}
        signature. Each has a <code>name</code>, <code>description</code>,{" "}
        <code>inputSchema</code> (Zod), and a <code>do</code> function. Since
        this is Node.js, the <code>do</code> function has direct access to{" "}
        <code>fs</code>, <code>child_process</code>, and everything else — no
        API routes needed.
      </p>

      <CodeBlock
        filename="tools.ts"
        language="typescript"
        code={`import z from "zod";
import { readFile, writeFile } from "fs/promises";
import { exec } from "child_process";
import type { DisplayManagerAdapter } from "@glove/core";

// ─── read_file ───────────────────────────────────────────────────────────────

export const readFileDef = {
  name: "read_file",
  description:
    "Read the contents of a file. Returns the text with line numbers.",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to read"),
  }),
  async do(input: { path: string }) {
    const content = await readFile(input.path, "utf-8");
    const lines = content.split("\\n");
    const numbered = lines
      .map((line, i) => \`\${i + 1} | \${line}\`)
      .join("\\n");
    return \`\${input.path} (\${lines.length} lines)\\n\${numbered}\`;
  },
};

// ─── edit_file ───────────────────────────────────────────────────────────────

export const editFileDef = {
  name: "edit_file",
  description:
    "Edit a file by replacing a specific string. The old_string must " +
    "appear exactly once. Use read_file first to see the exact content.",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to edit"),
    old_string: z.string().describe("Exact string to find and replace"),
    new_string: z.string().describe("Replacement text"),
  }),
  async do(input: { path: string; old_string: string; new_string: string }) {
    const content = await readFile(input.path, "utf-8");

    const count = content.split(input.old_string).length - 1;
    if (count === 0) throw new Error("old_string not found in file.");
    if (count > 1) throw new Error(\`old_string found \${count} times. Must be unique.\`);

    const updated = content.replace(input.old_string, input.new_string);
    await writeFile(input.path, updated, "utf-8");
    return \`Edited \${input.path}\`;
  },
};

// ─── bash ────────────────────────────────────────────────────────────────────

export const bashDef = {
  name: "bash",
  description:
    "Execute a shell command. Returns stdout + stderr. " +
    "Requires user permission before running.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
    timeout: z
      .number()
      .optional()
      .describe("Timeout in seconds. Defaults to 30"),
  }),
  requiresPermission: true,
  async do(input: { command: string; timeout?: number }) {
    const timeout = (input.timeout ?? 30) * 1000;
    return new Promise<string>((resolve) => {
      exec(
        input.command,
        { timeout, maxBuffer: 1024 * 1024 * 5, shell: "/bin/bash" },
        (error, stdout, stderr) => {
          const parts: string[] = [];
          if (stdout.trim()) parts.push(stdout.trim());
          if (stderr.trim()) parts.push(stderr.trim());
          if (error?.killed) parts.push(\`Timed out after \${input.timeout ?? 30}s\`);
          resolve(parts.join("\\n") || "(no output)");
        },
      );
    });
  },
};

// ─── plan ────────────────────────────────────────────────────────────────────

export const planDef = {
  name: "plan",
  description:
    "Present a step-by-step plan for user approval before making " +
    "changes. ALWAYS use this before editing files. Blocks until " +
    "the user approves, rejects, or requests modifications.",
  inputSchema: z.object({
    title: z.string().describe("Short title summarizing the plan"),
    steps: z
      .array(z.string())
      .describe("Ordered list of concrete steps"),
  }),
  async do(
    input: { title: string; steps: string[] },
    display: DisplayManagerAdapter,
  ) {
    // Push a slot and block until the terminal handler resolves it
    const result = await display.pushAndWait({
      renderer: "plan_approval",
      input: { title: input.title, steps: input.steps },
    });
    return JSON.stringify(result);
  },
};`}
      />

      <p>
        Notice the differences from the React tutorials:
      </p>

      <ul>
        <li>
          <strong><code>read_file</code> and <code>edit_file</code></strong>{" "}
          call <code>readFile</code> and <code>writeFile</code> directly — no{" "}
          <code>fetch</code> to a server route
        </li>
        <li>
          <strong><code>bash</code></strong> has{" "}
          <code>requiresPermission: true</code>. The executor automatically
          pushes a permission prompt onto the display stack before running the
          tool. You do not handle permissions inside <code>do</code>.
        </li>
        <li>
          <strong><code>plan</code></strong> calls{" "}
          <code>display.pushAndWait()</code> directly. The <code>do</code>{" "}
          function receives the display manager as its second argument — this
          is the same object that powers React slots, but here it drives
          terminal prompts.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>3. Stream output to the terminal</h2>

      <p>
        A subscriber listens to events from the agent and prints them. The key
        event is <code>text_delta</code> — it fires for each chunk of text as
        the AI streams its response.
      </p>

      <CodeBlock
        filename="subscriber.ts"
        language="typescript"
        code={`import type { SubscriberAdapter } from "@glove/core";

export class TerminalSubscriber implements SubscriberAdapter {
  async record(event_type: string, data: any) {
    switch (event_type) {
      case "text_delta":
        // Stream text character-by-character
        process.stdout.write(data.text);
        break;

      case "tool_use":
        console.log(\`\\n🔧 \${data.name}\`);
        break;

      case "tool_use_result":
        if (data.result.status === "error") {
          console.log(\`❌ \${data.tool_name}: \${data.result.message}\`);
        } else {
          console.log(\`✅ \${data.tool_name}\`);
        }
        break;

      case "model_response_complete":
        // Streaming finished — add a newline
        console.log();
        break;
    }
  }
}`}
      />

      <p>
        Four events are all you need. <code>text_delta</code> uses{" "}
        <code>process.stdout.write</code> (not <code>console.log</code>) to
        avoid adding newlines between chunks. The result is smooth,
        character-by-character streaming in the terminal.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>4. Handle interactive prompts</h2>

      <p>
        When a tool calls <code>display.pushAndWait()</code>, a slot is pushed
        onto the display stack. In React, the slot renders as a component. In
        the terminal, you subscribe to the display manager and handle each slot
        with <code>readline</code>.
      </p>

      <CodeBlock
        filename="prompt-handler.ts"
        language="typescript"
        code={`import * as readline from "node:readline/promises";
import type { DisplayManagerAdapter, Slot } from "@glove/core";

export function setupPromptHandler(
  dm: DisplayManagerAdapter,
  rl: readline.Interface,
) {
  const handled = new Set<string>();

  dm.subscribe(async (stack: Slot<unknown>[]) => {
    for (const slot of stack) {
      if (handled.has(slot.id)) continue;
      handled.add(slot.id);

      // Fire-and-forget — the resolver is set up after subscribe returns
      handleSlot(dm, rl, slot);
    }
  });
}

async function handleSlot(
  dm: DisplayManagerAdapter,
  rl: readline.Interface,
  slot: Slot<unknown>,
) {
  // Yield to let the resolver be registered
  await new Promise((r) => setTimeout(r, 0));

  const input = slot.input as any;

  switch (slot.renderer) {
    case "permission_request": {
      const answer = await rl.question(
        \`\\n⚡ Allow "\${input.toolName}" to run? [y/n]: \`,
      );
      dm.resolve(slot.id, answer.toLowerCase().startsWith("y"));
      break;
    }

    case "plan_approval": {
      console.log(\`\\n📋 \${input.title}\`);
      input.steps.forEach((step: string, i: number) => {
        console.log(\`   \${i + 1}. \${step}\`);
      });
      const answer = await rl.question("[a]pprove / [r]eject / [m]odify: ");
      const action = answer.toLowerCase().startsWith("a")
        ? "approve"
        : answer.toLowerCase().startsWith("m")
          ? "modify"
          : "reject";

      let feedback: string | undefined;
      if (action === "modify") {
        feedback = await rl.question("What should change? ");
      }

      dm.resolve(slot.id, { action, feedback });
      break;
    }

    default:
      console.log(\`[unknown slot: \${slot.renderer}]\`);
      dm.resolve(slot.id, null);
  }
}`}
      />

      <p>
        The important detail: <code>handleSlot</code> is called without{" "}
        <code>await</code> (fire-and-forget). This lets the subscribe callback
        return immediately, which allows the display manager to finish setting
        up the resolver before <code>handleSlot</code> tries to resolve the
        slot.
      </p>

      <p>
        The <code>handled</code> set prevents double-prompting — the subscribe
        callback fires every time the stack changes, so the same slot could
        appear multiple times.
      </p>

      <p>
        The permission prompt (<code>permission_request</code>) is triggered
        automatically by the executor when a tool has{" "}
        <code>requiresPermission: true</code>. You do not call it from the
        tool — the executor pushes the slot for you.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>5. Wire it all together</h2>

      <p>
        The main file creates the store, model, display manager, and Glove
        instance, then runs a REPL loop.
      </p>

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`import * as readline from "node:readline/promises";
import { Glove, SqliteStore, Displaymanager, AnthropicAdapter } from "@glove/core";
import { readFileDef, editFileDef, bashDef, planDef } from "./tools";
import { TerminalSubscriber } from "./subscriber";
import { setupPromptHandler } from "./prompt-handler";

// ─── 1. Store ────────────────────────────────────────────────────────────────
// Use ":memory:" for ephemeral sessions, or a file path for persistence.

const store = new SqliteStore({
  dbPath: "./agent.db",
  sessionId: "main",
});

// ─── 2. Model ────────────────────────────────────────────────────────────────

const model = new AnthropicAdapter({
  model: "claude-sonnet-4-20250514",
  stream: true,
  // Uses ANTHROPIC_API_KEY env var by default
});

// ─── 3. Display manager ─────────────────────────────────────────────────────

const dm = new Displaymanager();

// ─── 4. Build the agent ─────────────────────────────────────────────────────

const glove = new Glove({
  store,
  model,
  displayManager: dm,
  systemPrompt: \`You are a careful, thorough coding assistant running in a terminal.

Your workflow:
1. When given a task, start by reading relevant files to understand the code.
2. Use the plan tool before making any changes. Present clear steps and wait
   for approval.
3. After approval, make changes one at a time using edit_file.
4. After edits, use bash to run tests or verify the changes.
5. If the user rejects a plan, ask what they want to change.

Rules:
- Never edit a file without showing a plan first.
- Never run a command without explaining why.
- Keep explanations concise.\`,
  compaction_config: {
    compaction_instructions:
      "Summarize the conversation. Preserve: files modified, " +
      "task state, errors encountered, key decisions made.",
  },
});

// Register tools
glove
  .fold(readFileDef)
  .fold(editFileDef)
  .fold(bashDef)
  .fold(planDef);

// Add streaming subscriber
glove.addSubscriber(new TerminalSubscriber());

// Build
const agent = glove.build();

// ─── 5. Set up terminal prompt handler ──────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

setupPromptHandler(dm, rl);

// ─── 6. REPL ────────────────────────────────────────────────────────────────

console.log("Terminal Coding Agent");
console.log("Type a message to start. Ctrl+C to exit.\\n");

async function repl() {
  while (true) {
    const input = await rl.question("you > ");
    if (!input.trim()) continue;

    try {
      await agent.processRequest(input.trim());
    } catch (err: any) {
      console.error(\`\\nError: \${err.message}\`);
    }

    console.log(); // blank line between turns
  }
}

repl().catch(console.error);`}
      />

      <p>
        That is the entire agent. The pieces:
      </p>

      <ul>
        <li>
          <strong><code>SqliteStore</code></strong> — persists messages, tokens,
          tasks, and permissions in a local SQLite file. The agent remembers
          previous conversations across restarts.
        </li>
        <li>
          <strong><code>AnthropicAdapter</code></strong> — connects to the
          Anthropic API with streaming. You can swap this for{" "}
          <code>OpenAICompatAdapter</code> to use OpenAI, Gemini, or any
          OpenAI-compatible provider.
        </li>
        <li>
          <strong><code>Displaymanager</code></strong> — the same display stack
          that powers React slots. Here it drives terminal prompts.
        </li>
        <li>
          <strong><code>.fold()</code></strong> — registers each tool. The
          builder validates the schema and wires the <code>do</code> function
          into the executor.
        </li>
        <li>
          <strong><code>.addSubscriber()</code></strong> — hooks up the terminal
          subscriber for streaming output.
        </li>
        <li>
          <strong><code>.build()</code></strong> — locks the configuration and
          returns a runnable agent.
        </li>
        <li>
          <strong><code>processRequest()</code></strong> — sends a message to
          the agent. The agent calls the LLM, executes tools, loops until the
          response is complete, and returns.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>6. Run it</h2>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`ANTHROPIC_API_KEY=sk-... npx tsx agent.ts`}
      />

      <p>Try these prompts:</p>

      <ul>
        <li>
          <strong>&ldquo;Read package.json&rdquo;</strong> — the agent calls{" "}
          <code>read_file</code> and prints the content with line numbers
        </li>
        <li>
          <strong>&ldquo;Add a start script to package.json&rdquo;</strong> —
          the agent proposes a plan, waits for approval, then edits the file
        </li>
        <li>
          <strong>&ldquo;Run the tests&rdquo;</strong> — a permission prompt
          appears: &ldquo;Allow bash to run? [y/n]&rdquo;
        </li>
        <li>
          <strong>Reject a plan</strong> — type &ldquo;r&rdquo; at the plan
          prompt, then explain what you want different
        </li>
        <li>
          <strong>Request modifications</strong> — type &ldquo;m&rdquo; and
          describe the change. The agent revises and re-proposes.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>How the agent loop works</h2>

      <p>
        When you call <code>processRequest(&quot;Add a start script&quot;)</code>,
        the engine runs this loop:
      </p>

      <ol>
        <li>
          Your message is appended to the conversation history in the store
        </li>
        <li>
          The model adapter sends the full history + tool schemas to the LLM.
          The subscriber receives <code>text_delta</code> events as the
          response streams.
        </li>
        <li>
          If the LLM response includes tool calls, the executor runs each one:
          <ul>
            <li>
              For tools with <code>requiresPermission</code>, the executor
              pushes a <code>permission_request</code> slot onto the display
              stack. Your terminal handler prompts the user.
            </li>
            <li>
              The tool&apos;s <code>do</code> function executes. If it calls{" "}
              <code>display.pushAndWait()</code>, another slot is pushed and
              the terminal handler prompts again.
            </li>
            <li>
              Tool results are appended to the history and sent back to the LLM.
            </li>
          </ul>
        </li>
        <li>
          The loop continues until the LLM responds with text only (no tool
          calls). <code>processRequest</code> returns.
        </li>
      </ol>

      <p>
        The compaction config kicks in when token usage exceeds the limit. The
        engine summarizes the conversation and starts fresh, preserving task
        state. This lets long sessions continue without hitting context limits.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Display patterns used</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Display</th>
            <th>Terminal behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>read_file</code></td>
            <td>None</td>
            <td>Silent — returns data to the AI</td>
          </tr>
          <tr>
            <td><code>edit_file</code></td>
            <td>None</td>
            <td>Silent — writes file directly</td>
          </tr>
          <tr>
            <td><code>bash</code></td>
            <td>Auto permission</td>
            <td>&ldquo;Allow bash to run? [y/n]&rdquo;</td>
          </tr>
          <tr>
            <td><code>plan</code></td>
            <td><code>pushAndWait</code></td>
            <td>Shows numbered plan, prompts approve/reject/modify</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Swapping the model</h2>

      <p>
        The <code>AnthropicAdapter</code> can be replaced with any provider.
        For OpenAI or OpenAI-compatible APIs:
      </p>

      <CodeBlock
        filename="agent.ts (alternative model)"
        language="typescript"
        code={`import { OpenAICompatAdapter } from "@glove/core";

const model = new OpenAICompatAdapter({
  model: "gpt-4o-mini",
  baseURL: "https://api.openai.com/v1",
  stream: true,
  // Uses OPENAI_API_KEY env var by default
});`}
      />

      <p>
        For OpenRouter, Gemini, or other providers, change the{" "}
        <code>baseURL</code> and <code>apiKey</code>.
        You can also hot-swap the model at runtime:
      </p>

      <CodeBlock
        filename="agent.ts (hot-swap)"
        language="typescript"
        code={`// Switch model between requests
agent.setModel(new AnthropicAdapter({
  model: "claude-opus-4-20250514",
  stream: true,
}));`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Adding more tools</h2>

      <p>
        The{" "}
        <a href="https://github.com/user/glove/tree/main/examples/coding-agent/tools.ts">
          examples/coding-agent
        </a>{" "}
        directory includes a full set of tools you can add to your agent:
      </p>

      <ul>
        <li>
          <code>list_dir</code> — tree-style directory listing
        </li>
        <li>
          <code>search</code> / <code>grep</code> — codebase search with
          ripgrep fallback
        </li>
        <li>
          <code>write_file</code> — create new files
        </li>
        <li>
          <code>glob</code> — find files by pattern
        </li>
        <li>
          <code>git_status</code> / <code>git_diff</code> / <code>git_log</code>{" "}
          — git operations
        </li>
        <li>
          <code>ask_question</code> — ask the user a question with optional
          choices
        </li>
      </ul>

      <p>
        Each tool follows the same <code>Tool&lt;I&gt;</code> interface. To
        register them, either use <code>.fold()</code> or register directly on
        the executor.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Next steps</h2>

      <ul>
        <li>
          <a href="/docs/showcase/coding-agent">Build a Coding Agent (React)</a>{" "}
          — see how the same tools work with a React UI and the gate-execute-display
          pattern
        </li>
        <li>
          <a href="/docs/showcase/travel-planner">Build a Travel Planner</a>{" "}
          — see the display stack with <code>pushAndForget</code> for
          persistent cards
        </li>
        <li>
          <a href="/docs/showcase/ecommerce-store">Build a Shopping Assistant</a>{" "}
          — product grids, variant pickers, and checkout forms
        </li>
        <li>
          <a href="/docs/core">Core API Reference</a> — full documentation for{" "}
          <code>Glove</code>, <code>SqliteStore</code>,{" "}
          <code>AnthropicAdapter</code>, and <code>SubscriberAdapter</code>
        </li>
      </ul>
    </div>
  );
}
