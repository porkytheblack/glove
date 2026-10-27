import type { FoundryApproval } from "glove-foundry";
import type { ApprovalView } from "../shared";
import { foundry, type Foundry } from "./foundry";

// Approvals are one global list in Foundry. A person sees the pending ones in
// their workspace, each with the tool's name and only the input fields they
// need to decide: who an email goes to, its subject and body, an issue's
// title. Nothing else of the input is sent.

const FIELDS = ["to", "cc", "subject", "title", "app", "site", "url", "name", "why", "description"] as const;
const BODIES = ["body", "steps", "content", "message"] as const;
const MAX = 4_000;

const label = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);
const clip = (value: string) => value.length > MAX ? `${value.slice(0, MAX)}…` : value;

/** The default view: the fields above, read from the input or a transmission tool's `payload`. */
export function approvalView(approval: FoundryApproval): ApprovalView {
  const input = (approval.toolInput && typeof approval.toolInput === "object" ? approval.toolInput : {}) as Record<string, unknown>;
  const source = (input.payload && typeof input.payload === "object" ? input.payload : input) as Record<string, unknown>;
  const fields = FIELDS.flatMap((key) => typeof source[key] === "string" && source[key] ? [{ label: label(key), value: clip(source[key] as string) }] : []);
  const body = BODIES.map((key) => source[key]).find((value): value is string => typeof value === "string" && value.length > 0);
  return {
    id: approval.id,
    runId: approval.runId,
    agentId: approval.agentId,
    conversationId: approval.conversationId,
    toolName: approval.toolName,
    title: `Wants to use ${approval.toolName}`,
    fields,
    ...(body ? { body: clip(body) } : {}),
    canAlwaysAllow: false,
    requestedAt: approval.requestedAt,
  };
}

/**
 * The workspace's pending approvals, newest last. `describe` lets the product
 * set a title, change the fields, or offer "Always allow", from the full
 * approval on the server.
 */
export async function pendingApprovals(
  workspaceId: string,
  options: {
    readonly client?: Pick<Foundry, "approvals">;
    readonly describe?: (approval: FoundryApproval, view: ApprovalView) => Partial<ApprovalView> | undefined;
    readonly filter?: (approval: FoundryApproval) => boolean;
  } = {},
): Promise<ApprovalView[]> {
  const approvals = await (options.client ?? foundry()).approvals({ status: "pending" });
  return approvals
    .filter((approval) => approval.workspaceId === workspaceId && (options.filter?.(approval) ?? true))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
    .map((approval) => {
      const view = approvalView(approval);
      return { ...view, ...options.describe?.(approval, view), id: view.id, runId: view.runId, agentId: view.agentId, conversationId: view.conversationId };
    });
}
