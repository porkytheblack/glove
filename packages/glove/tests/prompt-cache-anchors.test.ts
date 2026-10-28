import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyAnthropicPromptCache,
  applyOpenAICacheControl,
  formatAnthropicMessages,
  formatBedrockMessages,
  promptCacheAnchors,
  latestTurnIsPersisted,
  type Message,
} from "../src/index";

const cache = { enabled: true, ttl: "5m" as const };
const user = (text: string): Message => ({ sender: "user", text });
const runtime = (text: string): Message => ({ sender: "user", text, framework_context: "runtime", transient: true });
const toolTurn: Message[] = [
  { sender: "agent", text: "", tool_calls: [{ id: "t1", tool_name: "search", input_args: {} }] },
  { sender: "user", text: "tool results", tool_results: [{ tool_name: "search", call_id: "t1", result: { status: "success", data: "found" } }] },
];

test("anchors skip transient messages and cover the prefix before frozen context", () => {
  assert.deepEqual(promptCacheAnchors([user("a"), user("b")]), [1]);
  assert.deepEqual(promptCacheAnchors([user("a"), runtime("tail")]), [0]);
  assert.deepEqual(promptCacheAnchors([user("a"), runtime("frozen"), user("b"), ...toolTurn, runtime("tail")]), [0, 4]);
  assert.deepEqual(promptCacheAnchors([runtime("only")]), []);
});

test("Anthropic breakpoints land on the last persisted block, not on runtime context", () => {
  const messages = formatAnthropicMessages([user("Find flights"), ...toolTurn, runtime("GOALS: 1/3")], cache);
  const last = messages.at(-1)!;
  assert.ok(Array.isArray(last.content));
  const blocks = last.content as Array<Record<string, unknown>>;
  assert.equal(blocks[0].type, "tool_result");
  assert.ok(blocks[0].cache_control, "breakpoint on the tool result");
  assert.equal(blocks[1].text, "GOALS: 1/3");
  assert.equal(blocks[1].cache_control, undefined, "never on the transient snapshot");

  const params = applyAnthropicPromptCache({ model: "m", max_tokens: 1, system: "sys", messages }, cache);
  const marked = params.messages.flatMap((m) => Array.isArray(m.content) ? m.content : []).filter((b) => "cache_control" in b && b.cache_control);
  assert.equal(marked.length, 1, "the adapter's anchors replace the latest-turn fallback");
});

test("Anthropic adds a second breakpoint before request-frozen context", () => {
  const messages = formatAnthropicMessages([user("earlier"), { sender: "agent", text: "answer" }, runtime("frozen"), user("now")], cache);
  const marked = messages.flatMap((m) => Array.isArray(m.content) ? m.content : []).filter((b) => "cache_control" in b && b.cache_control);
  assert.equal(marked.length, 2);
  assert.equal((marked[0] as { text: string }).text, "answer");
  assert.equal((marked[1] as { text: string }).text, "now");
});

test("raw Anthropic params without anchors keep the latest-turn breakpoint", () => {
  const params = applyAnthropicPromptCache({ model: "m", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }, cache);
  assert.deepEqual(params.messages[0].content, [{ type: "text", text: "hi", cache_control: { type: "ephemeral", ttl: "5m" } }]);
});

test("Bedrock checkpoints follow the last persisted message", () => {
  const messages = formatBedrockMessages([user("Find flights"), ...toolTurn, runtime("GOALS")], cache);
  const content = messages.at(-1)!.content!;
  const point = content.findIndex((block) => "cachePoint" in block);
  assert.ok(point > 0);
  assert.ok("text" in content[point + 1] && content[point + 1].text === "GOALS", "checkpoint sits before the snapshot");
});

test("OpenAI-style latest-turn breakpoint is skipped when that turn is transient", () => {
  const formatted = [{ role: "system" as const, content: "sys" }, { role: "user" as const, content: "hi" }];
  const skipped = applyOpenAICacheControl(formatted, cache, "openrouter", false);
  assert.equal(typeof skipped[1].content, "string");
  const placed = applyOpenAICacheControl(formatted, cache, "openrouter");
  assert.ok(Array.isArray(placed[1].content));
});

test("the latest user turn counts as transient when request-frozen context merges into it", () => {
  assert.equal(latestTurnIsPersisted([user("a"), runtime("frozen"), user("now")]), false);
  assert.equal(latestTurnIsPersisted([user("a"), runtime("frozen"), user("now"), ...toolTurn]), true);
  assert.equal(latestTurnIsPersisted([user("a"), ...toolTurn, runtime("tail")]), false);
  assert.equal(latestTurnIsPersisted([user("a"), { sender: "agent", text: "ok" }, user("b")]), true);
});
