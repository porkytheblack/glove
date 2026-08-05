/**
 * The agent loop under test: a model, the environment's verbs, and nothing
 * else. Every tool call and every result is recorded, because the interesting
 * output of this benchmark is not the pass rate — it is *where models trip*.
 */
import type { EnvTool, WorkingEnvironment } from "glove-working-environment";
import { buildPreamble } from "glove-working-environment";
import { complete, type Message, type ToolSchema, type Usage } from "./openrouter";

export interface ToolEvent {
  turn: number;
  name: string;
  args: unknown;
  status: "success" | "error";
  /** The error message the model saw, verbatim — the friction signal. */
  message?: string;
  /** First line of the data payload, for context on what came back. */
  preview: string;
  ms: number;
}

export interface RunTranscript {
  model: string;
  scenario: string;
  turns: number;
  events: ToolEvent[];
  finalText: string;
  usage: Usage;
  stopReason: "finished" | "max-turns" | "error";
  error?: string;
  wallMs: number;
}

function toOpenAiSchema(tool: EnvTool): ToolSchema {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.jsonSchema as Record<string, unknown>,
    },
  };
}

/** Tool results reach the model as text; keep them bounded the same way a host would. */
function renderResult(data: unknown, message?: string, status?: string): string {
  const body = typeof data === "string" ? data : data === null || data === undefined ? "" : JSON.stringify(data);
  if (status === "error") return `ERROR: ${message ?? "failed"}${body ? `\n${body}` : ""}`;
  return body || "ok";
}

export async function runAgent(opts: {
  env: WorkingEnvironment;
  model: string;
  task: string;
  maxTurns?: number;
  signal?: AbortSignal;
}): Promise<RunTranscript> {
  const { env, model, task } = opts;
  const maxTurns = opts.maxTurns ?? 18;
  const tools = env.tools.map(toOpenAiSchema);
  const byName = new Map(env.tools.map((t) => [t.name, t]));

  const messages: Message[] = [
    { role: "system", content: `${buildPreamble(env)}\n\nWork until the deliverable exists, then stop and state where you put it.` },
    { role: "user", content: task },
  ];

  const events: ToolEvent[] = [];
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  const started = Date.now();
  let finalText = "";
  let stopReason: RunTranscript["stopReason"] = "max-turns";
  let error: string | undefined;

  try {
    for (let turn = 1; turn <= maxTurns; turn++) {
      const res = await complete({ model, messages, tools, signal: opts.signal });
      usage.prompt_tokens += res.usage.prompt_tokens;
      usage.completion_tokens += res.usage.completion_tokens;
      usage.cost = (usage.cost ?? 0) + (res.usage.cost ?? 0);

      if (res.content) finalText = res.content;

      if (res.toolCalls.length === 0) {
        stopReason = "finished";
        break;
      }

      messages.push({ role: "assistant", content: res.content, tool_calls: res.toolCalls });

      for (const call of res.toolCalls) {
        const tool = byName.get(call.function.name);
        const t0 = Date.now();

        if (!tool) {
          // A hallucinated verb is itself a finding: it says what the model
          // expected the surface to contain.
          const msg = `no such tool: ${call.function.name}`;
          events.push({ turn, name: call.function.name, args: call.function.arguments, status: "error", message: msg, preview: "", ms: 0 });
          messages.push({ role: "tool", tool_call_id: call.id, content: `ERROR: ${msg}` });
          continue;
        }

        let args: unknown = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          const msg = `arguments were not valid JSON`;
          events.push({ turn, name: tool.name, args: call.function.arguments, status: "error", message: msg, preview: "", ms: 0 });
          messages.push({ role: "tool", tool_call_id: call.id, content: `ERROR: ${msg}` });
          continue;
        }

        const result = await tool.do(args);
        const rendered = renderResult(result.data, result.message, result.status);
        events.push({
          turn,
          name: tool.name,
          args,
          status: result.status,
          message: result.message,
          preview: rendered.split("\n")[0].slice(0, 160),
          ms: Date.now() - t0,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: rendered });
      }
    }
  } catch (e) {
    stopReason = "error";
    error = e instanceof Error ? e.message : String(e);
  }

  return {
    model,
    scenario: "",
    turns: events.length === 0 ? 0 : events[events.length - 1].turn,
    events,
    finalText,
    usage,
    stopReason,
    error,
    wallMs: Date.now() - started,
  };
}
