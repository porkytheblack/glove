import { z } from "zod";
import type { MemorySchema } from "../core/schema";

/**
 * Render the live schema as a markdown block for inclusion in tool
 * descriptions. Same idea as `renderSubAgentToolDescription` /
 * `renderSkillToolDescription` in glove-core's extensions module: the
 * model always sees the current ontology.
 */
export function renderSchemaBlock(schema: MemorySchema): string {
  const sections: string[] = [];

  if (schema.nodeClasses.size > 0) {
    sections.push("Node classes:");
    for (const [name, def] of schema.nodeClasses) {
      sections.push(`- ${name}${def.description ? ` — ${def.description}` : ""}`);
      sections.push(`    properties: ${describeZod(def.schema)}`);
      if (def.identityKeys && def.identityKeys.length > 0) {
        sections.push(
          `    identityKeys: ${def.identityKeys.map((set) => `[${set.join(", ")}]`).join(" | ")}`,
        );
      }
      if (def.searchableProperties && def.searchableProperties.length > 0) {
        sections.push(`    searchable: [${def.searchableProperties.join(", ")}]`);
      }
    }
  }

  if (schema.relationships.size > 0) {
    sections.push("");
    sections.push("Relationships:");
    for (const [type, def] of schema.relationships) {
      const propPart = def.propertiesSchema ? `, props: ${describeZod(def.propertiesSchema)}` : "";
      const multiPart = def.multi ? " (multi)" : "";
      sections.push(
        `- ${type}: ${def.from} -> ${def.to}${propPart}${multiPart}${def.description ? ` — ${def.description}` : ""}`,
      );
    }
  }

  if (schema.episodeKinds.size > 0) {
    sections.push("");
    sections.push("Episode kinds:");
    for (const [name, def] of schema.episodeKinds) {
      sections.push(`- ${name}${def.description ? ` — ${def.description}` : ""}`);
      if (def.propertiesSchema) {
        sections.push(`    properties: ${describeZod(def.propertiesSchema)}`);
      }
    }
  }

  return sections.join("\n");
}

/** Render only node classes + relationships (no episode kinds) for entity-tool descriptions. */
export function renderEntitySchemaBlock(schema: MemorySchema): string {
  const sections: string[] = [];
  if (schema.nodeClasses.size > 0) {
    sections.push("Node classes:");
    for (const [name, def] of schema.nodeClasses) {
      sections.push(`- ${name}${def.description ? ` — ${def.description}` : ""}`);
      sections.push(`    properties: ${describeZod(def.schema)}`);
      if (def.identityKeys && def.identityKeys.length > 0) {
        sections.push(
          `    identityKeys: ${def.identityKeys.map((set) => `[${set.join(", ")}]`).join(" | ")}`,
        );
      }
      if (def.searchableProperties && def.searchableProperties.length > 0) {
        sections.push(`    searchable: [${def.searchableProperties.join(", ")}]`);
      }
    }
  }
  if (schema.relationships.size > 0) {
    sections.push("");
    sections.push("Relationships:");
    for (const [type, def] of schema.relationships) {
      const propPart = def.propertiesSchema ? `, props: ${describeZod(def.propertiesSchema)}` : "";
      const multiPart = def.multi ? " (multi)" : "";
      sections.push(
        `- ${type}: ${def.from} -> ${def.to}${propPart}${multiPart}${def.description ? ` — ${def.description}` : ""}`,
      );
    }
  }
  return sections.join("\n");
}

/** Render only episode kinds for episodic-tool descriptions. */
export function renderEpisodeKindsBlock(schema: MemorySchema): string {
  if (schema.episodeKinds.size === 0) return "(no episode kinds registered)";
  const lines: string[] = ["Episode kinds:"];
  for (const [name, def] of schema.episodeKinds) {
    lines.push(`- ${name}${def.description ? ` — ${def.description}` : ""}`);
    if (def.propertiesSchema) {
      lines.push(`    properties: ${describeZod(def.propertiesSchema)}`);
    }
  }
  return lines.join("\n");
}

/** Best-effort short description of a Zod schema's top-level shape. */
function describeZod(schema: z.ZodType<unknown>): string {
  try {
    const json = z.toJSONSchema(schema) as { properties?: Record<string, { type?: string }>; required?: string[] };
    if (!json.properties) return "{}";
    const required = new Set(json.required ?? []);
    const parts = Object.entries(json.properties).map(([key, val]) => {
      const t = val.type ?? "any";
      return `${key}${required.has(key) ? "" : "?"}: ${t}`;
    });
    return `{ ${parts.join(", ")} }`;
  } catch {
    return "{ ... }";
  }
}
