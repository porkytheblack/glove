import type { IGloveRunnable, ToolResultData } from "glove-core";
import { installedApplicationTransmissionToolName, type AgentAssemblyContext } from "glove-foundry";
import { blockedBecause, strictlyBlocked } from "../../lib/guard.js";
import { aroundTool } from "../../lib/tool-policy.js";
import gmailApp from "./apps/gmail.app.js";
import gmail from "./transmissions/gmail.transmission.js";

interface Send { readonly routeId: string; readonly payload: { readonly to?: string; readonly subject?: string; readonly body?: string } }

const textOf = ({ payload }: Send) => `${payload.subject ?? ""}\n${payload.body ?? ""}`;

/**
 * The Gmail app's send, behind the partner's guard. Foundry still delivers it
 * in its own process with the account's session; the partner decides whether
 * to ask. Card and government ID numbers never leave, so a message carrying
 * one is refused without asking. Health and money details leave only when
 * the person's own message asked for them, which only the agent can see.
 */
export function guardSends(agent: IGloveRunnable, ctx: Pick<AgentAssemblyContext, "request" | "messageText">): void {
  aroundTool(agent, installedApplicationTransmissionToolName(gmailApp, gmail), (send) => ({
    name: send.name,
    description: `${send.description} Never include card or government ID numbers.`,
    jsonSchema: send.jsonSchema,
    // A message the guard will refuse is not worth asking about.
    requiresPermission: (input: Send) => !strictlyBlocked(textOf(input)),
    async do(input: Send, _display, _glove, signal): Promise<ToolResultData> {
      const reason = await blockedBecause(textOf(input), ctx.request.source?.kind === "direct" ? ctx.messageText : undefined);
      if (reason) {
        return { status: "error", data: null, message: `Blocked: ${reason}. Tell the person you will not send it, and why.` };
      }
      return send.run(input, signal);
    },
  }));
}
