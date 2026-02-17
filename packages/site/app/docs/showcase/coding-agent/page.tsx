import { CodeBlock } from "@/components/code-block";

export default async function CodingAgentPage() {
  return (
    <div className="docs-content">
      <h1>Build a Coding Agent</h1>

      <p>
        In this tutorial you will build an AI coding assistant that can read
        files, search code, propose plans, edit files, and run commands — all
        with the user in control. The display stack turns the AI from a blind
        executor into a responsible collaborator.
      </p>

      <p>
        This is the most compelling use of the display stack: the AI shows you
        a plan before making changes, presents diffs for review, and asks for
        permission before running destructive commands. The user sees real UI
        at every decision point, not just text.
      </p>

      <p>
        <strong>Prerequisites:</strong> You should have completed{" "}
        <a href="/docs/getting-started">Getting Started</a> and read{" "}
        <a href="/docs/display-stack">The Display Stack</a>.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>What you will build</h2>

      <p>
        A coding agent where the user can say &ldquo;Refactor the auth module
        to use JWT&rdquo; and the app will:
      </p>

      <ol>
        <li>
          Read files and search the codebase to understand the current code
          (pure tools, no display)
        </li>
        <li>
          Show search results as a persistent card so the user can see what
          the AI found (<code>pushAndForget</code>)
        </li>
        <li>
          Propose a step-by-step plan and wait for approval before making any
          changes (<code>pushAndWait</code>)
        </li>
        <li>
          Show a diff preview for each edit and wait for the user to accept
          (<code>pushAndWait</code>)
        </li>
        <li>
          Ask permission before running shell commands, and show the output
          (<code>pushAndWait</code> + <code>pushAndForget</code>)
        </li>
      </ol>

      <p>
        The display stack turns every critical decision into a UI checkpoint.
        The AI never makes changes you haven&apos;t approved.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Understanding the architecture</h2>

      <p>
        A coding agent is different from the{" "}
        <a href="/docs/showcase/travel-planner">travel planner</a>. The travel
        planner&apos;s tools are entirely browser-based — they show UI and
        collect input, nothing more. A coding agent needs to read files, write
        files, and run shell commands. Those operations require a server.
      </p>

      <p>
        Here is how the pieces fit together:
      </p>

      <ul>
        <li>
          <strong>
            <code>createChatHandler</code>
          </strong>{" "}
          is a thin LLM proxy. It forwards your conversation to OpenAI or
          Anthropic and streams back the response. It sends tool{" "}
          <em>schemas</em> (name, description, parameters) to the LLM so the
          AI knows what tools are available — but it does not execute tools.
        </li>
        <li>
          <strong>Tool <code>do</code> functions run in the browser.</strong>{" "}
          When the AI requests a tool call, <code>useGlove</code> executes the{" "}
          <code>do</code> function client-side. This is why the travel
          planner works — its tools only use the display stack and pure
          computation.
        </li>
        <li>
          <strong>Server operations use API routes.</strong> For file system
          access, shell commands, and other server-side work, your{" "}
          <code>do</code> function calls a Next.js API route via{" "}
          <code>fetch</code>. The API route runs on the server with full
          Node.js access.
        </li>
      </ul>

      <p>The flow for a tool like <code>edit_file</code>:</p>

      <ol>
        <li>AI requests <code>edit_file</code> with path, old string, new string</li>
        <li>
          The <code>do</code> function runs in the browser — it calls the
          server API route to read the file
        </li>
        <li>
          The <code>do</code> function pushes a diff preview onto the display
          stack (<code>pushAndWait</code>) — this is browser-side
        </li>
        <li>User clicks Apply — the <code>do</code> function calls another API route to write the file</li>
        <li>The tool result is sent back to the AI</li>
      </ol>

      <p>
        The display stack stays client-side (that is where React renders). The
        heavy lifting happens server-side through API routes. The{" "}
        <code>do</code> function is the bridge between them.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>1. Project setup</h2>

      <p>
        Start from a Next.js project with Glove installed:
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-core glove-react glove-next zod`}
      />

      <CodeBlock
        filename="app/api/chat/route.ts"
        language="typescript"
        code={`import { createChatHandler } from "glove-next";

// This is the LLM proxy — it does NOT execute tools.
// It sends tool schemas to the AI and streams back responses.
export const POST = createChatHandler({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
});`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>2. Server API routes</h2>

      <p>
        Since tool <code>do</code> functions run in the browser, you need
        server-side API routes for anything that requires Node.js — file
        reads, file writes, and shell commands. Create three routes:
      </p>

      <CodeBlock
        filename="app/api/fs/read/route.ts"
        language="typescript"
        code={`import { readFile } from "fs/promises";
import { resolve, normalize } from "path";
import { NextResponse } from "next/server";

// The project root that the agent can access
const PROJECT_ROOT = process.cwd();

function safePath(relativePath: string): string {
  const resolved = resolve(PROJECT_ROOT, relativePath);
  // Prevent path traversal outside the project
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error("Path outside project root");
  }
  return resolved;
}

export async function POST(req: Request) {
  const { path } = await req.json();
  try {
    const content = await readFile(safePath(path), "utf-8");
    return NextResponse.json({ content });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 400 },
    );
  }
}`}
      />

      <CodeBlock
        filename="app/api/fs/write/route.ts"
        language="typescript"
        code={`import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";

