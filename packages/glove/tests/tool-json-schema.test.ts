import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { getToolJsonSchema, type Tool } from "../src/core";
import { OpenAICompatAdapter } from "../src/models/openai-compat";

const tool: Tool<unknown> = {
  name: "manage_schedule", description: "Manage a schedule",
  input_schema: z.discriminatedUnion("action", [
    z.object({ action: z.literal("list") }),
    z.object({ action: z.literal("cancel"), activationId: z.string() }),
  ]),
  run: async () => ({ status: "success", data: null }),
};

test("OpenAI receives an object root without root unions while local branch validation stays intact", async () => {
  const original = globalThis.fetch;
  let parameters: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    parameters = JSON.parse(String(init?.body)).tools[0].function.parameters;
    assert.equal(parameters?.type, "object", "OpenAI requires an object root for function parameters");
    for (const forbidden of ["anyOf", "oneOf", "allOf", "enum", "const", "not"]) assert.equal(forbidden in parameters!, false);
    return new Response(JSON.stringify({ id: "test", choices: [{ message: { role: "assistant", content: "ready" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "content-type": "application/json" } });
  };
  try {
    const adapter = new OpenAICompatAdapter({ apiKey: "test-key", model: "test", stream: false });
    await adapter.prompt({ messages: [{ sender: "user", text: "List schedules" }], tools: [tool] }, async () => {});
    const originalSchema = z.toJSONSchema(tool.input_schema!);
    assert.deepEqual(getToolJsonSchema(tool), originalSchema, "other adapters keep the original schema");
    assert.deepEqual(parameters?.required, ["action"]);
    assert.deepEqual(parameters?.properties, {
      action: { anyOf: [{ type: "string", const: "list" }, { type: "string", const: "cancel" }] },
      activationId: { type: "string" },
    });
    assert.equal(tool.input_schema!.safeParse({ action: "cancel" }).success, false);
    assert.equal(tool.input_schema!.safeParse({ action: "cancel", activationId: "a" }).success, true);
  } finally { globalThis.fetch = original; }
});

test("schema normalization preserves supplied schemas and does not narrow mixed unions", () => {
  const objects = Object.freeze({ oneOf: [{ type: "object", required: ["a"] }, { type: "object", required: ["b"] }] });
  assert.deepEqual(getToolJsonSchema({ ...tool, jsonSchema: objects }, { objectRoot: true }), { type: "object", properties: {}, required: [] });
  assert.equal("type" in objects, false);
  const mixed = { anyOf: [{ type: "object" }, { type: "string" }] };
  assert.equal(getToolJsonSchema({ ...tool, jsonSchema: mixed }, { objectRoot: true }), mixed);
});

test("object-root normalization preserves common fields and root constraints", () => {
  const schema = {
    type: "object", properties: { tenantId: { type: "string" }, action: { type: "string", minLength: 1 } },
    required: ["tenantId"], additionalProperties: false,
    anyOf: [
      { type: "object", properties: { action: { const: "list" } }, required: ["action"] },
      { type: "object", properties: { action: { const: "cancel" }, id: { type: "string" } }, required: ["action", "id"] },
    ],
  };
  const original = structuredClone(schema);
  const normalized = getToolJsonSchema({ ...tool, jsonSchema: schema }, { objectRoot: true });
  assert.deepEqual(normalized.properties, {
    tenantId: { type: "string" },
    action: { allOf: [{ type: "string", minLength: 1 }, { anyOf: [{ const: "list" }, { const: "cancel" }] }] },
    id: { type: "string" },
  });
  assert.deepEqual(normalized.required, ["tenantId", "action"]);
  assert.equal(normalized.additionalProperties, false);
  assert.deepEqual(schema, original, "normalization never mutates a supplied schema");
  const additional = { type: "string" };
  assert.deepEqual(getToolJsonSchema({ ...tool, jsonSchema: {
    ...schema, additionalProperties: additional,
    anyOf: schema.anyOf.map((branch) => ({ ...branch, additionalProperties: false })),
  } }, { objectRoot: true }).additionalProperties, additional, "branch settings must not overwrite the root constraint");
});
