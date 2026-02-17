import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env") });

import { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import z from "zod";

import {
  type StoreAdapter,
  type SubscriberAdapter,
  type Message,
  Displaymanager,
  type Slot,
  AnthropicAdapter,
  Glove,
} from "glove-core";

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
      case "tool_use":
        this.bridge.setThinking(false);
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
// Weather art
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const WEATHER_ART: Record<string, string[]> = {
  sunny: [
    "    \\   /    ",
    "     .-.     ",
    "  ― (   ) ― ",
    "     `-'     ",
    "    /   \\    ",
  ],
  cloudy: [
    "             ",
    "     .--.    ",
    "  .-(    ).  ",
    " (___.__)__) ",
    "             ",
  ],
  rainy: [
    "     .-.     ",
    "    (   ).   ",
    "   (___(__)  ",
    "   ' ' ' '   ",
    "   ' ' '     ",
  ],
  snow: [
    "     .-.     ",
    "    (   ).   ",
    "   (___(__)  ",
    "   * * * *   ",
    "    * * *    ",
  ],
  thunder: [
    "     .-.     ",
    "    (   ).   ",
    "   (___(__)  ",
    "   ⚡' ⚡'   ",
    "   ' ' '     ",
  ],
  partly_cloudy: [
    "   \\  /      ",
    " _ /\".-.     ",
    "   \\_(   ).  ",
    "   /(___(__) ",
    "             ",
  ],
};

const RAIN_FRAMES = [
  ["   ' ' ' '   ", "   ' ' '     "],
  ["    ' ' ' '  ", "    ' ' '    "],
  ["   ' ' ' '   ", "     ' ' '   "],
];

function pickArt(condition: string): string[] {
  const c = condition.toLowerCase();
  if (c.includes("thunder") || c.includes("storm")) return WEATHER_ART.thunder;
  if (c.includes("snow") || c.includes("sleet")) return WEATHER_ART.snow;
  if (c.includes("rain") || c.includes("drizzle") || c.includes("shower"))
    return WEATHER_ART.rainy;
  if (c.includes("cloud") || c.includes("overcast")) return WEATHER_ART.cloudy;
  if (c.includes("partly") || c.includes("partial"))
    return WEATHER_ART.partly_cloudy;
  return WEATHER_ART.sunny;
}

function tempColor(temp: number): string {
  if (temp < 5) return "blue";
  if (temp < 15) return "cyan";
  if (temp < 25) return "yellow";
  if (temp < 35) return "redBright";
  return "red";
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

function useAnimationFrame(interval = 200) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), interval);
    return () => clearInterval(id);
  }, [interval]);
  return frame;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Components
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function Header() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">
        {"  ⛅ Weather Agent"}
      </Text>
      <Text dimColor>{"  ─".repeat(30)}</Text>
    </Box>
  );
}

function ThinkingIndicator() {
  return (
    <Box marginLeft={2} marginY={1}>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text dimColor> Thinking...</Text>
    </Box>
  );
}

function StreamingText({ text }: { text: string }) {
  return (
    <Box marginLeft={4}>
      <Text>{text}</Text>
      <Text color="cyan">▊</Text>
    </Box>
  );
}

function StatusBar({ bridge }: { bridge: AgentBridge }) {
  const state = useAgentBridge(bridge);
  if (state.turns === 0) return null;
  return (
    <Box marginLeft={2} marginTop={1}>
      <Text dimColor>
        {state.turns} turns | {state.tokensIn.toLocaleString()} in | {state.tokensOut.toLocaleString()} out
      </Text>
    </Box>
  );
}

// ── Weather card with animated rain ───────────────────────────────

