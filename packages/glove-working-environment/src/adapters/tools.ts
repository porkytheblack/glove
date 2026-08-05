/**
 * `defineTools` — mount capabilities as an `env:` module.
 *
 * The fourth route, and the one that makes this environment a place to
 * *compose* rather than only to compute. An MCP server, a Glove tool, or a
 * hand-written function all reduce to the same shape: a name, a description,
 * an input schema, and an async call. Given a list of those, scripts get a
 * module they can import.
 *
 * ```js
 * import { list_pull_requests } from 'env:github';
 * import { slides } from 'env:slides';
 *
 * export default async function () {
 *   const merged = await list_pull_requests({ state: 'merged', since: '2026-08-01' });
 *   await slides.create({ slides: merged.map(pr => ({ title: pr.title })) }, '/out/week.pptx');
 * }
 * ```
 *
 * ## Why this is different from calling the tool directly
 *
 * A tool call puts its whole result in the context window. A tool call *from a
 * script* puts the result in a variable. Two hundred pull requests, a
 * thousand emails, a year of calendar events — the model writes the loop that
 * reduces them and only the answer comes back. That is the same
 * context-window discipline the rest of this environment is built on, applied
 * to capabilities instead of files.
 *
 * And because the result lands next to `env:documents` and `env:slides`, the
 * shape of the work changes: "a PDF of my emails" stops being two systems and
 * becomes one script.
 *
 * ## The contract is structural
 *
 * {@link ToolFn} is deliberately a structural interface rather than an import.
 * `glove-scratchpad/fns` produces exactly this shape from `defineFn`,
 * `fnFromTool` and `fnsFromMcp`, so those work directly — but this package
 * keeps its zero dependencies and anything matching the shape qualifies.
 */
import { defineAdapter } from "./define";
import type { EnvFsHandle, StdlibAdapter } from "../types";

/** Context handed to a capability on each call. */
export interface ToolFnContext {
  signal?: AbortSignal;
  actor?: string;
}

/**
 * A capability as a plain async function.
 *
 * Structurally identical to `glove-scratchpad/fns`' `ToolFn`, so the catalog
 * builders there (`defineFn`, `fnFromTool`, `fnsFromMcp`) can be passed
 * straight in.
 */
export interface ToolFn {
  /** Callable name. Must be a valid JS identifier — it is bound as one. */
  name: string;
  description?: string;
  /** JSON Schema for the argument object. Absent means "any object". */
  inputSchema?: Record<string, unknown>;
  /** A TS-like sketch of what a call returns, when known. */
  resultShape?: string;
  /** Origin server, e.g. `github`. Used to group the generated docs. */
  server?: string;
  serverDescription?: string;
  readOnlyHint?: boolean;
  /** Fire it. Returns plain data; throws on failure. */
  call(args: Record<string, unknown>, ctx?: ToolFnContext): Promise<unknown>;
}

