import "dotenv/config"
import React, {
  useState,
  useEffect,
  useReducer,
  useRef,
  type FC,
} from "react";
import { render, Box, Text, Newline, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { EventEmitter } from "events";

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
import { codingTools } from "./coding-tools";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Event bridge: subscriber → React
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const bus = new EventEmitter();
bus.setMaxListeners(50);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ToolEntry {
  name: string;
  input: any;
  status: "running" | "success" | "error";
  output?: string;
  elapsed?: number;
}

interface TurnEntry {
  type: "user" | "agent" | "tools";
  text?: string;
  tools?: ToolEntry[];
  elapsed?: number;
}

interface AppState {
  phase: "idle" | "processing";
  history: TurnEntry[];
  streamedText: string;
  activeTools: ToolEntry[];
  thinking: boolean;
  stats: { turns: number; tokensIn: number; tokensOut: number };
  error: string | null;
}

type Action =
  | { type: "USER_SUBMIT"; text: string }
  | { type: "THINKING_START" }
  | { type: "THINKING_STOP" }
  | { type: "TEXT_DELTA"; text: string }
  | { type: "TOOL_START"; name: string; input: any }
  | { type: "TOOL_END"; name: string; status: "success" | "error"; output: string; elapsed: number }
  | { type: "TURN_STATS"; tokensIn: number; tokensOut: number }
  | { type: "AGENT_DONE"; text: string; elapsed: number }
  | { type: "ERROR"; message: string };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Reducer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "USER_SUBMIT":
      return {
        ...state,
        phase: "processing",
        thinking: true,
        streamedText: "",
        activeTools: [],
        error: null,
        history: [
          ...state.history,
          { type: "user", text: action.text },
        ],
      };

    case "THINKING_START":
      return { ...state, thinking: true };

    case "THINKING_STOP":
      return { ...state, thinking: false };

    case "TEXT_DELTA":
      return {
        ...state,
        thinking: false,
        streamedText: state.streamedText + action.text,
      };

    case "TOOL_START": {
      const entry: ToolEntry = { name: action.name, input: action.input, status: "running" };
      return {
        ...state,
        thinking: false,
        activeTools: [...state.activeTools, entry],
      };
    }

    case "TOOL_END": {
      const tools = [...state.activeTools];
      // Find the last tool with this name that's still running
      for (let i = tools.length - 1; i >= 0; i--) {
        if (tools[i].name === action.name && tools[i].status === "running") {
          tools[i] = {
            ...tools[i],
            status: action.status,
            output: action.output,
            elapsed: action.elapsed,
          };
          break;
        }
      }
      return { ...state, activeTools: tools, thinking: true };
    }

    case "TURN_STATS":
      return {
        ...state,
        stats: {
          turns: state.stats.turns + 1,
          tokensIn: state.stats.tokensIn + action.tokensIn,
          tokensOut: state.stats.tokensOut + action.tokensOut,
        },
      };

    case "AGENT_DONE": {
      // Flush active tools + streamed text into history
      const newHistory = [...state.history];

      if (state.activeTools.length > 0) {
        newHistory.push({ type: "tools", tools: [...state.activeTools] });
      }

      const finalText = state.streamedText || action.text;
      if (finalText) {
        newHistory.push({ type: "agent", text: finalText, elapsed: action.elapsed });
      }

      return {
        ...state,
        phase: "idle",
        thinking: false,
        streamedText: "",
        activeTools: [],
        history: newHistory,
      };
    }

    case "ERROR":
      return {
        ...state,
        phase: "idle",
        thinking: false,
        error: action.message,
        history: state.history,
      };

    default:
      return state;
  }
}

