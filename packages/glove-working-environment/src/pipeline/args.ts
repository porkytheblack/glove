/**
 * What a script says its arguments are, read back from its own JSDoc.
 *
 * The generated `.d.ts` already carries this — it is the whole point of the
 * JSDoc block — but nothing ever compared it to what a run was given. A model
 * calling a script it wrote five turns ago with `{ file: … }` where it
 * expects `{ input, format }` fails deep inside with `Cannot read properties
 * of undefined`, naming neither the parameter nor the file that documents it.
 *
 * This is deliberately **not** a schema engine. It compares key names, and it
 * is advisory: types are not checked, extra keys are reported but allowed,
 * and the run happens either way. A script whose JSDoc is out of date should
 * not be unrunnable — the JSDoc is documentation, not a contract, and
 * enforcing it would make a stale comment a hard failure.
 */
import { jsDocForDefaultExport, type JsDocInfo } from "./jsdoc";
import { indexOfTopLevel, splitTopLevel } from "./dts";

export interface DeclaredArgs {
  required: string[];
  optional: string[];
  /** How the shape reads, for the message. */
  shape: string;
}

/**
 * The argument keys a script's JSDoc declares, or null when it declares none
 * — no JSDoc, no `@param`, or a parameter typed too loosely to check
 * (`any`, `object`, a named type this package cannot resolve).
 */
export function declaredArgs(source: string): DeclaredArgs | null {
  const doc = jsDocForDefaultExport(source);
  if (!doc) return null;
  return fromDotted(doc) ?? fromInlineObject(doc);
}

/** `@param {string} args.input` / `@param {string} [args.format]` */
function fromDotted(doc: JsDocInfo): DeclaredArgs | null {
  const dotted = doc.params.filter((p) => p.name.split(".").length === 2);
  if (dotted.length === 0) return null;
  const required: string[] = [];
  const optional: string[] = [];
  const parts: string[] = [];
  for (const p of dotted) {
    const key = p.name.split(".")[1];
    (p.optional ? optional : required).push(key);
    parts.push(`${key}${p.optional ? "?" : ""}: ${p.type ?? "any"}`);
  }
  return { required, optional, shape: `{ ${parts.join(", ")} }` };
}

/** `@param {{ input: string, format?: string }} args` */
function fromInlineObject(doc: JsDocInfo): DeclaredArgs | null {
  const root = doc.params.find((p) => !p.name.includes("."));
  const type = root?.type?.trim();
  if (!type || !type.startsWith("{") || !type.endsWith("}")) return null;

  const required: string[] = [];
  const optional: string[] = [];
  // `,` and `;` are both legal separators in a JSDoc inline object type.
  for (const field of splitTopLevel(type.slice(1, -1), ",;")) {
    const colon = indexOfTopLevel(field, ":");
    if (colon === -1) continue;
    const rawKey = field.slice(0, colon).trim();
    const isOptional = rawKey.endsWith("?");
    const key = (isOptional ? rawKey.slice(0, -1) : rawKey).trim().replace(/^["']|["']$/g, "");
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) continue;
    (isOptional ? optional : required).push(key);
  }
  if (required.length === 0 && optional.length === 0) return null;
  return { required, optional, shape: type };
}

/**
 * The advisory line, or null when the args look right.
 *
 * Reported for a missing required key or an unrecognised one. A key that is
 * merely misspelled shows up as both, which is exactly the useful case: the
 * message then names what was expected and what arrived.
 */
export function argMismatch(declared: DeclaredArgs, args: unknown): string | null {
  // Anything that is not a plain object was never keyed, so there is nothing
  // to compare — and a script taking a bare string is a legitimate shape the
  // JSDoc route simply cannot describe.
  if (args === null || typeof args !== "object" || Array.isArray(args)) return null;

  const given = Object.keys(args as Record<string, unknown>);
  const known = new Set([...declared.required, ...declared.optional]);
  const missing = declared.required.filter((k) => !given.includes(k));
  const unknownKeys = given.filter((k) => !known.has(k));
  if (missing.length === 0 && unknownKeys.length === 0) return null;

  const problems: string[] = [];
  if (missing.length > 0) problems.push(`missing ${missing.map((k) => `\`${k}\``).join(", ")}`);
  if (unknownKeys.length > 0) problems.push(`unexpected ${unknownKeys.map((k) => `\`${k}\``).join(", ")}`);
  return (
    `note: this script's JSDoc declares args ${declared.shape}; got ${given.length === 0 ? "{}" : `{ ${given.join(", ")} }`} ` +
    `(${problems.join("; ")}). Ran it anyway — if the result below is wrong, that is probably why.`
  );
}
