import { createHash } from "node:crypto";
import type {
  ContentPart,
  Message,
  ModelRequestTool,
  SubscriberEventDataMap,
  ToolCall,
  ToolResult,
} from "glove-core";

/**
 * What Foundry records for each model request, so the inspector can show
 * what the model had in front of it without the event stream carrying the
 * whole conversation every time.
 *
 * - The system prompt and the tool list are recorded in full the first time a
 *   run sends them, then by hash.
 * - Messages are recorded as a change against the previous request with the
 *   same system prompt: how many leading messages it kept, then the rest.
 * - Runtime context (memory, goals, anything a context provider adds) sits at
 *   the tail of every request and is recorded on its own, each time.
 * - Long text and JSON are cut, media becomes a placeholder, and reasoning
 *   echoed back to the provider is left out.
 */

/** Set to "off" in an agent job to leave model requests out of observability. */
export const FOUNDRY_MODEL_REQUESTS_ENV = "GLOVE_FOUNDRY_MODEL_REQUESTS";

const TEXT_LIMIT = 16_000;
const JSON_LIMIT = 16_000;
const SYSTEM_PROMPT_LIMIT = 64_000;
const TOOL_SCHEMA_LIMIT = 8_000;
/** The most message text one request records; older messages past it are counted, not kept. */
const MESSAGES_BUDGET = 400_000;

export interface TracedContentPart {
  readonly type: ContentPart["type"];
  readonly text?: string;
  readonly name?: string;
  readonly media_type?: string;
}

export interface TracedMessage {
  readonly sender: Message["sender"];
  readonly text: string;
  /** The text's full length, when it was cut. */
  readonly text_chars?: number;
  readonly framework_context?: Message["framework_context"];
  readonly is_compaction?: true;
  readonly is_compaction_request?: true;
  readonly is_skill_injection?: true;
  readonly content?: ReadonlyArray<TracedContentPart>;
  readonly tool_calls?: ReadonlyArray<{ readonly id?: string; readonly tool_name: string; readonly input_args: unknown }>;
  readonly tool_results?: ReadonlyArray<{
    readonly call_id?: string;
    readonly tool_name: string;
    readonly status: string;
    readonly data: unknown;
    readonly message?: string;
    readonly duration_ms?: number;
  }>;
  /** The provider's reasoning was echoed with this message; it isn't recorded. */
  readonly reasoning_omitted?: true;
}

export interface TracedModelRequest {
  readonly request_id: string;
  readonly model: string;
  readonly purpose: "turn" | "compaction";
  readonly system_prompt: {
    readonly hash: string;
    readonly chars: number;
    /** Present the first time this run sends this prompt. */
    readonly text?: string;
  };
  readonly tools: {
    readonly hash: string;
    readonly names: ReadonlyArray<string>;
    /** Present the first time this run offers this set of tools. */
    readonly list?: ReadonlyArray<ModelRequestTool>;
  };
  readonly messages: {
    /** Messages in the request, runtime context excluded. */
    readonly total: number;
    /** The earlier request these messages continue. */
    readonly base?: string;
    /** Leading messages that are the same as in `base`. */
    readonly kept: number;
    /** Messages after `kept` that weren't recorded because the request was too large. */
    readonly skipped?: number;
    /** The remaining messages, in order. */
    readonly added: ReadonlyArray<TracedMessage>;
  };
  /** Runtime context at the tail of the request. */
  readonly context: ReadonlyArray<TracedMessage>;
}

export interface TracedModelRequestEnd {
  readonly request_id: string;
  readonly model: string;
  readonly duration_ms: number;
  readonly status: "success" | "error" | "aborted";
  readonly error?: string;
  readonly response?: ReadonlyArray<TracedMessage>;
  readonly tokens_in?: number;
  readonly tokens_out?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 16);
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return JSON.stringify(String(value));
  }
}

function cut(text: string, limit: number): { readonly text: string; readonly chars?: number } {
  return text.length > limit ? { text: text.slice(0, limit), chars: text.length } : { text };
}

/** JSON-safe, and no larger than `limit` once serialized. */
function capped(value: unknown, limit = JSON_LIMIT): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const { text, chars } = cut(value, limit);
    return chars === undefined ? text : `${text}… [${chars} characters]`;
  }
  const serialized = json(value);
  if (serialized.length <= limit) return JSON.parse(serialized) as unknown;
  return { truncated: true, chars: serialized.length, preview: serialized.slice(0, limit) };
}

function tracePart(part: ContentPart): TracedContentPart {
  if (part.type === "text") return { type: "text", text: cut(part.text ?? "", TEXT_LIMIT).text };
  return {
    type: part.type,
    ...(part.name ? { name: part.name } : {}),
    ...(part.source?.media_type ? { media_type: part.source.media_type } : {}),
  };
}

function traceCall(call: ToolCall) {
  return { ...(call.id ? { id: call.id } : {}), tool_name: call.tool_name, input_args: capped(call.input_args) };
}

function traceResult(result: ToolResult) {
  return {
    ...(result.call_id ? { call_id: result.call_id } : {}),
    tool_name: result.tool_name,
    status: result.result.status,
    data: capped(result.result.data),
    ...(result.result.message ? { message: cut(result.result.message, TEXT_LIMIT).text } : {}),
    ...(result.duration_ms !== undefined ? { duration_ms: result.duration_ms } : {}),
  };
}

