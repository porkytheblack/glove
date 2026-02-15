import "dotenv/config";
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
} from "../../src/core";
import { Displaymanager, type Slot } from "../../src/display-manager";
import { Glove } from "../../src/glove";
import { codingTools } from "./tools";
import { OpenRouterAdapter } from "../../src/models/openrouter";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// In-memory store
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class MemoryStore implements StoreAdapter {
  identifier: string;
  private messages: Array<Message> = [];
  private tokenCount = 0;
  private turnCount = 0;

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
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Agent bridge: subscriber → React state
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class AgentBridge {
  thinking = false;
  streamText = "";
  turns = 0;
  tokensIn = 0;
  tokensOut = 0;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
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
        ⚡ Coding Agent
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
      {"❯ "}
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
      <Text dimColor>⏱ {formatMs(elapsed)}</Text>
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

const StatusBar: FC<{ bridge: AgentBridge }> = ({ bridge }) => {
  const state = useAgentBridge(bridge);
  if (state.turns === 0) return null;
  const width = Math.min(process.stdout.columns || 80, 80);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{"─".repeat(width)}</Text>
      <Text dimColor>
        {"  "}
        {state.turns} turns · {state.tokensIn.toLocaleString()} in ·{" "}
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
        {"❯ "}
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
// Display slot renderers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function ToolRunningSlot({ data }: { data: { name: string; toolInput: any } }) {
  const icon = toolIcon(data.name);
  const inputStr = formatToolInput(data.name, data.toolInput);

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text>
          {icon}{" "}
        </Text>
        <Text bold>{data.name}</Text>
        <Text dimColor> {inputStr}</Text>
        <Text color="cyan">
          {" "}
          <Spinner type="dots" />
        </Text>
      </Box>
    </Box>
  );
}

function ToolResultSlot({ data }: {
  data: {
    name: string;
    toolInput: any;
    output: string;
    status: "success" | "error";
    elapsed: number;
  };
}) {
  const icon = toolIcon(data.name);
  const inputStr = formatToolInput(data.name, data.toolInput);
  const isError = data.status === "error";

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text>
          {icon}{" "}
        </Text>
        <Text bold>{data.name}</Text>
        <Text dimColor> {inputStr}</Text>
        {isError ? (
          <Text color="red"> ✗</Text>
        ) : (
          <Text color="green"> ✓</Text>
        )}
        <Text dimColor> {formatMs(data.elapsed)}</Text>
      </Box>
      {data.output && (
        <Box
          marginLeft={2}
          borderStyle="single"
          borderColor={isError ? "red" : "gray"}
          paddingX={1}
        >
          <Text dimColor={!isError} color={isError ? "red" : undefined}>
            {truncateLines(data.output, 10)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function CodingSlotView({ slot }: { slot: Slot<any> }) {
  switch (slot.renderer) {
    case "tool_running":
      return <ToolRunningSlot data={slot.input} />;
    case "tool_result":
      return <ToolResultSlot data={slot.input} />;
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
  processRequest: (msg: string) => Promise<any>;
}> = ({ dm, bridge, processRequest }) => {
  const { exit } = useApp();
  const stack = useDisplayManager(dm);
  const state = useAgentBridge(bridge);

  const [mode, setMode] = useState<"idle" | "thinking">("idle");
  const [history, setHistory] = useState<
    Array<{ role: "user" | "agent"; text: string; elapsed?: number }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  useInput((input, key) => {
    if (input === "q" && mode === "idle") {
      exit();
      process.exit(0);
    }
    if (key.ctrl && input === "c") {
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

      setHistory((h) => [...h, { role: "user", text }]);
      setMode("thinking");
      setError(null);
      bridge.resetStream();
      bridge.setThinking(true);
      await dm.clearStack();

      const startTime = Date.now();

      try {
        const result: any = await processRequest(text);
        const elapsed = Date.now() - startTime;

        const messages = result?.messages ?? [];
        const last = messages.filter((m: any) => m.sender === "agent").pop();
        const finalText = state.streamText || last?.text;

        if (finalText) {
          setHistory((h) => [...h, { role: "agent", text: finalText, elapsed }]);
        }
      } catch (err: any) {
        setError(err.message);
      }

      bridge.setThinking(false);
      bridge.resetStream();
      setMode("idle");
      runningRef.current = false;
    },
    [bridge, dm, processRequest, exit, state.streamText],
  );

  return (
    <Box flexDirection="column">
      <Header />

      {/* Conversation history */}
      {history.map((msg, i) =>
        msg.role === "user" ? (
          <UserMessage key={i} text={msg.text} />
        ) : (
          <AgentMessage key={i} text={msg.text} elapsed={msg.elapsed} />
        ),
      )}

      {/* Display manager slots (tool running/results) */}
      {stack.map((slot) => (
        <CodingSlotView key={slot.id} slot={slot} />
      ))}

      {/* Streaming text */}
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

Working directory: ${process.cwd()}
all generated code should live under the lab folder

`;

function buildAgent(dm: Displaymanager, subscriber: SubscriberAdapter) {
  const glove = new Glove({
    store: new MemoryStore("coding-session"),
    model: new OpenRouterAdapter({
      model: "moonshotai/kimi-k2.5",
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
      async do(input, display) {
        const start = Date.now();
        const runningId = await display.pushAndForget({
          renderer: "tool_running",
          input: { name: tool.name, toolInput: input },
        });

        try {
          const result = await tool.run(input);
          display.removeSlot(runningId);
          await display.pushAndForget({
            renderer: "tool_result",
            input: {
              name: tool.name,
              toolInput: input,
              output: String(result),
              status: "success" as const,
              elapsed: Date.now() - start,
            },
          });
          return result;
        } catch (err: any) {
          display.removeSlot(runningId);
          await display.pushAndForget({
            renderer: "tool_result",
            input: {
              name: tool.name,
              toolInput: input,
              output: err.message,
              status: "error" as const,
              elapsed: Date.now() - start,
            },
          });
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
  const agent = buildAgent(dm, subscriber);

  const processRequest = async (msg: string) => {
    return agent.processRequest(msg);
  };

  render(<App dm={dm} bridge={bridge} processRequest={processRequest} />);
}

main();