const PROJECT_ROOT = process.cwd();

function safePath(relativePath: string): string {
  const resolved = resolve(PROJECT_ROOT, relativePath);
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error("Path outside project root");
  }
  return resolved;
}

export async function POST(req: Request) {
  const { path, oldString, newString } = await req.json();
  try {
    const fullPath = safePath(path);
    const content = await readFile(fullPath, "utf-8");

    if (!content.includes(oldString)) {
      return NextResponse.json(
        { error: "old_string not found in file" },
        { status: 400 },
      );
    }

    const updated = content.replace(oldString, newString);
    await writeFile(fullPath, updated);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 400 },
    );
  }
}`}
      />

      <CodeBlock
        filename="app/api/fs/exec/route.ts"
        language="typescript"
        code={`import { exec } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

const execAsync = promisify(exec);

// Allowlist of safe command prefixes
const ALLOWED_PREFIXES = [
  "npm test", "pnpm test", "npx ", "pnpm ",
  "git status", "git diff", "git log",
  "ls", "cat", "rg ", "grep ",
];

export async function POST(req: Request) {
  const { command } = await req.json();

  // Only allow known-safe commands
  const isAllowed = ALLOWED_PREFIXES.some((p) =>
    command.startsWith(p),
  );
  if (!isAllowed) {
    return NextResponse.json(
      { error: \`Command not allowed: \${command}\` },
      { status: 403 },
    );
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 30000,
      cwd: process.cwd(),
    });
    return NextResponse.json({
      output: (stdout + stderr).trim() || "(no output)",
    });
  } catch (err: any) {
    return NextResponse.json({
      output: err.stderr || err.message,
      error: true,
    });
  }
}`}
      />

      <p>
        Notice the security measures: path traversal prevention on file routes,
        and a command allowlist on the exec route. In a real application, you
        would add authentication and more restrictive sandboxing.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>3. Read and search tools</h2>

      <p>
        Now build the client-side tools. Each tool&apos;s <code>do</code>{" "}
        function calls the server API routes via <code>fetch</code>, then uses
        the display stack to show results.
      </p>

      <p>
        The <code>read_file</code> tool has no <code>render</code> function —
        it is invisible to the user. The AI reads files silently to build
        context.
      </p>

      <CodeBlock
        filename="lib/tools/read-file.tsx"
        language="tsx"
        code={`import { z } from "zod";
import type { ToolConfig } from "glove-react";

export const readFileTool: ToolConfig = {
  name: "read_file",
  description: "Read the contents of a file. Returns the full text.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the project root"),
  }),

  async do(input) {
    // Call the server API route — file system access happens server-side
    const res = await fetch("/api/fs/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: input.path }),
    });
    const data = await res.json();
    if (data.error) return \`Error: \${data.error}\`;
    return data.content;
  },
  // No render — this tool doesn't show UI
};`}
      />

      <p>
        The <code>search_code</code> tool calls the server to run{" "}
        <code>rg</code>, then shows results as a persistent card using{" "}
        <code>pushAndForget</code>. The user sees what the AI found, but the
        tool does not wait — the AI keeps working.
      </p>

      <CodeBlock
        filename="lib/tools/search-code.tsx"
        language="tsx"
        code={`import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const searchCode: ToolConfig = {
  name: "search_code",
  description:
    "Search the codebase for a pattern. Returns matching files and lines. " +
    "Shows results as a card in the UI.",
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    glob: z.string().optional().describe("File glob filter, e.g. '*.ts'"),
  }),

  async do(input, display) {
    // Build the rg command and run it on the server
    const globFlag = input.glob ? \` --glob '\${input.glob}'\` : "";
    const command = \`rg --json '\${input.pattern}'\${globFlag}\`;

    const res = await fetch("/api/fs/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    const data = await res.json();

    // Parse ripgrep JSON output into readable format
    const matches = (data.output || "")
      .split("\\n")
      .filter(Boolean)
      .map((line: string) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter((m: any) => m?.type === "match")
      .map((m: any) => ({
        file: m.data.path.text,
        line: m.data.line_number,
        text: m.data.lines.text.trim(),
      }))
      .slice(0, 20);

    // Show results as a persistent card — pushAndForget
    if (matches.length > 0) {
      await display.pushAndForget({
        input: { pattern: input.pattern, matches },
      });
    }

    return JSON.stringify(matches);
  },

  render({ data }: SlotRenderProps) {
    const { pattern, matches } = data as {
      pattern: string;
      matches: { file: string; line: number; text: string }[];
    };
    return (
      <div style={{ padding: 16, borderRadius: 12, background: "#141414", border: "1px solid #262626" }}>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
          Search results for <code style={{ color: "#9ED4B8" }}>{pattern}</code>
          {" "}— {matches.length} match{matches.length !== 1 ? "es" : ""}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {matches.map((m, i) => (
            <div
              key={i}
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 4,
                background: "#0a0a0a",
              }}
            >
              <span style={{ color: "#888" }}>{m.file}:{m.line}</span>
              {"  "}
              <span style={{ color: "#ededed" }}>{m.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  },
};`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>4. The plan approval tool</h2>

      <p>
        Before making any changes, the AI should explain what it plans to do
        and wait for approval. This tool is entirely client-side — no server
        route needed. It only uses the display stack.
      </p>

      <CodeBlock
        filename="lib/tools/propose-plan.tsx"
        language="tsx"
        code={`import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const proposePlan: ToolConfig = {
  name: "propose_plan",
  description:
    "Present a step-by-step plan to the user for approval before " +
    "making changes. ALWAYS use this before editing files. " +
    "Blocks until the user approves or rejects.",
  inputSchema: z.object({
    title: z.string().describe("Plan title, e.g. 'Refactor auth to JWT'"),
    steps: z
      .array(
        z.object({
          title: z.string().describe("Step title"),
          description: z.string().describe("What this step does"),
        }),
      )
      .describe("Ordered list of planned changes"),
  }),

  // This tool is pure display stack — no server call needed
  async do(input, display) {
    const approved = await display.pushAndWait({ input });

    return approved
      ? "Plan approved — proceed with the changes."
      : "Plan rejected — ask the user what they want to change.";
  },

  render({ data, resolve }: SlotRenderProps) {
    const { title, steps } = data as {
      title: string;
      steps: { title: string; description: string }[];
    };
    return (
      <div style={{ padding: 16, border: "1px solid #9ED4B8", borderRadius: 12 }}>
        <p style={{ fontWeight: 600, marginBottom: 12 }}>{title}</p>
        <ol style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {steps.map((step, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "6px 10px",
                borderRadius: 6,
                background: "#0a0a0a",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#9ED4B8" }}>
                  {i + 1}
                </span>
                <strong style={{ fontSize: 13 }}>{step.title}</strong>
              </div>
              <span style={{ fontSize: 12, color: "#888", paddingLeft: 18 }}>
                {step.description}
              </span>
            </li>
          ))}
        </ol>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={() => resolve(true)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 6,
              background: "#22c55e",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Approve Plan
          </button>
          <button
            onClick={() => resolve(false)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 6,
              background: "#262626",
              color: "#888",
              cursor: "pointer",
            }}
          >
            Reject
          </button>
        </div>
      </div>
    );
  },
};`}
      />

      <p>
        The description says &ldquo;ALWAYS use this before editing files.&rdquo;
        This is how you encode safety rules — through tool descriptions. The
        AI reads the description and follows it. Combined with the system
        prompt (step 7), this creates a reliable approval gate.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>5. The diff preview tool</h2>

      <p>
        When the AI edits a file, it should show you what it is about to
        change. This tool combines both patterns: it calls the server to
        read the file, shows a diff using <code>pushAndWait</code>, and if
        approved, calls the server again to write the file.
      </p>

      <CodeBlock
        filename="lib/tools/edit-file.tsx"
        language="tsx"
        code={`import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const editFile: ToolConfig = {
  name: "edit_file",
  description:
    "Edit a file by replacing a specific string. Shows a diff preview " +
    "and waits for user approval before writing. Use this for all " +
    "code modifications.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to project root"),
    oldString: z.string().describe("The exact text to find and replace"),
    newString: z.string().describe("The replacement text"),
  }),

  async do(input, display) {
    // Step 1: Read the file from the server to verify the edit is valid
    const readRes = await fetch("/api/fs/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: input.path }),
    });
    const readData = await readRes.json();

    if (readData.error) return \`Error: \${readData.error}\`;
    if (!readData.content.includes(input.oldString)) {
      return "Error: old_string not found in file.";
    }

    // Step 2: Show the diff and wait for approval (client-side display stack)
    const approved = await display.pushAndWait({
      input: {
        path: input.path,
        oldString: input.oldString,
        newString: input.newString,
      },
    });

    if (!approved) return "Edit rejected by user.";

    // Step 3: Write the file on the server
    const writeRes = await fetch("/api/fs/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: input.path,
        oldString: input.oldString,
        newString: input.newString,
      }),
    });
    const writeData = await writeRes.json();

    if (writeData.error) return \`Error: \${writeData.error}\`;
    return "File updated successfully.";
  },

  render({ data, resolve }: SlotRenderProps) {
    const { path, oldString, newString } = data as {
      path: string;
      oldString: string;
      newString: string;
    };
    return (
      <div style={{ padding: 16, borderRadius: 12, border: "1px solid #333" }}>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
          Edit: <code style={{ color: "#9ED4B8" }}>{path}</code>
        </p>

        {/* Removed lines */}
        <div style={{ marginBottom: 8 }}>
          {oldString.split("\\n").map((line, i) => (
            <div
              key={\`old-\${i}\`}
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                padding: "2px 8px",
                background: "rgba(239, 68, 68, 0.1)",
                color: "#ef4444",
                borderLeft: "3px solid #ef4444",
              }}
            >
              - {line}
            </div>
          ))}
        </div>

        {/* Added lines */}
        <div style={{ marginBottom: 12 }}>
          {newString.split("\\n").map((line, i) => (
            <div
              key={\`new-\${i}\`}
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                padding: "2px 8px",
                background: "rgba(34, 197, 94, 0.1)",
                color: "#22c55e",
                borderLeft: "3px solid #22c55e",
              }}
            >
              + {line}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => resolve(true)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 6,
              background: "#22c55e",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Apply Edit
          </button>
          <button
            onClick={() => resolve(false)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 6,
              background: "#262626",
              color: "#888",
              cursor: "pointer",
            }}
          >
            Reject
          </button>
        </div>
      </div>
    );
  },
};`}
      />

      <p>
        This is the pattern that makes AI coding assistants trustworthy.
        The <code>do</code> function talks to the server to read the file,
        shows a diff in the browser, and only writes to the server after the
        user approves. The server never sees the write request unless the
        user clicked Apply.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>6. The command runner tool</h2>

      <p>
        Running shell commands is the most dangerous capability. The display
        stack adds two layers of safety: a permission prompt before executing,
        and an output card after.
      </p>

      <p>
        This tool uses <strong>both</strong> display stack patterns in a single
        call — <code>pushAndWait</code> for the permission gate, then{" "}
        <code>pushAndForget</code> to show the output.
      </p>

      <CodeBlock
        filename="lib/tools/run-command.tsx"
        language="tsx"
        code={`import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const runCommand: ToolConfig = {
  name: "run_command",
  description:
    "Run a shell command. Shows the command for user approval first, " +
    "then displays the output. Use for running tests, installing " +
    "packages, git operations, or build commands.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to run"),
    reason: z.string().describe("Why this command needs to run"),
  }),

  async do(input, display) {
    // Step 1: Ask permission in the browser (pushAndWait)
    const approved = await display.pushAndWait({
      input: { command: input.command, reason: input.reason, phase: "permission" },
    });

    if (!approved) return "Command rejected by user.";

    // Step 2: Execute on the server
    const res = await fetch("/api/fs/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: input.command }),
    });
    const data = await res.json();

    // Step 3: Show output in the browser (pushAndForget)
    await display.pushAndForget({
      input: {
        command: input.command,
        output: data.output,
        phase: data.error ? "error" : "output",
      },
    });

    if (data.error) return \`Command failed: \${data.output}\`;
    return data.output;
  },

  render({ data, resolve }: SlotRenderProps) {
    const { phase } = data as { phase: string };

    // Permission prompt (pushAndWait — resolve is available)
    if (phase === "permission") {
      const { command, reason } = data as {
        command: string;
        reason: string;
        phase: string;
      };
      return (
        <div style={{ padding: 16, border: "1px dashed #f59e0b", borderRadius: 12 }}>
          <p style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600, marginBottom: 8 }}>
            Run command?
          </p>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 13,
              padding: "8px 12px",
              background: "#0a0a0a",
              borderRadius: 6,
              marginBottom: 8,
            }}
          >
            $ {command}
          </div>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>{reason}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => resolve(true)}
              style={{
                padding: "8px 16px",
                border: "none",
                borderRadius: 6,
                background: "#22c55e",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Run
            </button>
            <button
              onClick={() => resolve(false)}
              style={{
                padding: "8px 16px",
                border: "none",
                borderRadius: 6,
                background: "#262626",
                color: "#888",
                cursor: "pointer",
              }}
            >
              Deny
            </button>
          </div>
        </div>
      );
    }

    // Output display (pushAndForget — no resolve needed)
    const { command, output } = data as {
      command: string;
      output: string;
      phase: string;
    };
    const isError = phase === "error";
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          borderLeft: \`3px solid \${isError ? "#ef4444" : "#333"}\`,
          background: "#141414",
        }}
      >
        <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
          $ {command}
        </p>
        <pre
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            color: isError ? "#ef4444" : "#ededed",
            whiteSpace: "pre-wrap",
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {output}
        </pre>
      </div>
    );
  },
};`}
      />

      <p>
        The <code>render</code> function handles both phases by checking{" "}
        <code>data.phase</code>. For the permission prompt, it uses{" "}
        <code>resolve</code> (the user must respond). For the output card,
        there is no <code>resolve</code> call — it is fire-and-forget.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>7. Wire it together</h2>

      <CodeBlock
        filename="lib/glove.ts"
        language="typescript"
        code={`import { GloveClient } from "glove-react";
import { readFileTool } from "./tools/read-file";
import { searchCode } from "./tools/search-code";
import { proposePlan } from "./tools/propose-plan";
import { editFile } from "./tools/edit-file";
import { runCommand } from "./tools/run-command";

export const gloveClient = new GloveClient({
  // Points to the LLM proxy — NOT where tools execute
  endpoint: "/api/chat",

  systemPrompt: \`You are a careful, thorough coding assistant. You help
users understand and modify their codebase.

Your workflow:
1. When given a task, start by reading relevant files and searching
   the codebase to understand the current state.
2. ALWAYS use propose_plan before making any changes. Present a clear
   step-by-step plan and wait for approval.
3. After the plan is approved, make changes one file at a time using
   edit_file. Each edit shows a diff for review.
4. After all edits, use run_command to run tests or verify the changes.
5. If a test fails, read the error, explain it, and propose a fix.

Rules:
- Never edit a file without showing a plan first.
- Never run a command without explaining why.
- If the user rejects a plan or edit, ask what they want to change.
- Show search results when you find something relevant.
- Keep explanations concise — the UI speaks for itself.\`,

  tools: [readFileTool, searchCode, proposePlan, editFile, runCommand],
});`}
      />

      <p>
        The <code>endpoint</code> points to the LLM proxy. The server API
        routes (<code>/api/fs/read</code>, <code>/api/fs/write</code>,{" "}
        <code>/api/fs/exec</code>) are called by the tools directly.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>8. Build the chat UI</h2>

      <CodeBlock
        filename="app/page.tsx"
        language="tsx"
        code={`"use client";

import { useState } from "react";
import { useGlove } from "glove-react";

export default function CodingAgent() {
  const {
    timeline,
    streamingText,
    busy,
    sendMessage,
    slots,
    renderSlot,
  } = useGlove();
  const [input, setInput] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    sendMessage(input.trim());
    setInput("");
  }

  return (
    <div style={{ maxWidth: 700, margin: "2rem auto" }}>
      <h1>Coding Agent</h1>

      <div>
        {timeline.map((entry, i) => {
          if (entry.kind === "user")
            return <div key={i} style={{ margin: "1rem 0" }}><strong>You:</strong> {entry.text}</div>;
          if (entry.kind === "agent_text")
            return <div key={i} style={{ margin: "1rem 0" }}><strong>Agent:</strong> {entry.text}</div>;
          if (entry.kind === "tool")
            return (
              <div key={i} style={{ margin: "0.5rem 0", fontSize: "0.85rem", color: "#888" }}>
                {entry.name} — {entry.status}
              </div>
            );
          return null;
        })}
      </div>

      {streamingText && (
        <div style={{ opacity: 0.7 }}><strong>Agent:</strong> {streamingText}</div>
      )}

      {/* Display stack — plans, diffs, permission prompts, output cards */}
      {slots.length > 0 && (
        <div style={{ margin: "1rem 0", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {slots.map(renderSlot)}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe what you want to change..."
          disabled={busy}
          style={{ flex: 1, padding: "0.5rem", fontFamily: "monospace" }}
        />
        <button type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>9. Run it</h2>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm dev`}
      />

      <p>Try these prompts:</p>

      <ul>
        <li>
          <strong>&ldquo;Search for all TODO comments in the codebase&rdquo;</strong>{" "}
          — the AI runs <code>search_code</code> and a results card appears
        </li>
        <li>
          <strong>&ldquo;Rename the function getUserById to
          fetchUserById&rdquo;</strong> — the AI proposes a plan, then shows a
          diff for each file that needs changing
        </li>
        <li>
          <strong>&ldquo;Run the tests&rdquo;</strong> — a permission prompt
          appears, then the output card shows the results
        </li>
        <li>
          <strong>Reject a plan</strong> — click Reject and explain what you
          want different. The AI revises and re-proposes.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>Where each piece runs</h2>

      <p>
        Here is a summary of the architecture. Understanding this split is
        key to building tools that need server access:
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Piece</th>
            <th>Where it runs</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>createChatHandler</code></td>
            <td>Server</td>
            <td>Proxies to OpenAI/Anthropic. Sends tool schemas, streams responses.</td>
          </tr>
          <tr>
            <td>Tool <code>do</code> functions</td>
            <td>Browser</td>
            <td>Called by <code>useGlove</code> when the AI requests a tool call.</td>
          </tr>
          <tr>
            <td>Tool <code>render</code> functions</td>
            <td>Browser</td>
            <td>React components that show in the display stack.</td>
          </tr>
          <tr>
            <td><code>/api/fs/*</code> routes</td>
            <td>Server</td>
            <td>File reads, writes, and shell commands via Node.js APIs.</td>
          </tr>
          <tr>
            <td>Display stack</td>
            <td>Browser</td>
            <td><code>pushAndWait</code> and <code>pushAndForget</code> manage React components.</td>
          </tr>
        </tbody>
      </table>

      <p>
        The <code>do</code> function is the bridge. It runs in the browser,
        so it can call <code>display.pushAndWait()</code> to show UI. And it
        can call <code>fetch()</code> to reach server API routes for operations
        that need Node.js. This is what makes the pattern work — the display
        stack and the server are both accessible from the same function.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>How the display stack makes this safe</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Without display stack</th>
            <th>With display stack</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Search</td>
            <td>AI silently reads results</td>
            <td>Results card visible to user</td>
          </tr>
          <tr>
            <td>Plan</td>
            <td>AI describes changes in text</td>
            <td>Structured plan with Approve/Reject buttons</td>
          </tr>
          <tr>
            <td>Edit</td>
            <td>AI writes to file directly</td>
            <td>Diff preview with Apply/Reject buttons</td>
          </tr>
          <tr>
            <td>Command</td>
            <td>AI runs commands blindly</td>
            <td>Permission prompt, then output card</td>
          </tr>
        </tbody>
      </table>

      <p>
        The AI still orchestrates everything. But the user approves every
        mutation. This is the difference between a tool that helps you code and
        a tool that codes <em>at</em> you.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>The gate-execute-display pattern</h2>

      <p>
        The coding agent showcases a reusable pattern for any tool that
        performs a mutation through a server:
      </p>

      <CodeBlock
        filename="conceptual flow"
        language="typescript"
        code={`async do(input, display) {
  // Gate: show preview, wait for approval (browser — pushAndWait)
  const approved = await display.pushAndWait({ input: { ... } });
  if (!approved) return "Rejected";

  // Execute: call the server API route (server — fetch)
  const res = await fetch("/api/...", { method: "POST", body: ... });

  // Display: show result (browser — pushAndForget)
  await display.pushAndForget({ input: { output: res.data } });

  return res.data;
}`}
      />

      <p>
        Gate, execute, display. The gate ensures the user consents. The
        execute happens on the server. The display shows the result. This
        pattern works for file edits, database writes, API calls, email
        sends, deployments — anything where the operation needs server
        access and &ldquo;undo&rdquo; is expensive.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Display patterns used</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Pattern</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>read_file</code></td>
            <td>No display</td>
            <td>Silent server call — AI builds context</td>
          </tr>
          <tr>
            <td><code>search_code</code></td>
            <td><code>pushAndForget</code></td>
            <td>Show results, AI keeps working</td>
          </tr>
          <tr>
            <td><code>propose_plan</code></td>
            <td><code>pushAndWait</code></td>
            <td>Must approve before any changes</td>
          </tr>
          <tr>
            <td><code>edit_file</code></td>
            <td><code>pushAndWait</code></td>
            <td>Must review diff before server writes</td>
          </tr>
          <tr>
            <td><code>run_command</code></td>
            <td>Both</td>
            <td><code>pushAndWait</code> for permission, <code>pushAndForget</code> for output</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Next steps</h2>

      <ul>
        <li>
          <a href="/docs/showcase/travel-planner">Build a Travel Planner</a>{" "}
          — see a different display stack pattern: progressive preference
          gathering and interactive itinerary planning (all client-side tools)
        </li>
        <li>
          <a href="/docs/showcase/ecommerce-store">Build a Shopping Assistant</a>{" "}
          — product browsing, variant selection, and checkout with server routes
        </li>
        <li>
          <a href="/docs/showcase/terminal-agent">Build a Terminal Agent</a>{" "}
          — the same core engine with terminal prompts instead of React
        </li>
        <li>
          <a href="/docs/display-stack">The Display Stack</a> — deep dive
          into <code>pushAndWait</code>, <code>pushAndForget</code>, and{" "}
          <code>SlotRenderProps</code>
        </li>
        <li>
          <a href="/tools">Tool Registry</a> — pre-built tools with
          renderers you can use immediately
        </li>
        <li>
          <a href="/docs/react">React API Reference</a> — full API
          documentation
        </li>
      </ul>
    </div>
  );
}
