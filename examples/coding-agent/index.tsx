import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env") });

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FC,
} from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";

import {
  type StoreAdapter,
  type SubscriberAdapter,
  type Message,
  type Task,
  type TaskStatus,
  type PermissionStatus,
  AbortError,
  Displaymanager,
  type Slot,
  Glove,
  OpenRouterAdapter,
} from "@glove/core";
import { codingTools } from "./tools";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Timeline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type TimelineEntry =
  | { kind: "user"; text: string }
  | { kind: "agent_text"; text: string; elapsed?: number }
  | {
      kind: "tool";
      id: string;
      name: string;
      toolInput: any;
      status: "running" | "success" | "error";
      output?: string;
      elapsed?: number;
    };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// In-memory store (with tasks + permissions)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class MemoryStore implements StoreAdapter {
  identifier: string;
  private messages: Array<Message> = [];
  private tokenCount = 0;
  private turnCount = 0;
  private tasks: Array<Task> = [];
  private permissions = new Map<string, PermissionStatus>();

  constructor(id: string) {
    this.identifier = id;
  }

  async getMessages() {
    return this.messages;
  }

  async appendMessages(msgs: Array<Message>) {
    this.messages.push(...msgs);
  }

  async getTokenCount() {
    return this.tokenCount;
  }

  async addTokens(count: number) {
    this.tokenCount += count;
  }

  async getTurnCount() {
    return this.turnCount;
  }

  async incrementTurn() {
    this.turnCount++;
  }

  async resetHistory() {
    this.messages = [];
    this.tokenCount = 0;
  }

  // Tasks
  async getTasks() {
    return this.tasks;
  }

  async addTasks(tasks: Array<Task>) {
    this.tasks = tasks;
  }

  async updateTask(
    taskId: string,
    updates: Partial<Pick<Task, "status" | "content" | "activeForm">>,
  ) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (task) Object.assign(task, updates);
  }

  // Permissions
  async getPermission(toolName: string): Promise<PermissionStatus> {
    return this.permissions.get(toolName) ?? "unset";
  }

  async setPermission(toolName: string, status: PermissionStatus) {
    this.permissions.set(toolName, status);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Agent bridge: subscriber -> React state + timeline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class AgentBridge {
  thinking = false;
  streamText = "";
  turns = 0;
  tokensIn = 0;
  tokensOut = 0;
  timeline: TimelineEntry[] = [];
  tasks: Task[] = [];
  private _toolId = 0;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  setThinking(v: boolean) {
    this.thinking = v;
    this.emit();
  }

  appendStream(text: string) {
    this.streamText += text;
    this.emit();
  }

  resetStream() {
    this.streamText = "";
  }

  addTurn(tIn: number, tOut: number) {
    this.turns++;
    this.tokensIn += tIn;
    this.tokensOut += tOut;
    this.emit();
  }

  // ── Timeline methods ─────────────────────────────────────────────────────

  pushUser(text: string) {
    this.timeline.push({ kind: "user", text });
    this.emit();
  }

  /** Commit any accumulated streaming text to the timeline as a permanent entry. */
  flushStreamToTimeline(elapsed?: number) {
    if (this.streamText.trim()) {
      this.timeline.push({
        kind: "agent_text",
        text: this.streamText.trim(),
        elapsed,
      });
    }
    this.streamText = "";
    this.emit();
  }

  /** Push a "tool running" entry. Auto-flushes any pending streaming text first. */
  pushToolRunning(name: string, toolInput: any): string {
    this.flushStreamToTimeline();
    const id = `tool_${++this._toolId}`;
    this.timeline.push({
      kind: "tool",
      id,
      name,
      toolInput,
      status: "running",
    });
    this.emit();
    return id;
  }

  /** Update a tool entry from "running" to "success" or "error". */
  updateTool(
    id: string,
    status: "success" | "error",
    output: string,
    elapsed: number,
  ) {
    const entry = this.timeline.find(
      (e) => e.kind === "tool" && e.id === id,
    );
    if (entry && entry.kind === "tool") {
      entry.status = status;
      entry.output = output;
      entry.elapsed = elapsed;
      this.emit();
    }
  }

  /** Replace the current task list. */
  setTasks(tasks: Task[]) {
    this.tasks = tasks;
    this.emit();
  }
}

class BridgeSubscriber implements SubscriberAdapter {
  constructor(private bridge: AgentBridge) {}

  async record(event_type: string, data: any) {
    switch (event_type) {
      case "text_delta":
        this.bridge.appendStream(data.text);
        break;
      case "model_response":
        this.bridge.addTurn(data.tokens_in ?? 0, data.tokens_out ?? 0);
        break;
      case "model_response_complete":
        this.bridge.setThinking(false);
        break;
      case "tool_use_result":
        if (
          data.tool_name === "glove_update_tasks" &&
          data.result?.status === "success"
        ) {
          this.bridge.setTasks(data.result.data.tasks);
        }
        break;
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Hooks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function useAgentBridge(bridge: AgentBridge) {
  const [, tick] = useState(0);

  useEffect(() => {
    return bridge.subscribe(() => tick((n) => n + 1));
  }, [bridge]);

  return bridge;
}

function useDisplayManager(dm: Displaymanager) {
  const [stack, setStack] = useState<Array<Slot<unknown>>>([]);

  useEffect(() => {
    return dm.subscribe(async (newStack) => {
      setStack([...newStack]);
    });
  }, [dm]);

  return stack;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Formatting helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TOOL_ICONS: Record<string, string> = {
  read_file: "\u{1F4D6}",
  write_file: "\u{270F}\u{FE0F}",
  edit_file: "\u{1F527}",
  list_dir: "\u{1F4C2}",
  search: "\u{1F50D}",
  bash: "\u{1F4BB}",
  glove_update_tasks: "\u{1F4CB}",
};

function toolIcon(name: string) {
  return TOOL_ICONS[name] ?? "\u{2699}\u{FE0F}";
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncateStr(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max) + `... (${s.length} chars)`;
}

function truncateLines(s: string, max: number) {
  const lines = s.split("\n");
  if (lines.length <= max) return s;
  return lines.slice(0, max).join("\n") + `\n... ${lines.length - max} more lines`;
}

function formatToolInput(name: string, input: any): string {
  switch (name) {
    case "read_file":
      return input.start_line
        ? `${input.path} L${input.start_line}-${input.end_line ?? "end"}`
        : input.path;
    case "write_file":
      return `${input.path} (${(input.content?.split("\n") ?? []).length} lines)`;
    case "edit_file":
      return `${input.path}`;
    case "list_dir":
      return input.path;
    case "search":
      return `/${input.pattern}/ in ${input.path}`;
    case "bash":
      return truncateStr(input.command, 60);
    case "glove_update_tasks":
      return `${input.todos?.length ?? 0} task(s)`;
    default:
      return truncateStr(JSON.stringify(input), 80);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Components
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const Header: FC = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Box>
      <Text bold color="cyan">
        {"\u{26A1}"} Coding Agent
      </Text>
    </Box>
    <Text dimColor>{"\u{1F4C1}"} {process.cwd()}</Text>
    <Text dimColor>
      {"\u{2500}".repeat(Math.min(process.stdout.columns || 80, 80))}
    </Text>
  </Box>
);

const UserMessage: FC<{ text: string }> = ({ text }) => (
  <Box marginBottom={0} marginTop={1}>
    <Text bold color="green">
      {"\u{276F} "}
    </Text>
    <Text>{text}</Text>
  </Box>
);

const AgentMessage: FC<{ text: string; elapsed?: number }> = ({
  text,
  elapsed,
}) => (
  <Box flexDirection="column" marginTop={0} marginBottom={0} marginLeft={2}>
    <Text>{text}</Text>
    {elapsed != null && (
      <Text dimColor>{"\u{23F1}"} {formatMs(elapsed)}</Text>
    )}
  </Box>
);

const ThinkingIndicator: FC = () => (
  <Box marginLeft={2} marginTop={0}>
    <Text color="cyan">
      <Spinner type="dots" />
    </Text>
    <Text dimColor> Thinking...</Text>
  </Box>
);

const StreamingText: FC<{ text: string }> = ({ text }) => (
  <Box marginLeft={2}>
    <Text>{text}</Text>
    <Text dimColor>{"\u{258C}"}</Text>
  </Box>
);

const ErrorDisplay: FC<{ message: string }> = ({ message }) => (
  <Box marginLeft={2} marginBottom={1}>
    <Text color="red" bold>
      {"\u{2717}"} Error:{" "}
    </Text>
    <Text color="red">{message}</Text>
  </Box>
);

const StatusBar: FC<{ bridge: AgentBridge }> = ({ bridge }) => {
  const state = useAgentBridge(bridge);
  if (state.turns === 0) return null;
  const width = Math.min(process.stdout.columns || 80, 80);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{"\u{2500}".repeat(width)}</Text>
      <Text dimColor>
        {"  "}
        {state.turns} turns {"\u{00B7}"} {state.tokensIn.toLocaleString()} in {"\u{00B7}"}{" "}
        {state.tokensOut.toLocaleString()} out
      </Text>
    </Box>
  );
};

const InputPrompt: FC<{
  onSubmit: (text: string) => void;
  active: boolean;
}> = ({ onSubmit, active }) => {
  const [value, setValue] = useState("");

  const handleSubmit = (text: string) => {
    if (!text.trim()) return;
    setValue("");
    onSubmit(text.trim());
  };

  if (!active) return null;

  return (
    <Box marginTop={1}>
      <Text bold color="green">
        {"\u{276F} "}
      </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder="Type your request..."
      />
    </Box>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Timeline renderers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function ToolRunningView({
  entry,
}: {
  entry: TimelineEntry & { kind: "tool" };
}) {
  const icon = toolIcon(entry.name);
  const inputStr = formatToolInput(entry.name, entry.toolInput);

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text>
          {icon}{" "}
        </Text>
        <Text bold>{entry.name}</Text>
        <Text dimColor> {inputStr}</Text>
        <Text color="cyan">
          {" "}
          <Spinner type="dots" />
        </Text>
      </Box>
    </Box>
  );
}

function ToolResultView({
  entry,
}: {
  entry: TimelineEntry & { kind: "tool" };
}) {
  const icon = toolIcon(entry.name);
  const inputStr = formatToolInput(entry.name, entry.toolInput);
  const isError = entry.status === "error";

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text>
          {icon}{" "}
        </Text>
        <Text bold>{entry.name}</Text>
        <Text dimColor> {inputStr}</Text>
        {isError ? (
          <Text color="red"> {"\u{2717}"}</Text>
        ) : (
          <Text color="green"> {"\u{2713}"}</Text>
        )}
        {entry.elapsed != null && (
          <Text dimColor> {formatMs(entry.elapsed)}</Text>
        )}
      </Box>
      {entry.output && (
        <Box
          marginLeft={2}
          borderStyle="single"
          borderColor={isError ? "red" : "gray"}
          paddingX={1}
        >
          <Text dimColor={!isError} color={isError ? "red" : undefined}>
            {truncateLines(entry.output, 10)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function TimelineEntryView({ entry }: { entry: TimelineEntry }) {
  switch (entry.kind) {
    case "user":
      return <UserMessage text={entry.text} />;
    case "agent_text":
      return <AgentMessage text={entry.text} elapsed={entry.elapsed} />;
    case "tool":
      return entry.status === "running" ? (
        <ToolRunningView entry={entry} />
      ) : (
        <ToolResultView entry={entry} />
      );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Display slot renderers (task list + permissions only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TASK_STATUS_ICONS: Record<TaskStatus, string> = {
  pending: "\u{25CB}",
  in_progress: "\u{25C9}",
  completed: "\u{2713}",
};

const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  pending: "gray",
  in_progress: "cyan",
  completed: "green",
};

function TaskListView({ tasks }: { tasks: Task[] }) {
  return (
    <Box flexDirection="column" marginLeft={2} marginY={1}>
      <Text bold dimColor>
        Tasks
      </Text>
      {tasks.map((task) => (
        <Box key={task.id} marginLeft={1}>
          <Text color={TASK_STATUS_COLORS[task.status]}>
            {TASK_STATUS_ICONS[task.status]}{" "}
          </Text>
          <Text
            dimColor={task.status === "completed"}
            strikethrough={task.status === "completed"}
          >
            {task.status === "in_progress" ? task.activeForm : task.content}
          </Text>
          {task.status === "in_progress" && (
            <Text color="cyan">
              {" "}
              <Spinner type="dots" />
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
}

function PermissionPromptSlot({
  slot,
  dm,
}: {
  slot: Slot<any>;
  dm: Displaymanager;
}) {
  const { toolName, toolInput } = slot.input;
  const icon = toolIcon(toolName);
  const inputStr = formatToolInput(toolName, toolInput);

  useInput((input, key) => {
    if (input === "y" || input === "Y") {
      dm.resolve(slot.id, true);
    } else if (input === "n" || input === "N" || (key.ctrl && input === "c")) {
      dm.resolve(slot.id, false);
    }
  });

  return (
    <Box flexDirection="column" marginLeft={2} marginY={1}>
      <Box>
        <Text color="yellow">{"\u{1F512}"} Permission required</Text>
      </Box>
      <Box marginLeft={2}>
        <Text>
          {icon}{" "}
        </Text>
        <Text bold>{toolName}</Text>
        <Text dimColor> {inputStr}</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color="yellow">Allow this tool to run? </Text>
        <Text bold>[y/n]</Text>
      </Box>
    </Box>
  );
}

function SlotView({ slot, dm }: { slot: Slot<any>; dm: Displaymanager }) {
  switch (slot.renderer) {
    case "permission_request":
      return <PermissionPromptSlot slot={slot} dm={dm} />;
    default:
      return (
        <Box marginLeft={2}>
          <Text dimColor>[{slot.renderer}] {JSON.stringify(slot.input)}</Text>
        </Box>
      );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// App
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const App: FC<{
  dm: Displaymanager;
  bridge: AgentBridge;
  processRequest: (msg: string, signal?: AbortSignal) => Promise<any>;
}> = ({ dm, bridge, processRequest }) => {
  const { exit } = useApp();
  const stack = useDisplayManager(dm);
  const state = useAgentBridge(bridge);

  const [mode, setMode] = useState<"idle" | "thinking">("idle");
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (mode === "thinking" && abortRef.current) {
        abortRef.current.abort();
      } else {
        exit();
        process.exit(0);
      }
      return;
    }
    if (input === "q" && mode === "idle") {
      exit();
      process.exit(0);
    }
  });

  const handleSubmit = useCallback(
    async (text: string) => {
      if (text === "exit" || text === "quit") {
        exit();
        process.exit(0);
      }

      if (runningRef.current) return;
      runningRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      bridge.pushUser(text);
      setMode("thinking");
      setError(null);
      bridge.resetStream();
      bridge.setThinking(true);

      const startTime = Date.now();

      try {
        await processRequest(text, controller.signal);
        bridge.flushStreamToTimeline(Date.now() - startTime);
      } catch (err: any) {
        if (err instanceof AbortError || err.name === "AbortError") {
          bridge.flushStreamToTimeline();
          bridge.timeline.push({ kind: "agent_text", text: "(aborted)" });
        } else {
          setError(err.message);
        }
      }

      abortRef.current = null;
      bridge.setThinking(false);
      bridge.resetStream();
      setMode("idle");
      runningRef.current = false;
    },
    [bridge, dm, processRequest, exit],
  );

  return (
    <Box flexDirection="column">
      <Header />

      {/* Timeline: user messages, agent text, and tool activity interleaved */}
      {state.timeline.map((entry, i) => (
        <TimelineEntryView key={i} entry={entry} />
      ))}

      {/* Task list (persists across requests, updates in place) */}
      {state.tasks.length > 0 && <TaskListView tasks={state.tasks} />}

      {/* Display manager slots (permission prompts) */}
      {stack.map((slot) => (
        <SlotView key={slot.id} slot={slot} dm={dm} />
      ))}

      {/* Streaming text (not yet committed to timeline) */}
      {state.streamText && mode === "thinking" && (
        <StreamingText text={state.streamText} />
      )}

      {/* Thinking indicator */}
      {state.thinking && !state.streamText && mode === "thinking" && (
        <ThinkingIndicator />
      )}

      {/* Error */}
      {error && <ErrorDisplay message={error} />}

      {/* Input + status */}
      <InputPrompt onSubmit={handleSubmit} active={mode === "idle"} />

      <StatusBar bridge={bridge} />
    </Box>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Build agent
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DESTRUCTIVE_TOOLS = new Set(["write_file", "edit_file", "bash"]);

const SYSTEM_PROMPT = `You are an expert coding assistant with access to the local file system and a bash shell.

## Tools
- **read_file**: Read file contents with optional line ranges
- **write_file**: Create or overwrite files (requires permission)
- **edit_file**: Surgical string replacement in files (requires permission)
- **list_dir**: Explore directory structure
- **search**: Regex search across files
- **bash**: Run any shell command (requires permission)
- **glove_update_tasks**: Plan and track tasks for the current session

## Task Management
You MUST use glove_update_tasks to track your work. The user sees the task list in real time.

- **Before starting work**: Create a task list breaking the request into clear steps.
- **Before each step**: Call glove_update_tasks to mark that task as "in_progress" (set exactly one task to in_progress at a time).
- **After each step**: Call glove_update_tasks to mark the task as "completed" and the next one as "in_progress".
- **When done**: All tasks should be "completed".

The task list is visible to the user at all times. Each call to glove_update_tasks sends the FULL updated list — include every task with its current status. Keep task descriptions short and specific.

Example flow:
1. Call glove_update_tasks with 3 tasks, first one "in_progress", rest "pending"
2. Do the first task
3. Call glove_update_tasks — first "completed", second "in_progress", third "pending"
4. Do the second task
5. Call glove_update_tasks — first two "completed", third "in_progress"
6. Do the third task
7. Call glove_update_tasks — all three "completed"

## Workflow
1. Understand the request — ask if anything is unclear
2. Plan with glove_update_tasks
3. Explore first with list_dir and read_file before changing anything
4. Use edit_file for modifications — always read_file first for exact content
5. Verify with bash (run code, tests, etc.)
6. On failure: read error, fix, retry

Working directory: ${process.cwd()}
All generated code should live under the lab folder.
`;

function buildAgent(
  dm: Displaymanager,
  subscriber: SubscriberAdapter,
  bridge: AgentBridge,
) {
  const glove = new Glove({
    store: new MemoryStore("coding-session"),
    model: new OpenRouterAdapter({
      model: "minimax/minimax-m2.5",
      maxTokens: 8192,
      stream: true,
      apiKey: process.env.OPENROUTER_API_KEY,
    }),
    displayManager: dm,
    systemPrompt: SYSTEM_PROMPT,
    compaction_config: {
      max_turns: 50,
      compaction_instructions:
        "Summarize the conversation. Preserve: file paths modified, task state, errors resolved, key decisions.",
    },
  });

  for (const tool of codingTools) {
    glove.fold<any>({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input_schema,
      requiresPermission: DESTRUCTIVE_TOOLS.has(tool.name),
      async do(input) {
        const start = Date.now();
        const entryId = bridge.pushToolRunning(tool.name, input);

        try {
          const result = await tool.run(input);
          bridge.updateTool(
            entryId,
            "success",
            String(result),
            Date.now() - start,
          );
          return result;
        } catch (err: any) {
          bridge.updateTool(
            entryId,
            "error",
            err.message,
            Date.now() - start,
          );
          throw err;
        }
      },
    });
  }

  glove.addSubscriber(subscriber);
  return glove.build();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function main() {
  const dm = new Displaymanager();
  const bridge = new AgentBridge();
  const subscriber = new BridgeSubscriber(bridge);
  const agent = buildAgent(dm, subscriber, bridge);

  const processRequest = async (msg: string, signal?: AbortSignal) => {
    return agent.processRequest(msg, signal);
  };

  render(<App dm={dm} bridge={bridge} processRequest={processRequest} />);
}

main();
