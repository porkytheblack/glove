/**
 * Bridge the package's `GloveFoldArgs` tools onto OpenAI-style function
 * schemas, and dispatch calls back into them.
 *
 * The tools are taken from `buildFormRunnerTools` verbatim — descriptions,
 * input schemas and all — because those descriptions are part of what's under
 * test. A bench that paraphrased them would be measuring the paraphrase.
 */
import { z } from "zod";
import type { FormRunner } from "glove-memory/forms";
import { buildFormRunnerTools } from "glove-memory";
import type { ToolSchema } from "./openrouter";

export interface BridgedTool {
  name: string;
  description: string;
  schema: ToolSchema;
  run(args: unknown): Promise<{ status: string; message?: string; data: unknown }>;
}

export function bridgeFormTools(runner: FormRunner): BridgedTool[] {
  return buildFormRunnerTools(runner).map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: toJsonSchema(tool.inputSchema),
      },
    },
    async run(args: unknown) {
      const result = await (tool.do as (input: unknown) => Promise<any>)(args);
      return {
        status: result?.status ?? "success",
        message: result?.message,
        data: result?.data,
      };
    },
  }));
}

/**
 * Providers vary in how much of JSON Schema they tolerate. Two normalisations
 * earn their keep across the model matrix:
 *
 * - `$schema` is stripped; several gateways reject a nested dialect marker.
 * - A property with no constraints at all (`z.unknown()` on
 *   `glove_form_revise.value`) becomes `{}`, which some validators treat as
 *   malformed. It's widened to an explicit "any JSON scalar or structure"
 *   rather than left empty.
 */
function toJsonSchema(schema: z.ZodType<any> | undefined): Record<string, unknown> {
  if (!schema) return { type: "object", properties: {}, additionalProperties: false };
  const json = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete json.$schema;
  return normalise(json) as Record<string, unknown>;
}

const ANY_JSON = {
  description: "Any JSON value — string, number, boolean, object or array.",
};

/**
 * Walk *schema positions only*. `properties` is a map of names to schemas, not
 * a schema — widening it because it happened to be empty would turn
 * `glove_form_list`'s no-argument input into an object with one bogus property
 * called `description`.
 */
function normalise(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(normalise);

  const obj = node as Record<string, unknown>;
  delete obj.$schema;
  if (Object.keys(obj).length === 0) return { ...ANY_JSON };

  if (obj.properties && typeof obj.properties === "object") {
    const props = obj.properties as Record<string, unknown>;
    for (const key of Object.keys(props)) props[key] = normalise(props[key]);
  }
  for (const key of ["items", "additionalProperties", "propertyNames", "not"]) {
    if (key in obj && typeof obj[key] === "object") obj[key] = normalise(obj[key]);
  }
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    if (Array.isArray(obj[key])) obj[key] = (obj[key] as unknown[]).map(normalise);
  }
  return obj;
}

/** Tool results reach the model as text; keep them bounded the way a host would. */
export function renderResult(result: {
  status: string;
  message?: string;
  data: unknown;
}): string {
  const body =
    typeof result.data === "string"
      ? result.data
      : result.data === null || result.data === undefined
        ? ""
        : JSON.stringify(result.data);
  if (result.status === "error") {
    return `ERROR: ${result.message ?? "failed"}${body ? `\n${body}` : ""}`;
  }
  return body || "ok";
}
