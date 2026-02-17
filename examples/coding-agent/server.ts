import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

import { randomUUID } from "crypto";
import { mkdirSync, readdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";

// Load .env from the script's own directory (not cwd, which is the workspace root)
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env") });
import {
  type SubscriberAdapter,
  type ContentPart,
  type Message,
  AbortError,
  Displaymanager,
  Glove,
  SqliteStore,
  createAdapter,
  getAvailableProviders,
} from "glove-core";
import { baseTools, planTool, askQuestionTool } from "./tools";
import type { ServerEvent, ClientCommand, HistoryTimelineEntry } from "./protocol";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Database path
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), ".glove", "coding-agent.db");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WebSocket helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function send(ws: WebSocket, event: ServerEvent) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Convert stored messages → timeline entries for history restoration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function messagesToTimeline(messages: Message[]): HistoryTimelineEntry[] {
  const entries: HistoryTimelineEntry[] = [];
  const toolResultMap = new Map<string, { status: "success" | "error"; output?: string }>();

  // Pre-collect all tool results so we can match them to tool calls
  for (const msg of messages) {
    if (msg.sender === "user" && msg.tool_results?.length) {
      for (const tr of msg.tool_results) {
        if (tr.call_id) {
          toolResultMap.set(tr.call_id, {
            status: tr.result.status === "error" ? "error" : "success",
            output: tr.result.data != null ? String(tr.result.data) : tr.result.message,
          });
        }
      }
    }
  }

  for (const msg of messages) {
    if (msg.sender === "user") {
      // Skip tool-result-only messages (they have placeholder text like "tool results")
      if (msg.tool_results?.length) continue;

      // Build image data URLs from content parts if present
      const images = msg.content
        ?.filter((p) => p.type === "image" && p.source?.data)
        .map((p) => `data:${p.source!.media_type};base64,${p.source!.data}`);

      entries.push({
        kind: "user",
        text: msg.text,
        ...(images?.length ? { images } : {}),
      });
    } else {
      // Agent message — emit text if present
      if (msg.text?.trim() && !(msg.tool_calls?.length)) {
        entries.push({ kind: "agent_text", text: msg.text });
      }

      // Emit text before tool calls (agent may have written text + made calls in one turn)
      if (msg.text?.trim() && msg.tool_calls?.length) {
        entries.push({ kind: "agent_text", text: msg.text });
      }

      // Emit tool call entries with their results
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          const result = toolResultMap.get(tc.id ?? "");
          entries.push({
            kind: "tool",
            id: tc.id ?? "",
            name: tc.tool_name,
            input: tc.input_args,
            status: result?.status ?? "success",
            output: result?.output,
          });
        }
      }
    }
  }

  return entries;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WebSocket subscriber — forwards agent events to client
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class WebSocketSubscriber implements SubscriberAdapter {
  constructor(private ws: WebSocket) {}

  async record(event_type: string, data: any) {
    switch (event_type) {
      case "text_delta":
        send(this.ws, { type: "text_delta", data: { text: data.text } });
        break;

      case "tool_use":
        send(this.ws, {
          type: "tool_use",
          data: { id: data.id, name: data.name, input: data.input },
        });
        break;

      case "tool_use_result":
        send(this.ws, { type: "tool_use_result", data });
        // Also check for task updates
        if (
          data.tool_name === "glove_update_tasks" &&
          data.result?.status === "success"
        ) {
          send(this.ws, {
            type: "tasks_updated",
            data: { tasks: data.result.data.tasks },
          });
        }
        break;

      case "model_response":
      case "model_response_complete":
        send(this.ws, {
          type: "turn_complete",
          data: {
            tokens_in: data.tokens_in ?? 0,
            tokens_out: data.tokens_out ?? 0,
          },
        });
        break;
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// System prompt
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SessionFeatures {
  planning: boolean;
  tasking: boolean;
  autoAccept: boolean;
}

function buildSystemPrompt(workingDir: string, features: SessionFeatures) {
  const toolList = [
    `- **read_file**: Read file contents with optional line ranges`,
    `- **write_file**: Create or overwrite files (requires permission)`,
    `- **edit_file**: Surgical string replacement in files (requires permission)`,
    `- **list_dir**: Explore directory structure`,
    `- **search**: Regex search across files`,
    `- **bash**: Run any shell command (requires permission)`,
    `- **glob**: Find files matching a glob pattern`,
    `- **grep**: Enhanced regex search with output modes (content/files/count)`,
    `- **file_info**: Get file metadata (size, dates, permissions, line count)`,
    `- **git_status**: Show working tree status`,
    `- **git_diff**: Show file diffs (staged or unstaged)`,
    `- **git_log**: Show commit history`,
  ];

  if (features.tasking) {
    toolList.push(`- **glove_update_tasks**: Plan and track tasks for the current session`);
  }
  if (features.planning) {
    toolList.push(`- **plan**: Present a step-by-step plan for user approval before executing`);
  }
  toolList.push(`- **ask_question**: Ask the user one or more questions and wait for answers`);

  let prompt = `You are an expert coding assistant with access to the local file system and a bash shell.

## Tools
${toolList.join("\n")}
`;

  if (features.planning) {
    prompt += `
## Planning Mode (ENABLED)
You MUST use the **plan** tool BEFORE making any file changes. Do not skip this step.

1. When you receive a request that involves modifying, creating, or deleting files:
   - First explore the codebase to understand the current state
   - Then call **plan** with a title, summary, and ordered list of concrete steps
   - Wait for the user's response before proceeding
2. User responses:
   - **Approve**: proceed with execution
   - **Reject**: stop and ask what they'd like instead
   - **Modify**: revise your plan based on their feedback and present it again
3. Only after approval should you begin making changes.
4. Exception: trivial single-line fixes (typos, obvious bugs) can skip planning.
`;
  }

  if (features.tasking) {
    prompt += `
## Task Management
You MUST use glove_update_tasks to track your work. The user sees the task list in real time.

- **Before starting work**: Create a task list breaking the request into clear steps.
- **Before each step**: Call glove_update_tasks to mark that task as "in_progress" (set exactly one task to in_progress at a time).
- **After each step**: Call glove_update_tasks to mark the task as "completed" and the next one as "in_progress".
- **When finishing the last task**: Call glove_update_tasks to mark it "completed" BEFORE writing your final response. Do not skip this step.

The task list is visible to the user at all times. Each call to glove_update_tasks sends the FULL updated list — include every task with its current status. Keep task descriptions short and specific.
`;
  }

  const steps: string[] = [
    "1. Understand the request — ask if anything is unclear",
  ];
  if (features.planning) {
    steps.push("2. Explore the codebase to understand context");
    steps.push("3. Call **plan** to present your approach — wait for approval before proceeding");
  } else {
    steps.push("2. Explore first with list_dir, glob, grep, and read_file before changing anything");
  }
  if (features.tasking) {
    steps.push(`${steps.length + 1}. Create a task list with glove_update_tasks`);
  }
  steps.push(`${steps.length + 1}. Use edit_file for modifications — always read_file first for exact content`);
  steps.push(`${steps.length + 1}. Check git status/diff to understand current state`);
  steps.push(`${steps.length + 1}. Verify with bash (run code, tests, etc.)`);
  steps.push(`${steps.length + 1}. On failure: read error, fix, retry`);

  prompt += `
## Workflow
${steps.join("\n")}

Working directory: ${workingDir}
`;

  return prompt;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Session — one per connected client
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DESTRUCTIVE_TOOLS = new Set(["write_file", "edit_file", "bash"]);

interface SessionConfig {
  sessionId?: string;
  workingDir?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  features?: Partial<SessionFeatures>;
}

/** Default provider/model (env-configurable) */
const DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER ?? "openrouter";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? undefined;

class Session {
  private glove: ReturnType<Glove["build"]>;
  private dm: Displaymanager;
  private store: SqliteStore;
  private abortController: AbortController | null = null;
  private busy = false;
  private unsubDm: (() => void) | null = null;
  private lastSlotIds = new Set<string>();
  private hasReceivedMessage = false;
  private features: SessionFeatures;
  private modelName = "";

  constructor(private ws: WebSocket, config: SessionConfig = {}) {
    const sid = config.sessionId ?? randomUUID();
    this.store = new SqliteStore({ dbPath: DB_PATH, sessionId: sid });
    console.log(`Session started: ${sid}`);
    this.dm = new Displaymanager();

    // Features — defaults: planning & tasking on, autoAccept off
    this.features = {
      planning: config.features?.planning ?? true,
      tasking: config.features?.tasking ?? true,
      autoAccept: config.features?.autoAccept ?? false,
    };

    // Store working directory — use provided, or restore from DB, or default to cwd
    const cwd = config.workingDir || this.store.getWorkingDir() || process.cwd();
    if (config.workingDir) {
      this.store.setWorkingDir(config.workingDir);
    }

    // Create model adapter from provider registry
    const provider = config.provider ?? DEFAULT_PROVIDER;
    const model = createAdapter({
      provider,
      model: config.model ?? DEFAULT_MODEL,
      apiKey: config.apiKey,
      stream: true,
    });

    this.modelName = model.name;
    console.log(`  Model: ${this.modelName}`);
    console.log(`  Features: planning=${this.features.planning}, tasking=${this.features.tasking}`);

    const gloveBuilder = new Glove({
      store: this.store,
      model,
      displayManager: this.dm,
      systemPrompt: buildSystemPrompt(cwd, this.features),
      compaction_config: {
        max_turns: 50,
        compaction_instructions:
          "Summarize the conversation. Preserve: file paths modified, task state, errors resolved, key decisions.",
      },
    });

    // Register non-interactive tools — resolve paths relative to session cwd
    for (const tool of baseTools) {
      gloveBuilder.fold<any>({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
        requiresPermission: !this.features.autoAccept && DESTRUCTIVE_TOOLS.has(tool.name),
        do: (input) => {
          const resolved = { ...input };
          if (typeof resolved.path === "string" && !resolved.path.startsWith("/")) {
            resolved.path = resolve(cwd, resolved.path);
          }
          if (tool.name === "bash" && !resolved.working_dir) {
            resolved.working_dir = cwd;
          }
          if (tool.name.startsWith("git_") && !resolved.cwd) {
            resolved.cwd = cwd;
          }
          return tool.run(resolved);
        },
      });
    }

    // Register planning tool (if enabled)
    if (this.features.planning) {
      gloveBuilder.fold<{ title: string; steps: string[]; summary?: string }>({
        name: planTool.name,
        description: planTool.description,
        inputSchema: planTool.input_schema,
        async do(input, dm) {
          const result = await dm.pushAndWait({
            renderer: "plan_approval",
            input: { title: input.title, steps: input.steps, summary: input.summary },
          });
          return JSON.stringify(result);
        },
      });
    }

    // Ask question tool is always available
    gloveBuilder.fold<{ questions: Array<{ question: string; options?: string[] }> }>({
      name: askQuestionTool.name,
      description: askQuestionTool.description,
      inputSchema: askQuestionTool.input_schema,
      async do(input, dm) {
        const result = await dm.pushAndWait({
          renderer: "ask_question",
          input: { questions: input.questions },
        });
        return JSON.stringify(result);
      },
    });

    // Add WebSocket subscriber
    gloveBuilder.addSubscriber(new WebSocketSubscriber(ws));

    this.glove = gloveBuilder.build();

    // Check if session already has messages (resumed session)
    this.store.getMessages().then((msgs) => {
      if (msgs.length > 0) this.hasReceivedMessage = true;
    });

    // Subscribe to display manager for slot changes (permissions)
    this.unsubDm = this.dm.subscribe(async (stack) => {
      const currentIds = new Set(stack.map((s) => s.id));

      // Detect new slots
      for (const slot of stack) {
        if (!this.lastSlotIds.has(slot.id)) {
          send(ws, {
            type: "slot_push",
            data: { id: slot.id, renderer: slot.renderer, input: slot.input },
          });
        }
      }

      // Detect removed slots
      for (const id of this.lastSlotIds) {
        if (!currentIds.has(id)) {
          send(ws, { type: "slot_remove", data: { id } });
        }
      }

      this.lastSlotIds = currentIds;
    });

    // Send initial state
    this.sendState();
  }

  get sessionId() {
    return this.store.identifier;
  }

  private async sendState() {
    const tasks = await this.store.getTasks();
    const tokens = await this.store.getTokenCount();
    const turns = await this.store.getTurnCount();
    const name = this.store.getName();
    const working_dir = this.store.getWorkingDir();
    send(this.ws, {
      type: "state",
      data: {
        session_id: this.store.identifier,
        name,
        working_dir,
        tasks,
        stats: { turns, tokens_in: tokens, tokens_out: 0 },
        model: this.modelName,
        features: this.features,
      },
    });

    // Send conversation history so the client can restore the timeline
    const messages = await this.store.getMessages();
    if (messages.length > 0) {
      const entries = messagesToTimeline(messages);
      if (entries.length > 0) {
        send(this.ws, { type: "history", data: { entries } });
      }
    }
  }

  async handleCommand(cmd: ClientCommand) {
    switch (cmd.type) {
      case "user_request":
        await this.handleRequest(cmd.data.text, cmd.data.content);
        break;
      case "slot_resolve":
        this.dm.resolve(cmd.data.slot_id, cmd.data.value);
        break;
      case "slot_reject":
        this.dm.reject(cmd.data.slot_id, "User denied");
        break;
      case "abort":
        this.abortController?.abort();
        break;
      case "change_model":
        this.handleChangeModel(cmd.data.provider, cmd.data.model);
        break;
    }
  }

  private handleChangeModel(provider: string, model?: string) {
    if (this.busy) {
      send(this.ws, {
        type: "error",
        data: { message: "Cannot change model while a request is in progress" },
      });
      return;
    }
    try {
      const newAdapter = createAdapter({
        provider,
        model,
        stream: true,
      });
      this.glove.setModel(newAdapter);
      this.modelName = newAdapter.name;
      console.log(`  Model changed to: ${this.modelName}`);
      send(this.ws, { type: "model_changed", data: { model: this.modelName } });
    } catch (err: any) {
      send(this.ws, {
        type: "error",
        data: { message: `Failed to change model: ${err.message}` },
      });
    }
  }

  private async handleRequest(text: string, content?: ContentPart[]) {
    if (this.busy) return;
    this.busy = true;
    this.abortController = new AbortController();

    // Name the session after the first user message
    if (!this.hasReceivedMessage) {
      this.hasReceivedMessage = true;
      const preview = text.length > 60 ? text.slice(0, 57) + "..." : text;
      this.store.setName(preview);
    }

    try {
      const request = content?.length ? content : text;
      await this.glove.processRequest(request, this.abortController.signal);
      // Send final task state — covers auto-completed tasks that didn't go through the tool
      const tasks = await this.store.getTasks();
      if (tasks.length > 0) {
        send(this.ws, { type: "tasks_updated", data: { tasks } });
      }
      send(this.ws, { type: "request_complete", data: {} });
    } catch (err: any) {
      if (err instanceof AbortError || err.name === "AbortError") {
        send(this.ws, { type: "request_complete", data: {} });
      } else {
        send(this.ws, { type: "error", data: { message: err.message } });
      }
    }

    this.abortController = null;
    this.busy = false;
  }

  destroy() {
    this.abortController?.abort();
    this.unsubDm?.();
    this.store.close();
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Start server
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Ensure DB directory exists
mkdirSync(join(process.cwd(), ".glove"), { recursive: true });

// ── HTTP server (REST endpoints + WebSocket upgrade) ──────────────────────

const server = createServer((req, res) => {
  // CORS headers for the Vite dev server
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/providers") {
    const providerList = getAvailableProviders();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(providerList));
    return;
  }

  if (req.method === "GET" && url.pathname === "/sessions") {
    const sessions = SqliteStore.listSessions(DB_PATH);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(sessions));
    return;
  }

  if (req.method === "GET" && url.pathname === "/browse") {
    const rawPath = url.searchParams.get("path") || homedir();
    const dir = resolve(rawPath);
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => ({ name: e.name, path: join(dir, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const parent = dirname(dir);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ current: dir, parent: parent !== dir ? parent : null, entries: dirs }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ current: dir, parent: dirname(dir), entries: [], error: "Cannot read directory" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// ── WebSocket server ──────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get("session") ?? undefined;
  const cwd = url.searchParams.get("cwd") ?? undefined;
  const provider = url.searchParams.get("provider") ?? undefined;
  const model = url.searchParams.get("model") ?? undefined;
  const planning = url.searchParams.get("planning");
  const tasking = url.searchParams.get("tasking");
  const autoAccept = url.searchParams.get("autoAccept");

  console.log(`Client connected${sessionId ? ` (resuming session ${sessionId})` : ""}${cwd ? ` (cwd: ${cwd})` : ""}`);
  const session = new Session(ws, {
    sessionId,
    workingDir: cwd,
    provider,
    model,
    features: {
      planning: planning !== null ? planning !== "false" : undefined,
      tasking: tasking !== null ? tasking !== "false" : undefined,
      autoAccept: autoAccept !== null ? autoAccept === "true" : undefined,
    },
  });

  ws.on("message", async (raw) => {
    try {
      const cmd: ClientCommand = JSON.parse(raw.toString());
      await session.handleCommand(cmd);
    } catch (err: any) {
      send(ws, { type: "error", data: { message: err.message ?? "Unknown error" } });
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    session.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`Coding agent server listening on http://localhost:${PORT}`);
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log(`  Sessions:  http://localhost:${PORT}/sessions`);
  console.log(`  Database:  ${DB_PATH}`);
  console.log(`  Working directory: ${process.cwd()}`);
});
