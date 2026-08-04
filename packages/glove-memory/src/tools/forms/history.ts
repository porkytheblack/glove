import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { FormAdapter } from "../../forms/adapter";
import { evaluateForm } from "../../forms/evaluate";
import { inForce } from "../../forms/history";
import { projectView } from "../../forms/project";
import type { FormRegistry } from "../../forms/registry";
import type { FormInstance } from "../../forms/types";
import { errorResult, renderView } from "./shared";

const HistoryInputSchema = z.object({
  form: z.string().optional().describe("Restrict to one form id."),
  subject: z
    .string()
    .optional()
    .describe("Whose forms to read. Defaults to the current conversation."),
  status: z
    .enum(["active", "awaiting", "complete", "abandoned", "stale"])
    .optional(),
  instance_id: z
    .string()
    .optional()
    .describe("Read one instance in full instead of listing."),
  limit: z.number().int().min(1).max(50).default(10),
});

export type FormHistoryInput = z.infer<typeof HistoryInputSchema>;

export interface FormReaderOptions {
  /** Present: answers are projected through the def. Absent: raw entries only. */
  registry?: FormRegistry;
  subject?: string | (() => string);
}

/**
 * Read past fills. No writes, no executors, no rising edges — the reader
 * registration exists for agents that need to know what was already collected
 * without being the one collecting it.
 */
export function buildFormHistoryTool(
  adapter: FormAdapter,
  options: FormReaderOptions = {},
): GloveFoldArgs<FormHistoryInput> {
  const subjectOf = (override?: string): string | undefined => {
    if (override) return override;
    const s = options.subject;
    if (s === undefined) return undefined;
    return typeof s === "function" ? s() : s;
  };

  return {
    name: "glove_form_history",
    description:
      "Read forms that were filled in earlier — what was collected, when, and whether it finished. " +
      "Pass instance_id to read one in full, or leave it off to list recent ones. Read-only.",
    inputSchema: HistoryInputSchema,
    async do(input) {
      try {
        if (input.instance_id) {
          const instance = await adapter.getInstance(input.instance_id);
          if (!instance) {
            return {
              status: "error",
              message: `No form instance "${input.instance_id}".`,
              data: { code: "not_found" },
            };
          }
          return { status: "success", data: await renderInstance(instance, options) };
        }

        const instances = await adapter.findInstances({
          subject: subjectOf(input.subject),
          defId: input.form,
          status: input.status,
          limit: input.limit,
        });
        return {
          status: "success",
          data: {
            instances: instances.map((i) => ({
              instance_id: i.id,
              form: i.defId,
              status: i.status,
              answered: Object.keys(i.entries).length,
              updated_at: i.updatedAt,
              ...(i.closedReason ? { closed_reason: i.closedReason } : {}),
            })),
          },
        };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}

async function renderInstance(
  instance: FormInstance,
  options: FormReaderOptions,
): Promise<Record<string, unknown>> {
  if (options.registry?.has(instance.defId)) {
    const compiled = await options.registry.load(instance.defId);
    const ev = evaluateForm(compiled, instance);
    return {
      ...renderView(projectView(compiled, instance, { scope: "outline" }, ev)),
      values: ev.values,
      held: ev.held,
    };
  }
  // No registry wired: hand back what was stored, unprojected. Better than
  // refusing — the answers are the point, and the labels are a nicety.
  const values: Record<string, unknown> = {};
  for (const [id, log] of Object.entries(instance.entries)) {
    const entry = inForce(log);
    if (entry) values[id] = entry.value;
  }
  return {
    instance_id: instance.id,
    form: instance.defId,
    status: instance.status,
    values,
    updated_at: instance.updatedAt,
  };
}
