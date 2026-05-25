import z from "zod";
import type { GloveFoldArgs, ToolResultData } from "glove-core";
import type { ToolContext } from "./common";

const ListSchema = z.object({
  filter: z
    .object({
      capability: z
        .string()
        .optional()
        .describe("Only show agents whose capabilities[] contains this tag."),
      name_contains: z
        .string()
        .optional()
        .describe("Substring match on agent name (case-insensitive)."),
    })
    .optional(),
});

type ListInput = z.infer<typeof ListSchema>;

export function buildMeshListAgentsTool(
  ctx: ToolContext,
): GloveFoldArgs<ListInput> {
  return {
    name: "mesh_list_agents",
    description:
      "List other agents currently registered on the mesh network. " +
      "Returns each agent's id, name, description, and capabilities. " +
      "Optionally filter by capability tag or by case-insensitive substring of name.",
    inputSchema: ListSchema,
    async do(input: ListInput): Promise<ToolResultData> {
      const all = await ctx.adapter.listAgents();
      const cap = input.filter?.capability;
      const sub = input.filter?.name_contains?.toLowerCase();
      const filtered = all
        .filter((a) => a.id !== ctx.identity.id)
        .filter((a) => (cap ? (a.capabilities ?? []).includes(cap) : true))
        .filter((a) => (sub ? a.name.toLowerCase().includes(sub) : true))
        .map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          capabilities: a.capabilities ?? [],
        }));
      return {
        status: "success",
        data: { agents: filtered, count: filtered.length },
      };
    },
  };
}
