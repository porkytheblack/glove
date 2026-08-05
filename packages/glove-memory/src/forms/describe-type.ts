import { z } from "zod";

/**
 * Renders a zod schema to the short human string the agent sees as
 * `FormFieldView.type` — "email address", "one of: vehicle | premises",
 * "integer >= 1".
 *
 * There is no field-type vocabulary in this package. The zod schema is the
 * type, the constraint, the validator and the description; this function is
 * the only thing that turns it into prose, and it goes through
 * `z.toJSONSchema` so it never has to know about zod's internals.
 */
export function describeType(schema: z.ZodTypeAny): string {
  let json: unknown;
  try {
    json = z.toJSONSchema(schema as z.ZodType, {
      io: "input",
      unrepresentable: "any",
    });
  } catch {
    return "value";
  }
  return describeJsonSchema(json);
}

/** The rendering half, exposed for adapters that already hold a JSON Schema. */
export function describeJsonSchema(json: unknown): string {
  const rendered = render(json, 0);
  return rendered || "value";
}

// Zod emits the JS safe-integer bounds on `z.number().int()`. They carry no
// information the agent can act on, so they're stripped before rendering.
const SAFE_MAX = Number.MAX_SAFE_INTEGER;
const SAFE_MIN = Number.MIN_SAFE_INTEGER;

const STRING_FORMATS: Record<string, string> = {
  email: "email address",
  date: "date (YYYY-MM-DD)",
  "date-time": "timestamp (ISO 8601)",
  time: "time (HH:MM:SS)",
  duration: "duration (ISO 8601)",
  uri: "URL",
  url: "URL",
  uuid: "uuid",
  ipv4: "IPv4 address",
  ipv6: "IPv6 address",
};

function render(node: unknown, depth: number): string {
  if (node === true) return "value";
  if (!node || typeof node !== "object") return "value";
  const js = node as Record<string, any>;

  if (Array.isArray(js.enum) && js.enum.length > 0) {
    return `one of: ${js.enum.map(literal).join(" | ")}`;
  }
  if (js.const !== undefined) return `exactly ${literal(js.const)}`;

  const branches: unknown[] | undefined = js.anyOf ?? js.oneOf;
  if (Array.isArray(branches) && branches.length > 0) {
    const nullable = branches.some(
      (b) => b && typeof b === "object" && (b as any).type === "null",
    );
    const rest = branches.filter(
      (b) => !(b && typeof b === "object" && (b as any).type === "null"),
    );
    if (rest.length === 0) return "empty";
    const body = rest.map((b) => render(b, depth + 1)).join(" or ");
    return nullable ? `${body} (may be empty)` : body;
  }

  switch (js.type) {
    case "string":
      return renderString(js);
    case "integer":
      return withRange("integer", js);
    case "number":
      return withRange("number", js);
    case "boolean":
      // Not "yes / no". An agentic eval had models send the literal string
      // "yes" for 49% of writes to a boolean field, then loop when it was
      // rejected — the type string was telling them to. Name the JSON
      // literals the schema actually accepts.
      return "true or false";
    case "null":
      return "empty";
    case "array":
      return renderArray(js, depth);
    case "object":
      return renderObject(js, depth);
    default:
      return "value";
  }
}

function renderString(js: Record<string, any>): string {
  const format = typeof js.format === "string" ? STRING_FORMATS[js.format] : undefined;
  if (format) return format;

  const min = typeof js.minLength === "number" ? js.minLength : undefined;
  const max = typeof js.maxLength === "number" ? js.maxLength : undefined;
  if (min !== undefined && max !== undefined) return `text (${min}–${max} chars)`;
  if (min !== undefined) return `text (min ${min} chars)`;
  if (max !== undefined) return `text (max ${max} chars)`;
  if (typeof js.format === "string") return `text (${js.format})`;
  return "text";
}

function withRange(base: string, js: Record<string, any>): string {
  const min = bound(js.minimum, js.exclusiveMinimum, "min");
  const max = bound(js.maximum, js.exclusiveMaximum, "max");
  if (min !== undefined && max !== undefined) return `${base} between ${min.value} and ${max.value}`;
  if (min !== undefined) return `${base} ${min.exclusive ? ">" : ">="} ${min.value}`;
  if (max !== undefined) return `${base} ${max.exclusive ? "<" : "<="} ${max.value}`;
  return base;
}

function bound(
  inclusive: unknown,
  exclusive: unknown,
  which: "min" | "max",
): { value: number; exclusive: boolean } | undefined {
  const uninformative = (n: number) => (which === "min" ? n === SAFE_MIN : n === SAFE_MAX);
  if (typeof exclusive === "number" && !uninformative(exclusive)) {
    return { value: exclusive, exclusive: true };
  }
  if (typeof inclusive === "number" && !uninformative(inclusive)) {
    return { value: inclusive, exclusive: false };
  }
  return undefined;
}

function renderArray(js: Record<string, any>, depth: number): string {
  const items = js.items !== undefined && depth < 3 ? render(js.items, depth + 1) : "value";
  const base = `list of ${items}`;
  const min = typeof js.minItems === "number" ? js.minItems : undefined;
  const max = typeof js.maxItems === "number" ? js.maxItems : undefined;
  if (min !== undefined && max !== undefined) return `${base} (${min}–${max})`;
  if (min) return `${base} (at least ${min})`;
  if (max !== undefined) return `${base} (at most ${max})`;
  return base;
}

function renderObject(js: Record<string, any>, depth: number): string {
  const props = js.properties && typeof js.properties === "object" ? js.properties : undefined;
  if (!props || depth >= 2) return "object";
  const keys = Object.keys(props);
  if (keys.length === 0) return "object";
  const shown = keys.slice(0, 6).join(", ");
  return keys.length > 6
    ? `object with: ${shown}, …`
    : `object with: ${shown}`;
}

function literal(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}
