import { z } from "zod";
import type { MemorySchema, NodeClassDef, RelationshipDef } from "../../core/schema";

/**
 * Render the live schema slice into a string fragment for tool descriptions.
 * Tool descriptions render the live schema so the model always sees the
 * current ontology. Same pattern as `renderSubAgentToolDescription` in
 * glove-core.
 */
export function renderEntitySchemaSection(schema: MemorySchema): string {
  const classes = schema.listNodeClasses();
  const relationships = schema.listRelationships();

  const lines: string[] = [];

  if (classes.length === 0) {
    lines.push("No node classes registered.");
  } else {
    lines.push("Node classes:");
    for (const cls of classes) {
      lines.push(formatNodeClass(cls));
    }
  }

  if (relationships.length > 0) {
    lines.push("");
    lines.push("Relationships:");
    for (const rel of relationships) {
      lines.push(formatRelationship(rel));
    }
  }

  return lines.join("\n");
}

function formatNodeClass(cls: NodeClassDef<any>): string {
  const props = describeZodObject(cls.schema);
  const idKeys = (cls.identityKeys ?? []).map((k) => `[${k.join(", ")}]`).join(" | ");
  const searchable = cls.searchableProperties?.join(", ");
  const parts = [`- ${cls.name}`];
  if (props) parts.push(`  props: ${props}`);
  if (idKeys) parts.push(`  identityKeys: ${idKeys}`);
  if (searchable) parts.push(`  searchableProperties: ${searchable}`);
  return parts.join("\n");
}

function formatRelationship(rel: RelationshipDef<any>): string {
  const propStr = rel.propertiesSchema ? describeZodObject(rel.propertiesSchema) : "";
  const tag = rel.multi ? " (multi)" : "";
  const out = [`- ${rel.type}: ${rel.from} -> ${rel.to}${tag}`];
  if (propStr) out.push(`  edgeProps: ${propStr}`);
  return out.join("\n");
}

/**
 * Best-effort description of a zod object schema's shape. Outputs
 * `{ name: string, email?: string }` style snippets for the agent.
 *
 * Falls back gracefully for schemas that aren't ZodObject (or for zod
 * internals we don't recognise) — the tool description is guidance, not
 * a contract.
 */
function describeZodObject<T>(schema: z.ZodType<T>): string {
  // zod 4: use the public introspection helpers if available.
  const def = (schema as { _def?: { typeName?: string; shape?: () => Record<string, z.ZodType<any>> } })._def;
  if (!def) return "";
  if (typeof def.shape === "function") {
    const shape = def.shape();
    const parts: string[] = [];
    for (const [key, sub] of Object.entries(shape)) {
      const optional = isOptional(sub);
      parts.push(`${key}${optional ? "?" : ""}: ${describeZodScalar(sub)}`);
    }
    return `{ ${parts.join(", ")} }`;
  }
  return describeZodScalar(schema);
}

function isOptional(schema: z.ZodType<any>): boolean {
  const def = (schema as { _def?: { typeName?: string; innerType?: z.ZodType<any> } })._def;
  if (!def) return false;
  if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault" || def.typeName === "ZodNullable") {
    return true;
  }
  return false;
}

function describeZodScalar(schema: z.ZodType<any>): string {
  const def = (schema as { _def?: { typeName?: string; innerType?: z.ZodType<any>; values?: unknown[] } })._def;
  if (!def) return "any";
  switch (def.typeName) {
    case "ZodString": return "string";
    case "ZodNumber": return "number";
    case "ZodBoolean": return "boolean";
    case "ZodDate": return "date";
    case "ZodEnum": return def.values ? `enum(${def.values.map((v) => JSON.stringify(v)).join(" | ")})` : "enum";
    case "ZodArray": return "array";
    case "ZodObject": return "object";
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return def.innerType ? describeZodScalar(def.innerType) : "any";
    default:
      return def.typeName?.replace(/^Zod/, "").toLowerCase() ?? "any";
  }
}