function WeatherCard({
  data,
}: {
  data: {
    location: string;
    temp: number;
    condition: string;
    wind: string;
    humidity: string;
    feelsLike?: number;
  };
}) {
  const frame = useAnimationFrame(300);
  const art = pickArt(data.condition);
  const isRainy =
    data.condition.toLowerCase().includes("rain") ||
    data.condition.toLowerCase().includes("drizzle");

  const displayArt = isRainy
    ? [...art.slice(0, 3), ...RAIN_FRAMES[frame % RAIN_FRAMES.length]]
    : art;

  const tc = tempColor(data.temp);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginLeft={3}
      marginY={1}
    >
      <Text bold color="cyan">
        {"🌍 "}
        {data.location}
      </Text>
      <Text> </Text>
      <Box>
        <Box flexDirection="column" marginRight={3}>
          {displayArt.map((line, i) => (
            <Text key={i} color="yellowBright">
              {line}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Box>
            <Text>{"🌡️  "}</Text>
            <Text bold color={tc as any}>
              {data.temp}°C
            </Text>
            {data.feelsLike !== undefined && (
              <Text dimColor>{`  feels ${data.feelsLike}°C`}</Text>
            )}
          </Box>
          <Text>
            {"☁️  "}
            {data.condition}
          </Text>
          <Text>
            {"💨 "}
            {data.wind}
          </Text>
          <Text>
            {"💧 "}
            {data.humidity}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

// ── Loading indicator with weather emoji animation ────────────────

function LoadingSlot({ message }: { message: string }) {
  const frame = useAnimationFrame(200);
  const emojis = [
    "🌤️",
    "⛅",
    "🌥️",
    "☁️",
    "🌦️",
    "🌧️",
    "⛈️",
    "🌧️",
    "🌦️",
    "🌥️",
    "⛅",
  ];
  const emoji = emojis[frame % emojis.length];

  return (
    <Box marginLeft={3} marginY={1}>
      <Text>{emoji} </Text>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text dimColor> {message}</Text>
    </Box>
  );
}

// ── Info box ──────────────────────────────────────────────────────

function InfoSlot({
  data,
}: {
  data: { title?: string; message: string; type?: string };
}) {
  const colors: Record<string, string> = {
    info: "cyan",
    success: "green",
    warning: "yellow",
    error: "red",
  };
  const color = colors[data.type ?? "info"] ?? "cyan";

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color as any}
      paddingX={2}
      marginLeft={3}
      marginY={1}
    >
      {data.title && (
        <Text bold color={color as any}>
          {data.title}
        </Text>
      )}
      <Text>{data.message}</Text>
    </Box>
  );
}

// ── Interactive input slot ────────────────────────────────────────

function InputSlot({
  slot,
  dm,
}: {
  slot: Slot<{ message: string; default?: string; placeholder?: string }>;
  dm: Displaymanager;
}) {
  const data = slot.input;
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(
    (val: string) => {
      const result = val.trim() || data.default || "";
      dm.resolve(slot.id, result);
    },
    [slot.id, data.default, dm],
  );

  return (
    <Box flexDirection="column" marginLeft={3} marginY={1}>
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        flexDirection="column"
      >
        <Text bold color="cyan">
          {"🌍 "}
          {data.message}
        </Text>
        {data.default && (
          <Text dimColor>{`   Default: ${data.default}`}</Text>
        )}
      </Box>
      <Box marginLeft={2} marginTop={1}>
        <Text color="cyan" bold>
          {"  → "}
        </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={data.placeholder ?? "Type here..."}
        />
      </Box>
    </Box>
  );
}

// ── Select slot ───────────────────────────────────────────────────

function SelectSlot({
  slot,
  dm,
}: {
  slot: Slot<{ message: string; options: string[]; default?: string }>;
  dm: Displaymanager;
}) {
  const data = slot.input;
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(
    (val: string) => {
      const idx = parseInt(val, 10);
      let result: string;
      if (!isNaN(idx) && idx >= 1 && idx <= data.options.length) {
        result = data.options[idx - 1];
      } else if (val.trim()) {
        result = val.trim();
      } else {
        result = data.default ?? data.options[0];
      }
      dm.resolve(slot.id, result);
    },
    [slot.id, data, dm],
  );

  return (
    <Box flexDirection="column" marginLeft={3} marginY={1}>
      <Box borderStyle="round" borderColor="magenta" paddingX={2}>
        <Text color="magenta">{data.message}</Text>
      </Box>
      {data.options.map((opt, i) => (
        <Box key={i} marginLeft={2}>
          <Text color="cyan">{`  ${i + 1}. `}</Text>
          <Text>{opt}</Text>
        </Box>
      ))}
      <Box marginLeft={2} marginTop={1}>
        <Text color="magenta" bold>
          {"  # "}
        </Text>
        <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
      </Box>
    </Box>
  );
}

// ── Slot dispatcher ──────────────────────────────────────────────

function SlotView({
  slot,
  dm,
}: {
  slot: Slot<any>;
  dm: Displaymanager;
}) {
  switch (slot.renderer) {
    case "info":
      return <InfoSlot data={slot.input} />;
    case "weather_card":
      return <WeatherCard data={slot.input} />;
    case "loading":
      return <LoadingSlot message={slot.input?.message ?? "Loading..."} />;
    case "input":
      return <InputSlot slot={slot} dm={dm} />;
    case "select":
      return <SelectSlot slot={slot} dm={dm} />;
    default:
      return (
        <Box marginLeft={3}>
          <Text dimColor>
            [{slot.renderer}] {JSON.stringify(slot.input)}
          </Text>
        </Box>
      );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// App
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type AppMode = "idle" | "thinking" | "slot_active";

function App({
  dm,
  bridge,
  processRequest,
}: {
  dm: Displaymanager;
  bridge: AgentBridge;
  processRequest: (msg: string) => Promise<any>;
}) {
  const { exit } = useApp();
  const stack = useDisplayManager(dm);
  const state = useAgentBridge(bridge);

  const [mode, setMode] = useState<AppMode>("idle");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<
    Array<{ role: "user" | "agent"; text: string }>
  >([]);

  // The topmost slot that needs user input takes over the UI
  const activeSlot = stack.length > 0 ? stack[stack.length - 1] : null;
  const slotNeedsInput = activeSlot ? dm.resolverStore.has(activeSlot.id) : false;
  const effectiveMode = slotNeedsInput ? "slot_active" : mode;

  const handleSubmit = useCallback(
    async (val: string) => {
      const trimmed = val.trim();
      if (!trimmed) return;

      if (trimmed === "exit" || trimmed === "quit") {
        exit();
        return;
      }

      setInput("");
      setHistory((h) => [...h, { role: "user", text: trimmed }]);
      setMode("thinking");
      bridge.resetStream();
      bridge.setThinking(true);

      try {
        const result = await processRequest(trimmed);
        const msgs = result?.messages ?? [];
        const last = msgs.filter((m: any) => m.sender === "agent").pop();

        if (last?.text) {
          setHistory((h) => [...h, { role: "agent", text: last.text }]);
        } else if (bridge.streamText) {
          setHistory((h) => [
            ...h,
            { role: "agent", text: bridge.streamText },
          ]);
        }
      } catch (err: any) {
        setHistory((h) => [
          ...h,
          { role: "agent", text: `Error: ${err.message}` },
        ]);
      }

      bridge.setThinking(false);
      bridge.resetStream();
      setMode("idle");
    },
    [bridge, processRequest, exit],
  );

  useInput((_, key) => {
    if (key.ctrl && _.toLowerCase() === "c") exit();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header />

      {/* Conversation history */}
      {history.map((msg, i) => (
        <Box
          key={i}
          marginLeft={2}
          marginBottom={msg.role === "agent" ? 1 : 0}
        >
          {msg.role === "user" ? (
            <Text>
              <Text color="green" bold>
                {"❯ "}
              </Text>
              <Text>{msg.text}</Text>
            </Text>
          ) : (
            <Text>
              <Text dimColor>{"  "}</Text>
              <Text>{msg.text}</Text>
            </Text>
          )}
        </Box>
      ))}

      {/* Active display slot */}
      {activeSlot && <SlotView slot={activeSlot} dm={dm} />}

      {/* Streaming text */}
      {state.streamText && mode === "thinking" && (
        <StreamingText text={state.streamText} />
      )}

      {/* Thinking indicator */}
      {state.thinking && !slotNeedsInput && !state.streamText && (
        <ThinkingIndicator />
      )}

      {/* Main input */}
      {effectiveMode === "idle" && (
        <Box marginLeft={2} marginTop={1}>
          <Text color="green" bold>
            {"❯ "}
          </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Ask about the weather..."
          />
        </Box>
      )}

      <StatusBar bridge={bridge} />
    </Box>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Weather API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchWeather(location: string) {
  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const current = json.current_condition?.[0] ?? {};
    const area = json.nearest_area?.[0] ?? {};
    const areaName = area.areaName?.[0]?.value ?? location;
    const country = area.country?.[0]?.value ?? "";

    return {
      location: country ? `${areaName}, ${country}` : areaName,
      temp: parseInt(current.temp_C ?? "20", 10),
      feelsLike: parseInt(current.FeelsLikeC ?? current.temp_C ?? "20", 10),
      condition: current.weatherDesc?.[0]?.value ?? "Unknown",
      wind: `${current.windspeedKmph ?? "?"} km/h ${current.winddir16Point ?? ""}`,
      humidity: `${current.humidity ?? "?"}%`,
    };
  } catch {
    const conditions = [
      "Partly cloudy",
      "Sunny",
      "Light rain",
      "Overcast",
      "Clear",
    ];
    return {
      location,
      temp: Math.floor(Math.random() * 30) + 5,
      feelsLike: Math.floor(Math.random() * 30) + 3,
      condition: conditions[Math.floor(Math.random() * conditions.length)],
      wind: `${Math.floor(Math.random() * 30)} km/h NE`,
      humidity: `${Math.floor(Math.random() * 60) + 30}%`,
    };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Build agent
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SYSTEM_PROMPT = `You are a friendly weather assistant. You help people check the weather and plan activities.

## Tools
- check_weather: Get current weather for a location. If the user doesn't specify a location, the tool will ask them.
- suggest_activity: Suggest outdoor/indoor activities based on weather. Shows options and lets the user pick.

Always use check_weather when the user asks about weather. Be conversational and brief in your responses.
If the user greets you, greet them back and ask if they'd like to check the weather somewhere.`;

function buildAgent(dm: Displaymanager, subscriber: SubscriberAdapter) {
  const glove = new Glove({
    store: new MemoryStore("weather-agent"),
    model: new AnthropicAdapter({
      model: "claude-sonnet-4-5-20250929",
      maxTokens: 2048,
      stream: true,
      apiKey: process.env.ANTHROPIC_API_KEY,
    }),
    displayManager: dm,
    systemPrompt: SYSTEM_PROMPT,
    compaction_config: {
      max_turns: 20,
      compaction_instructions:
        "Summarize the conversation so far. Preserve: locations checked, weather results, user preferences.",
    },
  });

  // ── check_weather ─────────────────────────────────────────────
  glove.fold({
    name: "check_weather",
    description:
      "Get current weather for a location. If location is empty or vague, asks the user interactively.",
    inputSchema: z.object({
      location: z
        .string()
        .optional()
        .describe("City or location name. Leave empty to ask user."),
    }),
    async do(input, display) {
      let location = input.location?.trim();

      if (!location) {
        location = String(
          await display.pushAndWait({
            renderer: "input",
            input: {
              message: "Where do you want to check the weather?",
              placeholder: "e.g. Tokyo, London, Nairobi...",
            },
          }),
        ).trim();
      }

      if (!location) return "No location provided.";

      await display.pushAndForget({
        renderer: "loading",
        input: { message: `Fetching weather for ${location}...` },
      });

      const weather = await fetchWeather(location);

      await display.pushAndForget({
        renderer: "weather_card",
        input: weather,
      });

      return (
        `Weather in ${weather.location}: ${weather.temp}°C, ${weather.condition}. ` +
        `Wind: ${weather.wind}. Humidity: ${weather.humidity}. ` +
        `Feels like ${weather.feelsLike}°C.`
      );
    },
  });

  // ── suggest_activity ──────────────────────────────────────────
  glove.fold({
    name: "suggest_activity",
    description:
      "Suggest activities based on current weather conditions. Shows options for the user to choose from.",
    inputSchema: z.object({
      weather_condition: z
        .string()
        .describe("Current weather condition, e.g. 'Sunny', 'Rainy'"),
      temperature: z.number().describe("Temperature in Celsius"),
    }),
    async do(input, display) {
      const isNice =
        input.temperature > 15 &&
        input.temperature < 35 &&
        !input.weather_condition.toLowerCase().includes("rain") &&
        !input.weather_condition.toLowerCase().includes("storm");

      const activities = isNice
        ? [
            "🏃 Go for a run in the park",
            "☕ Find a cafe with outdoor seating",
            "📸 Take a photo walk around the city",
            "🧺 Have a picnic",
          ]
        : [
            "📚 Visit a bookstore or library",
            "🎬 Catch a movie at the cinema",
            "🍜 Try a new restaurant",
            "🏋️ Hit the gym",
          ];

      await display.pushAndForget({
        renderer: "info",
        input: {
          title: isNice
            ? "Great weather for outdoor activities!"
            : "Better to stay indoors today.",
          message: `${input.temperature}°C and ${input.weather_condition}`,
          type: isNice ? "success" : "info",
        },
      });

      const choice = await display.pushAndWait({
        renderer: "select",
        input: {
          message: "Pick an activity:",
          options: activities,
        },
      });

      return `User chose: ${choice}`;
    },
  });

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

  render(
    <App dm={dm} bridge={bridge} processRequest={processRequest} />,
  );
}

main();
