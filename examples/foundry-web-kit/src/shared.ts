// What crosses from the app's server to the browser. Everything here is a
// reduced, display-only shape: no tokens, no system prompts, no raw tool
// input or results.

/** One tool call, as a person sees it. */
export interface DisplayTool {
  readonly name: string;
  readonly status: "running" | "done" | "error";
  /** A short line chosen on the server, like "Read 14 threads in Gmail". */
  readonly label?: string;
  /** Show it as a chip under the reply (a handoff) instead of a line above it. */
  readonly chip?: boolean;
}

/**
 * One message in a thread. `event` is something that arrived from elsewhere
 * (new mail, a sibling's message), shown as a short line.
 */
export interface DisplayMessage {
  readonly id: string;
  readonly sender: "person" | "agent" | "event";
  readonly text: string;
  readonly tools?: ReadonlyArray<DisplayTool>;
  /** ISO time, when known. Glove transcripts don't carry one per message. */
  readonly at?: string;
}

/**
 * One event on a run's live stream. Only these types reach the browser, each
 * with only these fields.
 */
export type LiveEvent =
  | { readonly seq: number; readonly type: "agent.text_delta"; readonly text: string }
  | { readonly seq: number; readonly type: "agent.tool_use"; readonly name: string; readonly label?: string; readonly chip?: boolean }
  | { readonly seq: number; readonly type: "agent.tool_use_result"; readonly name: string; readonly status: "done" | "error" }
  | { readonly seq: number; readonly type: "agent.foundry.approval.requested"; readonly approvalId: string; readonly toolName: string }
  | { readonly seq: number; readonly type: "approval.resolved"; readonly approvalId: string; readonly status: string }
  | { readonly seq: number; readonly type: "run.started" | "run.completed" | "run.failed" | "run.cancelled" };

export const TERMINAL_RUN_EVENTS: ReadonlyArray<string> = ["run.completed", "run.failed", "run.cancelled"];

/** A pending approval: who asks, for which tool, and the few fields a person needs to decide. */
export interface ApprovalView {
  readonly id: string;
  readonly runId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly toolName: string;
  /** Like "Inbox Manager wants to send this email". */
  readonly title: string;
  readonly fields: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  /** The long part, such as an email's body, shown on its own. */
  readonly body?: string;
  /** Whether "Always allow" can be offered for this tool. */
  readonly canAlwaysAllow: boolean;
  readonly requestedAt: string;
}

export type ApprovalDecision = "approve" | "deny" | "always";

/**
 * An app, as a person sees it: the accounts it holds, what comes in and goes
 * out through them, and which playbooks take what comes in.
 */
export interface AppSummary {
  readonly app: string;
  readonly name: string;
  readonly description: string;
  /** How many of the person's agents have it installed. */
  readonly installedOn: number;
  readonly accounts: ReadonlyArray<{ readonly id: string; readonly label: string; readonly status: "connected" | "error" | "unknown" }>;
  /** `watching` names the account a connection is watching, when one is running. */
  readonly inbound: ReadonlyArray<{ readonly name: string; readonly watching?: string }>;
  readonly outbound: ReadonlyArray<{ readonly name: string; readonly asks: boolean }>;
  readonly playbooks: ReadonlyArray<{
    readonly name: string;
    readonly handledBy: ReadonlyArray<{ readonly agentId: string; readonly agent: string; readonly does?: string }>;
  }>;
}

/** One message in a mock provider's conversation. `me` is whoever the page lets you be (Rosa's phone, Sam in Slack). */
export interface MockBubble {
  readonly id: string;
  readonly side: "me" | "them";
  readonly text: string;
  readonly at: string;
  /** A small line under the bubble, like "from 1555 0199 999". */
  readonly note?: string;
}

/** One line in the delivery log. */
export interface DeliveryHop {
  readonly id: string;
  readonly at: string;
  /** `in`: the mock sent the app a webhook. `hop`: the app passed it to Foundry. `out`: the app called the mock's API. */
  readonly direction: "in" | "out" | "hop";
  readonly title: string;
  readonly detail?: string;
  readonly ok: boolean;
}
