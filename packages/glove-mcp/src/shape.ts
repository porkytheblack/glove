/**
 * Render an MCP tool's declared `outputSchema` (a JSON Schema) into the compact
 * TS-like string Glove uses for result shapes — e.g.
 * `{ number: number, title: string, status: "open"|"closed" }[]`.
 *
 * This is the DECLARED counterpart to glove-scratchpad's `deriveShape`, which
 * infers the same string from a sampled runtime value. Keeping the two output
 * formats identical means the model sees ONE result-shape vocabulary whether the
 * server shipped an `outputSchema` (MCP 2025-06-18+) or we sampled a read call.
 *
 * Fidelity is deliberately bounded (matching the sampler): objects nested past a
 * few levels collapse to `object`, and shapeless / `$ref` nodes to `unknown` —
 * the point is a correct-on-first-try field list, not a faithful schema echo.
 */

const MAX_FIELDS = 24;
const MAX_DEPTH = 4;

/**
 * Compact TS-like rendering of a JSON Schema node. Returns `undefined` when the
 * node carries no usable shape information (so callers can skip it cleanly).
 */
export function jsonSchemaToShape(schema: unknown, depth = 0): string | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const s = schema as Record<string, unknown>;

  // const / enum → a literal or a union of literals.
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (Array.isArray(s.enum) && s.enum.length) {
    return s.enum.map((v) => JSON.stringify(v)).join("|");
  }

  // anyOf / oneOf → union of the variants' shapes (deduped, order-preserving).
  const variants = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  if (Array.isArray(variants) && variants.length) {
    const rendered = [
      ...new Set(
        variants
          .map((v) => jsonSchemaToShape(v, depth))
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    if (rendered.length) return rendered.join("|");
  }

  // `type` may be an array (e.g. ["string", "null"]) — take the first non-null.
  // Fall back to structural inference when `type` is absent.
  const rawType = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  const type = rawType ?? (s.properties ? "object" : s.items ? "array" : undefined);

  switch (type) {
    case "array":
      return `${jsonSchemaToShape(s.items, depth) ?? "unknown"}[]`;
    case "object": {
      if (depth >= MAX_DEPTH) return "object";
      const props = s.properties as Record<string, unknown> | undefined;
      if (!props || typeof props !== "object") return "object";
      const keys = Object.keys(props);
      if (!keys.length) return "object";
      const shown = keys.slice(0, MAX_FIELDS);
      const parts = shown.map(
        (k) => `${k}: ${jsonSchemaToShape(props[k], depth + 1) ?? "unknown"}`,
      );
      const more = keys.length > MAX_FIELDS ? ", …" : "";
      return `{ ${parts.join(", ")}${more} }`;
    }
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    default:
      return undefined;
  }
}
