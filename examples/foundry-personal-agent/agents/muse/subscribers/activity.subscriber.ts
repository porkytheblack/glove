import { defineSubscriber } from "glove-foundry";
import { logActivity } from "../../../lib/activity.js";

/**
 * Writes Muse's log from Foundry's side of the run: every tool it calls and
 * how it ended. The model cannot leave an entry out, because it never writes
 * them. Inputs are cut short; secrets never pass through a tool, so there are
 * none to leak here. Memory tools are logged without their input: a fact the
 * person asks Muse to forget must not stay behind in the log.
 */
export default defineSubscriber({
  description: "Muse's log of everything it does",
  create: ({ workspaceId }) => {
    const inputs = new Map<string, unknown>();
    return {
      async record(type, data) {
        if (type === "tool_use") {
          const call = data as { readonly id: string; readonly input: unknown };
          inputs.set(call.id, call.input);
          return;
        }
        if (type !== "tool_use_result") return;
        const result = data as { readonly tool_name: string; readonly call_id?: string; readonly result: { readonly status: string; readonly message?: string } };
        const input = result.call_id ? inputs.get(result.call_id) : undefined;
        if (result.call_id) inputs.delete(result.call_id);
        // A failure says why; a success says what it was asked to do. Memory only says it changed.
        const detail = result.tool_name.startsWith("glove_context_")
          ? result.result.status === "error" ? "memory unchanged" : "memory changed"
          : result.result.status === "error" ? result.result.message : input !== undefined ? JSON.stringify(input) : undefined;
        await logActivity({
          person: workspaceId,
          kind: "tool",
          what: result.tool_name,
          outcome: result.result.status,
          ...(detail ? { detail: detail.slice(0, 300) } : {}),
        });
      },
    };
  },
});