export interface DefineToolsSpec {
  /** Module name: `"github"` → `import { … } from 'env:github'`. */
  name: string;
  /** One-liner for `ls /std` and the tool description. */
  description?: string;
  /** The capabilities to expose. */
  fns: ToolFn[];
  /**
   * Extra prose appended to the generated `/std/<name>/README.md`.
   *
   * The generated part already carries the import line and every signature;
   * this is for the things only the host knows — which account the tokens
   * belong to, what "recent" means for this server, what not to call twice.
   */
  docs?: string;
  skills?: Array<{ name: string; summary: string; body: string }>;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Expose a list of capabilities as `env:<name>`.
 *
 * Every function is async — these cross a thread and usually a network, which
 * is the one shape where async is right and a missing `await` is loud rather
 * than silent.
 */
export function defineTools(spec: DefineToolsSpec): StdlibAdapter {
  if (!Array.isArray(spec.fns) || spec.fns.length === 0) {
    throw new TypeError(`defineTools("${spec.name}"): fns must be a non-empty array`);
  }

  const seen = new Set<string>();
  for (const fn of spec.fns) {
    if (!fn || typeof fn.call !== "function") {
      throw new TypeError(`defineTools("${spec.name}"): every fn needs a call(args) function`);
    }
    if (!IDENT.test(fn.name)) {
      // MCP names arrive as `server__tool`, which is already a valid
      // identifier. Anything with a dash or a dot is not, and would bind to
      // nothing — better to fail here than to produce a module whose exports
      // cannot be imported.
      throw new TypeError(
        `defineTools("${spec.name}"): "${fn.name}" is not a valid identifier, so a script could not import it. ` +
          `Rename it (letters, digits and _ only, not starting with a digit).`,
      );
    }
    if (seen.has(fn.name)) {
      throw new TypeError(`defineTools("${spec.name}"): duplicate function name "${fn.name}"`);
    }
    seen.add(fn.name);
  }

  // Fall back to naming the origin server when the fns carry one — an MCP
  // catalogue describes itself, so the host should not have to repeat it.
  const server = spec.fns.find((f) => f.serverDescription)?.serverDescription;
  const description =
    spec.description ??
    server ??
    `${spec.fns.length} ${spec.fns.length === 1 ? "capability" : "capabilities"} callable from scripts.`;

  return defineAdapter({
    name: spec.name,
    description,
    types: generateTypes(spec),
    docs: generateDocs(spec),
    ...(spec.skills ? { skills: spec.skills } : {}),
    create(_vfs: EnvFsHandle, ctx?: { readOnly: boolean }) {
      const bindings: Record<string, unknown> = {};
      for (const fn of spec.fns) {
        bindings[fn.name] = async (args?: Record<string, unknown>) => {
          // Write-time validation executes a script's top level with a
          // read-only environment. A capability is not a filesystem write,
          // but it is usually a network call with a real effect on the other
          // side, and validating a script must never send an email.
          if (ctx?.readOnly) {
            throw new Error(
              `env:${spec.name}.${fn.name} is not callable while a script is being validated — ` +
                `move the call inside the default export instead of running it at module top level.`,
            );
          }
          return await fn.call(args ?? {});
        };
      }
      return bindings;
    },
  });
}

/** `{ type: "string" }` → `string`, recursively, for the generated `.d.ts`. */
function tsType(schema: unknown, depth = 0): string {
  if (!schema || typeof schema !== "object" || depth > 4) return "any";
  const s = schema as Record<string, unknown>;

  if (Array.isArray(s.enum)) {
    return s.enum.map((v) => (typeof v === "string" ? JSON.stringify(v) : String(v))).join(" | ") || "any";
  }
  if (Array.isArray(s.anyOf)) return s.anyOf.map((v) => tsType(v, depth + 1)).join(" | ");
  if (Array.isArray(s.oneOf)) return s.oneOf.map((v) => tsType(v, depth + 1)).join(" | ");

  switch (s.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `${tsType(s.items, depth + 1)}[]`;
    case "object": {
      const props = s.properties as Record<string, unknown> | undefined;
      if (!props || Object.keys(props).length === 0) return "Record<string, any>";
      const required = new Set((Array.isArray(s.required) ? s.required : []) as string[]);
      const fields = Object.entries(props).map(
        ([key, value]) => `${IDENT.test(key) ? key : JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${tsType(value, depth + 1)}`,
      );
      return `{ ${fields.join("; ")} }`;
    }
    default:
      return "any";
  }
}

function signature(fn: ToolFn): string {
  const schema = fn.inputSchema;
  const props = (schema?.properties ?? {}) as Record<string, unknown>;
  const hasArgs = Object.keys(props).length > 0;
  const argType = hasArgs ? tsType(schema) : "Record<string, any>";
  // No declared properties means the schema says nothing useful, so the
  // argument is optional rather than a required empty object.
  const arg = hasArgs ? `args: ${argType}` : `args?: ${argType}`;
  const ret = fn.resultShape ? `Promise<${fn.resultShape}>` : "Promise<any>";
  return `export function ${fn.name}(${arg}): ${ret};`;
}

function generateTypes(spec: DefineToolsSpec): string {
  const blocks = spec.fns.map((fn) => {
    const doc = [fn.description, fn.readOnlyHint === false ? "Has side effects." : undefined]
      .filter(Boolean)
      .join(" ");
    return `${doc ? `/** ${doc.replace(/\*\//g, "*\\/")} */\n` : ""}${signature(fn)}`;
  });
  return (
    `/**\n` +
    ` * env:${spec.name} — ${spec.description ?? "capabilities"}\n` +
    ` *\n` +
    ` * Every function here is ASYNC: it crosses a thread and usually a\n` +
    ` * network. Always await. The result is plain data — a failure throws\n` +
    ` * rather than returning an error object.\n` +
    ` */\n\n` +
    blocks.join("\n\n") +
    `\n`
  );
}

function generateDocs(spec: DefineToolsSpec): string {
  const names = spec.fns.map((f) => f.name);
  const sample = spec.fns[0];
  const lines: string[] = [
    `# env:${spec.name}`,
    ``,
    spec.description ?? "",
    ``,
    "```js",
    `import { ${names.slice(0, 3).join(", ")} } from 'env:${spec.name}';`,
    "```",
    ``,
    `**Everything here is async — always \`await\`.** A call returns plain data;`,
    `a failure throws, so you do not have to check a status field.`,
    ``,
    `## Why call these from a script`,
    ``,
    `The result lands in a variable, not in your context window. Fetch two`,
    `hundred records, reduce them in the same script, and return the answer —`,
    `that is the difference between a report you can build and one that does`,
    `not fit. It also means the data is already beside \`env:documents\` and`,
    `friends, so producing a file from it is the same script.`,
    ``,
    `## Available`,
    ``,
  ];

  for (const fn of spec.fns) {
    lines.push(`- \`${fn.name}(…)\`${fn.description ? ` — ${fn.description}` : ""}`);
  }

  if (sample) {
    lines.push(
      ``,
      `## Shape of a call`,
      ``,
      "```js",
      `const result = await ${sample.name}(${sampleArgs(sample)});`,
      "```",
      ``,
      `Exact argument types are in \`/std/${spec.name}/index.d.ts\`.`,
    );
  }

  if (spec.docs) lines.push(``, spec.docs);
  return lines.join("\n") + "\n";
}

/** A plausible call from the schema, so the first example is concrete. */
function sampleArgs(fn: ToolFn): string {
  const props = (fn.inputSchema?.properties ?? {}) as Record<string, unknown>;
  const required = (Array.isArray(fn.inputSchema?.required) ? fn.inputSchema.required : []) as string[];
  const keys = (required.length > 0 ? required : Object.keys(props)).slice(0, 2);
  if (keys.length === 0) return "";
  const pairs = keys.map((key) => {
    const t = (props[key] as Record<string, unknown> | undefined)?.type;
    const value = t === "number" || t === "integer" ? "1" : t === "boolean" ? "true" : `'…'`;
    return `${key}: ${value}`;
  });
  return `{ ${pairs.join(", ")} }`;
}