export function traceMessage(message: Message): TracedMessage {
  const { text, chars } = cut(message.text ?? "", TEXT_LIMIT);
  return {
    sender: message.sender,
    text,
    ...(chars !== undefined ? { text_chars: chars } : {}),
    ...(message.framework_context ? { framework_context: message.framework_context } : {}),
    ...(message.is_compaction ? { is_compaction: true as const } : {}),
    ...(message.is_compaction_request ? { is_compaction_request: true as const } : {}),
    ...(message.is_skill_injection ? { is_skill_injection: true as const } : {}),
    ...(message.content?.length ? { content: message.content.map(tracePart) } : {}),
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls.map(traceCall) } : {}),
    ...(message.tool_results?.length ? { tool_results: message.tool_results.map(traceResult) } : {}),
    ...(message.reasoning_content ? { reasoning_omitted: true as const } : {}),
  };
}

function traceTool(tool: ModelRequestTool): ModelRequestTool {
  const schema = capped(tool.input_schema, TOOL_SCHEMA_LIMIT);
  return {
    name: tool.name,
    description: cut(tool.description ?? "", TEXT_LIMIT).text,
    input_schema: (schema && typeof schema === "object" ? schema : {}) as Record<string, unknown>,
  };
}

interface Thread {
  readonly requestId: string;
  readonly hashes: ReadonlyArray<string>;
}

/** One per run: what this run has already recorded. */
export function requestTracer(): {
  request(data: SubscriberEventDataMap["model_request"]): TracedModelRequest;
  end(data: SubscriberEventDataMap["model_request_end"]): TracedModelRequestEnd;
} {
  const prompts = new Set<string>();
  const toolSets = new Set<string>();
  const threads = new Map<string, Thread>();
  // Persisted messages come back as the same objects between requests.
  const messageHashes = new WeakMap<Message, string>();
  const messageHash = (message: Message): string => {
    let value = messageHashes.get(message);
    if (!value) {
      value = hash(json(message));
      messageHashes.set(message, value);
    }
    return value;
  };

  return {
    request(data) {
      let contextStart = data.messages.length;
      while (contextStart > 0 && data.messages[contextStart - 1]!.framework_context === "runtime") contextStart--;
      const history = data.messages.slice(0, contextStart);
      const context = data.messages.slice(contextStart);

      const promptHash = hash(data.system_prompt);
      const firstPrompt = !prompts.has(promptHash);
      prompts.add(promptHash);

      const toolsHash = hash(json(data.tools.map((tool) => [tool.name, tool.description, tool.input_schema])));
      const firstTools = !toolSets.has(toolsHash);
      toolSets.add(toolsHash);

      const hashes = history.map(messageHash);
      const previous = threads.get(promptHash);
      let kept = 0;
      if (previous) {
        const limit = Math.min(previous.hashes.length, hashes.length);
        while (kept < limit && previous.hashes[kept] === hashes[kept]) kept++;
      }
      threads.set(promptHash, { requestId: data.request_id, hashes });

      // Newest messages first: when a request is too large, the oldest go unrecorded.
      const added: TracedMessage[] = [];
      let budget = MESSAGES_BUDGET;
      for (let index = history.length - 1; index >= kept; index--) {
        const traced = traceMessage(history[index]!);
        budget -= json(traced).length;
        if (budget < 0 && added.length) break;
        added.unshift(traced);
      }
      const skipped = history.length - kept - added.length;

      return {
        request_id: data.request_id,
        model: data.model,
        purpose: data.purpose,
        system_prompt: {
          hash: promptHash,
          chars: data.system_prompt.length,
          ...(firstPrompt ? { text: cut(data.system_prompt, SYSTEM_PROMPT_LIMIT).text } : {}),
        },
        tools: {
          hash: toolsHash,
          names: data.tools.map((tool) => tool.name),
          ...(firstTools ? { list: data.tools.map(traceTool) } : {}),
        },
        messages: {
          total: history.length,
          ...(previous && kept > 0 ? { base: previous.requestId } : {}),
          kept: previous && kept > 0 ? kept : 0,
          ...(skipped > 0 ? { skipped } : {}),
          added,
        },
        context: context.map(traceMessage),
      };
    },
    end(data) {
      return {
        request_id: data.request_id,
        model: data.model,
        duration_ms: data.duration_ms,
        status: data.status,
        ...(data.error ? { error: cut(data.error, TEXT_LIMIT).text } : {}),
        ...(data.messages ? { response: data.messages.map(traceMessage) } : {}),
        ...(data.tokens_in !== undefined ? { tokens_in: data.tokens_in } : {}),
        ...(data.tokens_out !== undefined ? { tokens_out: data.tokens_out } : {}),
        ...(data.cache_read_input_tokens !== undefined ? { cache_read_input_tokens: data.cache_read_input_tokens } : {}),
        ...(data.cache_creation_input_tokens !== undefined ? { cache_creation_input_tokens: data.cache_creation_input_tokens } : {}),
      };
    },
  };
}