const initialState: AppState = {
  phase: "idle",
  history: [],
  streamedText: "",
  activeTools: [],
  thinking: false,
  stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
  error: null,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Formatting helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TOOL_ICONS: Record<string, string> = {
  read_file: "📖",
  write_file: "✏️",
  edit_file: "🔧",
  list_dir: "📂",
  search: "🔍",
  bash: "💻",
};

function toolIcon(name: string) {
  return TOOL_ICONS[name] ?? "⚙️";
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncateStr(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max) + `… (${s.length} chars)`;
}

function truncateLines(s: string, max: number) {
  const lines = s.split("\n");
  if (lines.length <= max) return s;
  return lines.slice(0, max).join("\n") + `\n… ${lines.length - max} more lines`;
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
        ⚡ Ozone Coding Agent
      </Text>
    </Box>
    <Text dimColor>📁 {process.cwd()}</Text>
    <Text dimColor>
      {"─".repeat(Math.min(process.stdout.columns || 80, 80))}
    </Text>
  </Box>
);

const UserMessage: FC<{ text: string }> = ({ text }) => (
  <Box marginBottom={0} marginTop={1}>
    <Text bold color="green">
      ❯{" "}
    </Text>
    <Text>{text}</Text>
  </Box>
);

const ToolLine: FC<{ tool: ToolEntry }> = ({ tool }) => {
  const icon = toolIcon(tool.name);
  const inputStr = formatToolInput(tool.name, tool.input);

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text>
          {icon}{" "}
        </Text>
        <Text bold>{tool.name}</Text>
        <Text dimColor> {inputStr}</Text>
        {tool.status === "running" && (
          <Text color="cyan">
            {" "}
            <Spinner type="dots" />
          </Text>
        )}
        {tool.status === "success" && (
          <Text color="green"> ✓</Text>
        )}
        {tool.status === "success" && tool.elapsed != null && (
          <Text dimColor> {formatMs(tool.elapsed)}</Text>
        )}
        {tool.status === "error" && (
          <Text color="red"> ✗</Text>
        )}
        {tool.status === "error" && tool.elapsed != null && (
          <Text dimColor> {formatMs(tool.elapsed)}</Text>
        )}
      </Box>
      {tool.output && tool.status !== "running" && (
        <Box
          marginLeft={2}
          borderStyle="single"
          borderColor={tool.status === "error" ? "red" : "gray"}
          paddingX={1}
        >
          <Text dimColor={tool.status === "success"} color={tool.status === "error" ? "red" : undefined}>
            {truncateLines(tool.output, 10)}
          </Text>
        </Box>
      )}
    </Box>
  );
};

const ToolGroup: FC<{ tools: ToolEntry[] }> = ({ tools }) => (
  <Box flexDirection="column">
    {tools.map((t, i) => (
      <ToolLine key={i} tool={t} />
    ))}
  </Box>
);

const AgentMessage: FC<{ text: string; elapsed?: number }> = ({
  text,
  elapsed,
}) => (
  <Box flexDirection="column" marginTop={0} marginBottom={0} marginLeft={2}>
    <Text>{text}</Text>
    {elapsed != null && (
      <Text dimColor>⏱ {formatMs(elapsed)}</Text>
    )}
  </Box>
);

const ThinkingIndicator: FC = () => (
  <Box marginLeft={2} marginTop={0}>
    <Text color="cyan">
      <Spinner type="dots" />
    </Text>
    <Text dimColor> Thinking…</Text>
  </Box>
);

const StreamingText: FC<{ text: string }> = ({ text }) => (
  <Box marginLeft={2}>
    <Text>{text}</Text>
    <Text dimColor>▌</Text>
  </Box>
);

const ErrorDisplay: FC<{ message: string }> = ({ message }) => (
  <Box marginLeft={2} marginBottom={1}>
    <Text color="red" bold>
      ✗ Error:{" "}
    </Text>
    <Text color="red">{message}</Text>
  </Box>
);

