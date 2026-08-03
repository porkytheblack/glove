/**
 * The loop under test: a model, the seven form verbs, a scripted user, and
 * nothing else.
 *
 * The user is scripted rather than simulated by a second model. A model-driven
 * user would drift between runs and between cells, and the whole point is to
 * hold the conversation fixed so the *difference* between models is
 * attributable to them. It also keeps a full matrix inside a dollar.
 *
 * Tier-0 injection mirrors `useFormRunner`: the system prompt is recomposed at
 * the top of every user turn as `<base>\n\n<tier-0 line>`, and stays fixed for
 * the tool calls within that turn.
 */
import type { CompiledForm, FormRunner } from "glove-memory/forms";
import type { FormAdapter } from "glove-memory/forms";
import { bridgeFormTools, renderResult, type BridgedTool } from "./tools";
import type { CompleteFn, Message, ToolCall } from "./openrouter";
import {
  countTokens,
  emptyLedger,
  renderEagerForm,
  type ContextLedger,
} from "./tokens";

export const BASE_PROMPT =
  "You are an assistant collecting information from a member of staff over chat. " +
  "Use the form tools to record what you learn. Ask for what's still needed, a little at a time, " +
  "and keep the conversation natural. Never invent an answer the user didn't give.";

export interface ToolEvent {
  turn: number;
  name: string;
  args: any;
  status: string;
  message?: string;
  /** Compact view of what came back — enough to grade against. */
  data: any;
  ms: number;
}

export interface TurnRecord {
  turn: number;
  user: string;
  assistant: string;
  toolCalls: number;
}

export interface Behaviour {
  listCalls: number;
  startCalls: number;
  statusCalls: number;
  inspectCalls: number;
  fillCalls: number;
  reviseCalls: number;
  abandonCalls: number;
  /** Field ids written across all fill/revise calls. */
  fieldsWritten: number;
  /** Values the schema rejected — recoverable friction, not a crash. */
  rejectedValues: number;
  /** Field ids the form doesn't declare. Pure hallucination signal. */
  unknownFieldAttempts: number;
  /** A write that re-sent a value already stored and valid. Wasted turn. */
  redundantWrites: number;
  /** Tool calls that came back an error, or named a tool that doesn't exist. */
  toolErrors: number;
  hallucinatedTools: number;
  /**
   * Completions that hit the token ceiling. A reasoning model that spends its
   * whole budget thinking returns no content and no tool call, which is
   * indistinguishable from one that ignored its tools — so it is counted
   * separately and shouted about in the report rather than scored as a miss.
   */
  truncatedCompletions: number;
  /** Completions with neither content nor a tool call. */
  emptyCompletions: number;
}

export interface RunTranscript {
  model: string;
  scenario: string;
  turns: TurnRecord[];
  events: ToolEvent[];
  behaviour: Behaviour;
  ledger: ContextLedger;
  stopReason: "finished" | "error";
  error?: string;
  wallMs: number;
}

function emptyBehaviour(): Behaviour {
  return {
    listCalls: 0,
    startCalls: 0,
    statusCalls: 0,
    inspectCalls: 0,
    fillCalls: 0,
    reviseCalls: 0,
    abandonCalls: 0,
    fieldsWritten: 0,
    rejectedValues: 0,
    unknownFieldAttempts: 0,
    redundantWrites: 0,
    toolErrors: 0,
    hallucinatedTools: 0,
    truncatedCompletions: 0,
    emptyCompletions: 0,
  };
}

/** Reads that exist only because the surface is tiered. */
const READ_TOOLS = new Set(["glove_form_status", "glove_form_inspect", "glove_form_list"]);

export async function runAgent(opts: {
  runner: FormRunner;
  adapter: FormAdapter;
  compiled: CompiledForm<any>;
  instanceId: string;
  model: string;
  userTurns: string[];
  complete: CompleteFn;
  maxStepsPerTurn?: number;
  signal?: AbortSignal;
}): Promise<RunTranscript> {
  const maxSteps = opts.maxStepsPerTurn ?? 6;
  const tools: BridgedTool[] = bridgeFormTools(opts.runner);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const schemas = tools.map((t) => t.schema);

  // Re-sent verbatim on every completion call, so counted on every call.
  const schemaTokens = countTokens(JSON.stringify(schemas));

  const ledger = emptyLedger();
  const behaviour = emptyBehaviour();
  const events: ToolEvent[] = [];
  const turns: TurnRecord[] = [];
  const messages: Message[] = [{ role: "system", content: BASE_PROMPT }];
  /** tool_call_ids whose result came from a tiered read verb. */
  const readCallIds = new Set<string>();
  const started = Date.now();

  let stopReason: RunTranscript["stopReason"] = "finished";
  let error: string | undefined;

  try {
    for (const [i, user] of opts.userTurns.entries()) {
      const turn = i + 1;

      // Tier-0 injection, exactly as `useFormRunner` does it.
      const tier0 = await opts.runner.tier0();
      messages[0] = {
        role: "system",
        content: tier0 ? `${BASE_PROMPT}\n\n${tier0}` : BASE_PROMPT,
      };
      const tier0Tokens = countTokens(tier0);

      // The counterfactual, priced against the same instance at the same moment.
      const instance = await opts.adapter.getInstance(opts.instanceId);
      const eagerTokens = instance
        ? countTokens(renderEagerForm(opts.compiled, instance))
        : 0;

      messages.push({ role: "user", content: user });
      let assistant = "";
      let toolCallCount = 0;

      for (let step = 0; step < maxSteps; step++) {
        const res = await opts.complete({
          model: opts.model,
          messages,
          tools: schemas,
          signal: opts.signal,
        });

        ledger.calls += 1;
        ledger.promptTokens += res.usage.prompt_tokens;
        ledger.completionTokens += res.usage.completion_tokens;
        ledger.cost += res.usage.cost ?? 0;
        ledger.toolSchemaTokens += schemaTokens;
        ledger.tier0Tokens += tier0Tokens;
        ledger.eagerBaselineTokens += eagerTokens;
        // Tool results accumulate in the history and are re-sent on every
        // later call, so the running total is what the context actually holds.
        const results = currentResultTokens(messages, readCallIds);
        ledger.readResultTokens += results.read;
        ledger.writeResultTokens += results.write;

        if (res.finishReason === "length") behaviour.truncatedCompletions += 1;
        if (!res.content && res.toolCalls.length === 0) behaviour.emptyCompletions += 1;

        if (res.content) assistant = res.content;
        if (res.toolCalls.length === 0) break;

        messages.push({
          role: "assistant",
          content: res.content,
          tool_calls: res.toolCalls,
        });
        toolCallCount += res.toolCalls.length;

        for (const call of res.toolCalls) {
          if (READ_TOOLS.has(call.function.name)) readCallIds.add(call.id);
          await dispatch({
            call,
            turn,
            byName,
            behaviour,
            events,
            messages,
          });
        }
      }

      turns.push({ turn, user, assistant, toolCalls: toolCallCount });
    }
  } catch (e) {
    stopReason = "error";
    error = e instanceof Error ? e.message : String(e);
  }

  return {
    model: opts.model,
    scenario: "",
    turns,
    events,
    behaviour,
    ledger,
    stopReason,
    error,
    wallMs: Date.now() - started,
  };
}

