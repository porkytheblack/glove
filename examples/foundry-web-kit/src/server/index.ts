// The server half of the kit: everything that holds FOUNDRY_TOKEN or reads a
// person's data. Import it only from route handlers, server components and
// scripts.

export { foundry, foundryConnection, type Foundry } from "./foundry";
export { HttpError, handle, notFound } from "./errors";
export {
  SESSION_COOKIE,
  clearedSessionCookie,
  createInvite,
  devSignIn,
  isHttps,
  readSession,
  sessionCookie,
  verifyInvite,
  type CookieOptions,
  type SignOptions,
} from "./session";
export { currentPerson, requirePerson, type SignedIn } from "./person";
export { ownedAgent, ownedAgents, ownedApproval, ownedConversation, ownedRun } from "./guards";
export { defaultIncoming, displayMessages, toolLabel, type DisplayOptions, type ToolLabel, type TranscriptMessage } from "./messages";
export { liveRun, reduceEvent, resumeAfter, type LiveOptions } from "./live";
export { approvalView, pendingApprovals } from "./approvals";
export { appsSummary, type AppsOptions, type PlaybookLine } from "./apps";
export type { ApprovalDecision, ApprovalView, AppSummary, DisplayMessage, DisplayTool, LiveEvent } from "../shared";