const StatusBar: FC<{ stats: AppState["stats"] }> = ({ stats }) => {
  const width = Math.min(process.stdout.columns || 80, 80);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{"─".repeat(width)}</Text>
      <Text dimColor>
        {"  "}
        {stats.turns} turns · {stats.tokensIn.toLocaleString()} in ·{" "}
        {stats.tokensOut.toLocaleString()} out
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
        ❯{" "}
      </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder="Type your request…"
      />
    </Box>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// App
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const App: FC<{ agent: Agent }> = ({ agent }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { exit } = useApp();
  const runningRef = useRef(false);

  // Subscribe to event bus
  useEffect(() => {
    const handlers: Record<string, (...args: any[]) => void> = {
      thinking_start: () => dispatch({ type: "THINKING_START" }),
      thinking_stop: () => dispatch({ type: "THINKING_STOP" }),
      text_delta: (text: string) => dispatch({ type: "TEXT_DELTA", text }),
      tool_start: (name: string, input: any) =>
        dispatch({ type: "TOOL_START", name, input }),
      tool_end: (name: string, status: "success" | "error", output: string, elapsed: number) =>
        dispatch({ type: "TOOL_END", name, status, output, elapsed }),
      turn_stats: (tokensIn: number, tokensOut: number) =>
        dispatch({ type: "TURN_STATS", tokensIn, tokensOut }),
      agent_done: (text: string, elapsed: number) =>
        dispatch({ type: "AGENT_DONE", text, elapsed }),
      agent_error: (message: string) => dispatch({ type: "ERROR", message }),
    };

    for (const [event, handler] of Object.entries(handlers)) {
      bus.on(event, handler);
    }

    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        bus.off(event, handler);
      }
    };
  }, []);

  // Ctrl+C to quit
  useInput((input, key) => {
    if (input === "q" && state.phase === "idle") {
      exit();
      process.exit(0);
    }
    if (key.ctrl && input === "c") {
      exit();
      process.exit(0);
    }
  });

  const handleSubmit = async (text: string) => {
    if (text === "exit" || text === "quit") {
      exit();
      process.exit(0);
    }

    if (runningRef.current) return;
    runningRef.current = true;

    dispatch({ type: "USER_SUBMIT", text });

    const startTime = Date.now();

    try {
      const result: any = await agent.ask({ sender: "user", text });
      const elapsed = Date.now() - startTime;

      const messages = result?.messages ?? [];
      const last = messages.filter((m: any) => m.sender === "agent").pop();

      bus.emit("agent_done", last?.text ?? "", elapsed);
    } catch (err: any) {
      bus.emit("agent_error", err.message);
    } finally {
      runningRef.current = false;
    }
  };

  return (
    <Box flexDirection="column">
      <Header />

      {/* History */}
      {state.history.map((entry, i) => {
        switch (entry.type) {
          case "user":
            return <UserMessage key={i} text={entry.text!} />;
          case "tools":
            return <ToolGroup key={i} tools={entry.tools!} />;
          case "agent":
            return (
              <AgentMessage key={i} text={entry.text!} elapsed={entry.elapsed} />
            );
          default:
            return null;
        }
      })}

      {/* Live area: current processing */}
      {state.phase === "processing" && (
        <Box flexDirection="column">
          {state.activeTools.length > 0 && (
            <ToolGroup tools={state.activeTools} />
          )}
          {state.streamedText ? (
            <StreamingText text={state.streamedText} />
          ) : (
            state.thinking && <ThinkingIndicator />
          )}
        </Box>
      )}

      {/* Error */}
      {state.error && <ErrorDisplay message={state.error} />}

      {/* Input + status */}
      <InputPrompt onSubmit={handleSubmit} active={state.phase === "idle"} />

      {state.stats.turns > 0 && <StatusBar stats={state.stats} />}
    </Box>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Agent subscriber that emits to the event bus
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class InkSubscriber implements SubscriberAdapter {
  private toolTimers: Map<string, number> = new Map();

  async record(event_type: string, data: any) {
    switch (event_type) {
      case "text_delta":
        bus.emit("text_delta", data.text);
        break;

      case "tool_use": {
        this.toolTimers.set(data.name, Date.now());
        bus.emit("tool_start", data.name, data.input);
        break;
      }

      case "tool_use_result": {
        const started = this.toolTimers.get(data.tool_name) ?? Date.now();
        const elapsed = Date.now() - started;
        const output = String(data.result.data ?? data.result.message ?? "");
        bus.emit("tool_end", data.tool_name, data.result.status, output, elapsed);
        break;
      }

      case "model_response": {
        bus.emit("turn_stats", data.tokens_in ?? 0, data.tokens_out ?? 0);
        break;
      }
    }
  }
}

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
// System prompt
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SYSTEM_PROMPT = `You are an expert coding assistant with access to the local file system and a bash shell.

## Tools
- **read_file**: Read file contents with optional line ranges
- **write_file**: Create or overwrite files
- **edit_file**: Surgical string replacement in files
- **list_dir**: Explore directory structure
- **search**: Regex search across files
- **bash**: Run any shell command

## Workflow
1. Explore first with list_dir and read_file before changing anything
2. Use edit_file for modifications — always read_file first for exact content
3. Run code with bash after writing it to verify it works
4. On failure: read error → fix → retry

Working directory: ${process.cwd()}`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Bootstrap
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function createAgent(subscriber: InkSubscriber) {
  const store = new MemoryStore("coding-session");

  const model = new AnthropicAdapter({
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 8192,
    systemPrompt: SYSTEM_PROMPT,
    stream: true,
    apiKey: process.env.ANTHROPIC_API_KEY!
  });

  const context = new Context(store);
  const promptMachine = new PromptMachine(model, context, model.name);
  promptMachine.addSubscriber(subscriber);

  const executor = new Executor();
  executor.addSubscriber(subscriber);
  for (const tool of codingTools) {
    executor.registerTool(tool);
  }

  const observer = new Observer(
    store,
    context,
    promptMachine,
    50,
    `Summarize the conversation. Preserve: file paths modified, task state, errors resolved, key decisions.`
  );

  return new Agent(store, executor, context, observer, promptMachine);
}

const subscriber = new InkSubscriber();
const agent = createAgent(subscriber);

render(<App agent={agent} />);