async function dispatch(ctx: {
  call: ToolCall;
  turn: number;
  byName: Map<string, BridgedTool>;
  behaviour: Behaviour;
  events: ToolEvent[];
  messages: Message[];
}): Promise<void> {
  const { call, turn, byName, behaviour, events, messages } = ctx;
  const tool = byName.get(call.function.name);
  const t0 = Date.now();

  if (!tool) {
    // A hallucinated verb is itself a finding: it says what the model expected
    // the surface to contain.
    const msg = `no such tool: ${call.function.name}`;
    behaviour.hallucinatedTools += 1;
    behaviour.toolErrors += 1;
    events.push({
      turn,
      name: call.function.name,
      args: call.function.arguments,
      status: "error",
      message: msg,
      data: null,
      ms: 0,
    });
    messages.push({ role: "tool", tool_call_id: call.id, content: `ERROR: ${msg}` });
    return;
  }

  let args: any = {};
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    const msg = "arguments were not valid JSON";
    behaviour.toolErrors += 1;
    events.push({
      turn,
      name: tool.name,
      args: call.function.arguments,
      status: "error",
      message: msg,
      data: null,
      ms: 0,
    });
    messages.push({ role: "tool", tool_call_id: call.id, content: `ERROR: ${msg}` });
    return;
  }

  countCall(behaviour, tool.name, args);

  const result = await tool.run(args);
  const rendered = renderResult(result);

  if (result.status === "error") behaviour.toolErrors += 1;
  countResult(behaviour, tool.name, args, result.data);

  events.push({
    turn,
    name: tool.name,
    args,
    status: result.status,
    message: result.message,
    data: result.data,
    ms: Date.now() - t0,
  });
  messages.push({ role: "tool", tool_call_id: call.id, content: rendered });
}

function countCall(b: Behaviour, name: string, args: any): void {
  switch (name) {
    case "glove_form_list":
      b.listCalls += 1;
      break;
    case "glove_form_start":
      b.startCalls += 1;
      b.fieldsWritten += Object.keys(args?.values ?? {}).length;
      break;
    case "glove_form_status":
      b.statusCalls += 1;
      break;
    case "glove_form_inspect":
      b.inspectCalls += 1;
      break;
    case "glove_form_fill":
      b.fillCalls += 1;
      b.fieldsWritten += Object.keys(args?.values ?? {}).length;
      break;
    case "glove_form_revise":
      b.reviseCalls += 1;
      b.fieldsWritten += args?.field ? 1 : 0;
      break;
    case "glove_form_abandon":
      b.abandonCalls += 1;
      break;
  }
}

/**
 * The write tools report exactly what happened to each value, so the friction
 * signals come off the result rather than being inferred from the text.
 */
function countResult(b: Behaviour, name: string, args: any, data: any): void {
  if (name !== "glove_form_fill" && name !== "glove_form_start" && name !== "glove_form_revise") {
    return;
  }
  if (!data || typeof data !== "object") return;
  b.rejectedValues += Array.isArray(data.rejected) ? data.rejected.length : 0;
  b.unknownFieldAttempts += Array.isArray(data.unknown_fields) ? data.unknown_fields.length : 0;

  // A write is redundant when the value it sent was already stored and valid.
  const sent: Record<string, unknown> =
    name === "glove_form_revise"
      ? args?.field
        ? { [args.field]: args.value }
        : {}
      : (args?.values ?? {});
  const fields: any[] = Array.isArray(data.fields) ? data.fields : [];
  const captured: string[] = Array.isArray(data.captured) ? data.captured : [];
  for (const [id, value] of Object.entries(sent)) {
    if (captured.includes(id)) continue;
    const row = fields.find((f) => f?.id === id);
    if (row?.status === "filled" && JSON.stringify(row.value) === JSON.stringify(value)) {
      b.redundantWrites += 1;
    }
  }
}

function currentResultTokens(
  messages: Message[],
  readCallIds: Set<string>,
): { read: number; write: number } {
  let read = 0;
  let write = 0;
  for (const m of messages) {
    if (m.role !== "tool") continue;
    const n = countTokens(m.content);
    if (readCallIds.has(m.tool_call_id)) read += n;
    else write += n;
  }
  return { read, write };
}
