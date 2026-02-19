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
          the AI found (<code>pushAndForget</code> with{" "}
          <code>displayStrategy: &quot;stay&quot;</code>)
        </li>
        <li>
          Propose a step-by-step plan and wait for approval before making any
          changes (<code>pushAndWait</code> with{" "}
          <code>displayStrategy: &quot;hide-on-complete&quot;</code>)
        </li>
        <li>
          Show a diff preview for each edit and wait for the user to accept
          (<code>pushAndWait</code> with{" "}
          <code>displayStrategy: &quot;hide-on-complete&quot;</code>)
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
        context. Since it has no display UI, it stays as a plain{" "}
        <code>ToolConfig</code>.
      </p>

      <CodeBlock
        filename="lib/tools/read-file.tsx"
        language="tsx"
        code={`import { z } from "zod";
import type { ToolConfig } from "glove-react";

// Pure tool — no display UI, so ToolConfig is the right choice.
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
    if (data.error) return { status: "error" as const, data: \`Error: \${data.error}\` };
    return { status: "success" as const, data: data.content };
  },
  // No render — this tool doesn't show UI
};`}
      />

      <p>
        The <code>search_code</code> tool calls the server to run{" "}
        <code>rg</code>, then shows results as a persistent card using{" "}
        <code>pushAndForget</code>. The user sees what the AI found, but the
        tool does not wait — the AI keeps working. This tool uses{" "}
        <code>defineTool</code> for type-safe display props, and{" "}
        <code>displayStrategy: &quot;stay&quot;</code> so results remain
        visible throughout the conversation.
      </p>

      <CodeBlock
        filename="lib/tools/search-code.tsx"
        language="tsx"
        code={`import { z } from "zod";
import { defineTool } from "glove-react";

const searchDisplaySchema = z.object({
  pattern: z.string(),
  matches: z.array(
    z.object({
      file: z.string(),
      line: z.number(),
      text: z.string(),
    }),
  ),
});

export const searchCode = defineTool({
  name: "search_code",
  description:
    "Search the codebase for a pattern. Returns matching files and lines. " +
    "Shows results as a card in the UI.",
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    glob: z.string().optional().describe("File glob filter, e.g. '*.ts'"),
  }),
  displayPropsSchema: searchDisplaySchema,
  displayStrategy: "stay",

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
      await display.pushAndForget({ pattern: input.pattern, matches });
    }

    return { status: "success" as const, data: JSON.stringify(matches) };
  },

  render({ props }) {
    return (
      <div style={{ padding: 16, borderRadius: 12, background: "#141414", border: "1px solid #262626" }}>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
          Search results for <code style={{ color: "#9ED4B8" }}>{props.pattern}</code>
          {" "}— {props.matches.length} match{props.matches.length !== 1 ? "es" : ""}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {props.matches.map((m, i) => (
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
});`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>4. The plan approval tool</h2>

      <p>
        Before making any changes, the AI should explain what it plans to do
        and wait for approval. This tool is entirely client-side — no server
        route needed. It only uses the display stack.
      </p>

      <p>
        Using <code>defineTool</code> gives us type-safe display props and
        resolve values. The <code>displayStrategy: &quot;hide-on-complete&quot;</code>{" "}
        setting means the plan card disappears once the user approves or
        rejects, and <code>renderResult</code> shows a compact summary of
        the decision in its place.
      </p>

      <CodeBlock
        filename="lib/tools/propose-plan.tsx"
        language="tsx"
        code={`import { z } from "zod";
import { defineTool } from "glove-react";

const planDisplaySchema = z.object({
  title: z.string(),
  steps: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
    }),
  ),
});

export const proposePlan = defineTool({
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
  displayPropsSchema: planDisplaySchema,
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete",

  // This tool is pure display stack — no server call needed
  async do(input, display) {
    const approved = await display.pushAndWait({
      title: input.title,
      steps: input.steps,
    });

    if (approved) {
      return {
        status: "success" as const,
        data: "Plan approved — proceed with the changes.",
        renderData: { approved: true, title: input.title },
      };
    }
    return {
      status: "success" as const,
      data: "Plan rejected — ask the user what they want to change.",
      renderData: { approved: false, title: input.title },
    };
  },

  render({ props, resolve }) {
    return (
      <div style={{ padding: 16, border: "1px solid #9ED4B8", borderRadius: 12 }}>
        <p style={{ fontWeight: 600, marginBottom: 12 }}>{props.title}</p>
        <ol style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {props.steps.map((step, i) => (
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

  renderResult({ data }) {
    const { approved, title } = data as { approved: boolean; title: string };
    return (
      <div
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          background: approved ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
          border: \`1px solid \${approved ? "#22c55e" : "#ef4444"}\`,
          fontSize: 13,
        }}
      >
        {approved ? "Plan approved" : "Plan rejected"}: {title}
      </div>
    );
  },
});`}
      />

      <p>
        The description says &ldquo;ALWAYS use this before editing files.&rdquo;
        This is how you encode safety rules — through tool descriptions. The
        AI reads the description and follows it. Combined with the system
        prompt (step 7), this creates a reliable approval gate.
      </p>

      <p>
        The <code>renderResult</code> callback provides a compact summary
        after the plan card hides. When the user scrolls through the
        conversation history, they see &ldquo;Plan approved: Refactor auth
        to JWT&rdquo; instead of a blank gap where the plan used to be.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>5. The diff preview tool</h2>

      <p>
        When the AI edits a file, it should show you what it is about to
        change. This tool combines both patterns: it calls the server to
        read the file, shows a diff using <code>pushAndWait</code>, and if
        approved, calls the server again to write the file.
      </p>

      <p>
        The <code>displayStrategy: &quot;hide-on-complete&quot;</code> means
        the diff card disappears after the user accepts or rejects — keeping
        the conversation tidy when multiple files are edited in sequence.
      </p>

      <CodeBlock
        filename="lib/tools/edit-file.tsx"
        language="tsx"
        code={`import { z } from "zod";
import { defineTool } from "glove-react";

const diffDisplaySchema = z.object({
  path: z.string(),
  oldString: z.string(),
  newString: z.string(),
});

export const editFile = defineTool({
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
  displayPropsSchema: diffDisplaySchema,
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete",

  async do(input, display) {
    // Step 1: Read the file from the server to verify the edit is valid
    const readRes = await fetch("/api/fs/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: input.path }),
    });
    const readData = await readRes.json();

    if (readData.error) {
      return { status: "error" as const, data: \`Error: \${readData.error}\` };
    }
    if (!readData.content.includes(input.oldString)) {
      return { status: "error" as const, data: "Error: old_string not found in file." };
    }

    // Step 2: Show the diff and wait for approval (client-side display stack)
    const approved = await display.pushAndWait({
      path: input.path,
      oldString: input.oldString,
      newString: input.newString,
    });

    if (!approved) {
      return { status: "success" as const, data: "Edit rejected by user." };
    }

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

    if (writeData.error) {
      return { status: "error" as const, data: \`Error: \${writeData.error}\` };
    }
    return { status: "success" as const, data: "File updated successfully." };
  },

  render({ props, resolve }) {
    return (
      <div style={{ padding: 16, borderRadius: 12, border: "1px solid #333" }}>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
          Edit: <code style={{ color: "#9ED4B8" }}>{props.path}</code>
        </p>

        {/* Removed lines */}
        <div style={{ marginBottom: 8 }}>
          {props.oldString.split("\\n").map((line, i) => (
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
          {props.newString.split("\\n").map((line, i) => (
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
});`}
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
        <code>pushAndForget</code> to show the output. The{" "}
        <code>displayStrategy: &quot;hide-on-complete&quot;</code> hides the
        permission prompt once the user responds, while the output card
        (pushed via <code>pushAndForget</code>) stays visible since it is
        never resolved.
      </p>

      <CodeBlock
        filename="lib/tools/run-command.tsx"
        language="tsx"
        code={`import { z } from "zod";
import { defineTool } from "glove-react";

const commandDisplaySchema = z.object({
  command: z.string(),
  reason: z.string().optional(),
  output: z.string().optional(),
  phase: z.enum(["permission", "output", "error"]),
});

export const runCommand = defineTool({
  name: "run_command",
  description:
    "Run a shell command. Shows the command for user approval first, " +
    "then displays the output. Use for running tests, installing " +
    "packages, git operations, or build commands.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to run"),
    reason: z.string().describe("Why this command needs to run"),
  }),
  displayPropsSchema: commandDisplaySchema,
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete",

  async do(input, display) {
    // Step 1: Ask permission in the browser (pushAndWait)
    const approved = await display.pushAndWait({
      command: input.command,
      reason: input.reason,
      phase: "permission" as const,
    });

    if (!approved) {
      return {
        status: "success" as const,
        data: "Command rejected by user.",
        renderData: { denied: true, command: input.command },
      };
    }

    // Step 2: Execute on the server
    const res = await fetch("/api/fs/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: input.command }),
    });
    const data = await res.json();

    // Step 3: Show output in the browser (pushAndForget)
    await display.pushAndForget({
      command: input.command,
      phase: data.error ? ("error" as const) : ("output" as const),
      output: data.output,
    });

    if (data.error) {
      return { status: "error" as const, data: \`Command failed: \${data.output}\` };
    }
    return {
      status: "success" as const,
      data: data.output,
      renderData: { denied: false, command: input.command },
    };
  },

  render({ props, resolve }) {
    // Permission prompt (pushAndWait — resolve is available)
    if (props.phase === "permission") {
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
            $ {props.command}
          </div>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>{props.reason}</p>
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
    const isError = props.phase === "error";
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
          $ {props.command}
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
          {props.output}
        </pre>
      </div>
    );
  },

  renderResult({ data }) {
    const { denied, command } = data as { denied: boolean; command: string };
    return (
      <div
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          background: denied ? "rgba(239, 68, 68, 0.1)" : "rgba(34, 197, 94, 0.1)",
          border: \`1px solid \${denied ? "#ef4444" : "#22c55e"}\`,
          fontSize: 13,
          fontFamily: "monospace",
        }}
      >
        {denied ? "Command denied" : "Command approved"}: $ {command}
      </div>
    );
  },
});`}
      />

      <p>
        The <code>render</code> function handles both phases by checking{" "}
        <code>props.phase</code>. For the permission prompt, it uses{" "}
        <code>resolve</code> (the user must respond). For the output card,
        there is no <code>resolve</code> call — it is fire-and-forget.
        Because of <code>displayStrategy: &quot;hide-on-complete&quot;</code>,
        the permission prompt disappears after the user clicks Run or Deny,
        while the output card (created via <code>pushAndForget</code>) stays
        visible since it is never resolved.
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

      <p>
        Instead of manually iterating over <code>timeline</code> and{" "}
        <code>slots</code>, use the <code>&lt;Render&gt;</code> component.
        It handles slot visibility, interleaving display slots with
        conversation entries, streaming text, and input — all driven by
        render props you provide.
      </p>

      <CodeBlock
        filename="app/page.tsx"
        language="tsx"
        code={`"use client";

import { useGlove, Render } from "glove-react";

export default function CodingAgent() {
  const glove = useGlove();

  return (
    <div style={{ maxWidth: 700, margin: "2rem auto" }}>
      <h1>Coding Agent</h1>

      <Render
        glove={glove}
        strategy="interleaved"
        renderMessage={({ entry }) => {
          if (entry.kind === "user") {
            return (
              <div style={{ margin: "1rem 0" }}>
                <strong>You:</strong> {entry.text}
              </div>
            );
          }
          return (
            <div style={{ margin: "1rem 0" }}>
              <strong>Agent:</strong> {entry.text}
            </div>
          );
        }}
        renderStreaming={({ text }) => (
          <div style={{ opacity: 0.7 }}>
            <strong>Agent:</strong> {text}
          </div>
        )}
        renderInput={({ send, busy }) => {
          let inputRef: HTMLInputElement | null = null;
          return (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const val = inputRef?.value?.trim();
                if (!val || busy) return;
                send(val);
                if (inputRef) inputRef.value = "";
              }}
              style={{ display: "flex", gap: "0.5rem" }}
            >
              <input
                ref={(el) => { inputRef = el; }}
                placeholder="Describe what you want to change..."
                disabled={busy}
                style={{ flex: 1, padding: "0.5rem", fontFamily: "monospace" }}
              />
              <button type="submit" disabled={busy}>Send</button>
            </form>
          );
        }}
      />
    </div>
  );
}`}
      />

      <p>
        The <code>&lt;Render&gt;</code> component with{" "}
        <code>strategy=&quot;interleaved&quot;</code> places each tool&apos;s
        display slots directly after their corresponding tool call in the
        timeline. This means a plan card appears right after the AI says
        &ldquo;Let me propose a plan&rdquo;, and a diff appears right after
        the AI says &ldquo;Editing auth.ts&rdquo;. The <code>&lt;Render&gt;</code>{" "}
        component also handles display strategies automatically — slots with{" "}
        <code>hide-on-complete</code> disappear once resolved, while{" "}
        <code>stay</code> slots remain visible throughout the conversation.
      </p>

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
          (it stays visible because of <code>displayStrategy: &quot;stay&quot;</code>)
        </li>
        <li>
          <strong>&ldquo;Rename the function getUserById to
          fetchUserById&rdquo;</strong> — the AI proposes a plan, then shows a
          diff for each file that needs changing (both cards hide after you
          respond, replaced by compact <code>renderResult</code> summaries)
        </li>
        <li>
          <strong>&ldquo;Run the tests&rdquo;</strong> — a permission prompt
          appears (hides after you respond), then the output card stays visible
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
  const approved = await display.pushAndWait({ ... });
  if (!approved) return "Rejected";

  // Execute: call the server API route (server — fetch)
  const res = await fetch("/api/...", { method: "POST", body: ... });

  // Display: show result (browser — pushAndForget)
  await display.pushAndForget({ output: res.data });

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

      <p>
        With <code>defineTool</code>, the display data flowing through each
        phase is fully typed — the <code>displayPropsSchema</code> ensures
        that what you pass to <code>pushAndWait</code> matches what{" "}
        <code>render</code> receives in <code>props</code>, and the{" "}
        <code>resolveSchema</code> ensures that what the user sends back
        from <code>resolve</code> is what <code>do</code> receives from{" "}
        <code>pushAndWait</code>.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Display patterns used</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Pattern</th>
            <th>Display Strategy</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>read_file</code></td>
            <td>No display</td>
            <td>n/a</td>
            <td>Silent server call — AI builds context</td>
          </tr>
          <tr>
            <td><code>search_code</code></td>
            <td><code>pushAndForget</code></td>
            <td><code>stay</code></td>
            <td>Show results, AI keeps working, card persists</td>
          </tr>
          <tr>
            <td><code>propose_plan</code></td>
            <td><code>pushAndWait</code></td>
            <td><code>hide-on-complete</code></td>
            <td>Must approve before any changes, card hides after</td>
          </tr>
          <tr>
            <td><code>edit_file</code></td>
            <td><code>pushAndWait</code></td>
            <td><code>hide-on-complete</code></td>
            <td>Must review diff before server writes, card hides after</td>
          </tr>
          <tr>
            <td><code>run_command</code></td>
            <td>Both</td>
            <td><code>hide-on-complete</code></td>
            <td>Permission prompt hides, output card stays (never resolved)</td>
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
          <a href="/docs/react#define-tool"><code>defineTool</code> API Reference</a>{" "}
          — type-safe tool definitions with <code>displayPropsSchema</code>,{" "}
          <code>resolveSchema</code>, and <code>renderResult</code>
        </li>
        <li>
          <a href="/docs/react#render-component"><code>&lt;Render&gt;</code> Component</a>{" "}
          — interleaving, slot visibility, and display strategies
        </li>
        <li>
          <a href="/docs/react#slot-display-strategy">Display Strategies</a>{" "}
          — deep dive into <code>stay</code>,{" "}
          <code>hide-on-complete</code>, and <code>hide-on-new</code>
        </li>
        <li>
          <a href="/docs/display-stack">The Display Stack</a> — deep dive
          into <code>pushAndWait</code> and <code>pushAndForget</code>
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
