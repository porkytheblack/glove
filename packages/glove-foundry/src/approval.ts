import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Displaymanager,
  ToolPermissionDeferred,
  permissionKey,
  type DisplayManagerAdapter,
  type Slot,
  type StoreAdapter,
} from "glove-core";

export const FOUNDRY_APPROVAL_DIRECTORY_ENV = "GLOVE_FOUNDRY_APPROVAL_DIRECTORY";
/** @internal How runs treat approvals, set by the runtime: `{ durable, waitMs, expiresAfterMs }`. */
export const FOUNDRY_APPROVAL_POLICY_ENV = "GLOVE_FOUNDRY_APPROVAL_POLICY";
const REQUEST_SUFFIX = ".request.json";
const RESOLUTION_SUFFIX = ".resolution.json";
const SUSPENDED_SUFFIX = ".suspended.json";

/** Default live wait before a run with durable approvals suspends. */
export const DEFAULT_APPROVAL_WAIT_MS = 60_000;
/** Default lifetime of a durable approval nobody has decided. */
export const DEFAULT_APPROVAL_EXPIRES_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** How a run treats approvals. Durable ones outlive the run; the others expire with it. */
export interface FoundryApprovalPolicy {
  readonly durable: boolean;
  /** How long the run waits for a decision before it suspends (durable) or the approval expires. */
  readonly waitMs: number;
  /** How long a durable approval stays open. */
  readonly expiresAfterMs: number;
}

export function readApprovalPolicy(value: string | undefined): FoundryApprovalPolicy | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<FoundryApprovalPolicy>;
    if (typeof parsed.durable !== "boolean" || typeof parsed.waitMs !== "number" || typeof parsed.expiresAfterMs !== "number") return undefined;
    return { durable: parsed.durable, waitMs: parsed.waitMs, expiresAfterMs: parsed.expiresAfterMs };
  } catch {
    return undefined;
  }
}
const APPROVAL_ID = /^approval_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FoundryApprovalDecision = "approve" | "deny";
export type FoundryApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";

export interface FoundryApproval {
  readonly id: string;
  /** The run that asked. A resumed approval continues in a later run (`resumeRunId`). */
  readonly runId: string;
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly toolName: string;
  readonly toolInput: unknown;
  /** The tool call waiting for this decision, as the model made it. */
  readonly toolCallId?: string;
  readonly status: FoundryApprovalStatus;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly resolvedAt?: string;
  /** Where a person decides it: from the application's `approvals.url`. */
  readonly url?: string;
  /** When the run stopped waiting for it. A decision after this resumes the run. */
  readonly suspendedAt?: string;
  /** When the decision was handed to the conversation, and the run that took it. */
  readonly resumedAt?: string;
  readonly resumeRunId?: string;
  /** The run that asked read the decision itself, so no resume is owed. */
  readonly settledInRun?: boolean;
}

interface ApprovalRequestRecord extends Omit<FoundryApproval, "status" | "resolvedAt" | "url" | "suspendedAt" | "resumedAt" | "resumeRunId" | "settledInRun"> {}

interface ApprovalResolutionRecord {
  readonly id: string;
  readonly status: Exclude<FoundryApprovalStatus, "pending">;
  readonly resolvedAt: string;
}

function approvalPath(directory: string, id: string, suffix: string): string {
  if (!APPROVAL_ID.test(id)) throw new Error("Invalid Foundry approval id.");
  return join(directory, `${id}${suffix}`);
}

function serializable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

function requestRecord(value: unknown): ApprovalRequestRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ApprovalRequestRecord>;
  return typeof item.id === "string" && APPROVAL_ID.test(item.id)
    && typeof item.runId === "string"
    && typeof item.definitionId === "string"
    && typeof item.agentId === "string"
    && typeof item.conversationId === "string"
    && typeof item.workspaceId === "string"
    && typeof item.toolName === "string"
    && typeof item.requestedAt === "string"
    && typeof item.expiresAt === "string"
    ? item as ApprovalRequestRecord
    : null;
}

function resolutionRecord(value: unknown): ApprovalResolutionRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ApprovalResolutionRecord>;
  return typeof item.id === "string" && APPROVAL_ID.test(item.id)
    && ["approved", "denied", "expired", "cancelled"].includes(item.status ?? "")
    && typeof item.resolvedAt === "string"
    ? item as ApprovalResolutionRecord
    : null;
}

async function writeResolution(
  directory: string,
  id: string,
  status: ApprovalResolutionRecord["status"],
  rejectExisting = false,
): Promise<ApprovalResolutionRecord> {
  const resolution = Object.freeze({ id, status, resolvedAt: new Date().toISOString() });
  try {
    await writeFile(
      approvalPath(directory, id, RESOLUTION_SUFFIX),
      `${JSON.stringify(resolution)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    return resolution;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    const existing = resolutionRecord(
      await readJson(approvalPath(directory, id, RESOLUTION_SUFFIX)),
    );
    if (!existing) throw new Error(`Foundry approval "${id}" has an invalid resolution.`);
    if (rejectExisting) {
      throw new Error(`Foundry approval "${id}" is already ${existing.status}.`);
    }
    return existing;
  }
}

export async function createFoundryApproval(
  directory: string,
  input: {
    readonly runId: string;
    readonly definitionId: string;
    readonly agentId: string;
    readonly conversationId: string;
    readonly workspaceId: string;
    readonly toolName: string;
    readonly toolInput: unknown;
    readonly toolCallId?: string;
    readonly timeoutMs?: number;
    /** A durable approval's lifetime, beyond the live wait. Overrides `timeoutMs`. */
    readonly expiresAfterMs?: number;
  },
): Promise<FoundryApproval> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const requestedAt = new Date();
  const timeoutMs = input.expiresAfterMs !== undefined
    ? Math.max(input.expiresAfterMs, 1_000)
    : Math.min(Math.max(input.timeoutMs ?? 300_000, 1_000), 600_000);
  const request: ApprovalRequestRecord = Object.freeze({
    id: `approval_${randomUUID()}`,
    runId: input.runId,
    definitionId: input.definitionId,
    agentId: input.agentId,
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
    toolName: input.toolName,
    toolInput: serializable(input.toolInput),
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    requestedAt: requestedAt.toISOString(),
    expiresAt: new Date(requestedAt.getTime() + timeoutMs).toISOString(),
  });
  await writeFile(
    approvalPath(directory, request.id, REQUEST_SUFFIX),
    `${JSON.stringify(request)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return Object.freeze({ ...request, status: "pending" });
}

export async function listFoundryApprovals(
  directory: string,
  filter: {
    readonly runId?: string;
    readonly status?: FoundryApprovalStatus;
  } = {},
): Promise<ReadonlyArray<FoundryApproval>> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  const approvals: FoundryApproval[] = [];
  for (const name of names.filter((item) => item.endsWith(REQUEST_SUFFIX)).sort()) {
    const request = requestRecord(await readJson(join(directory, name)));
    if (!request) continue;
    const resolution = resolutionRecord(
      await readJson(approvalPath(directory, request.id, RESOLUTION_SUFFIX)),
    );
    const status = resolution?.status
      ?? (Date.parse(request.expiresAt) <= Date.now() ? "expired" : "pending");
    const approval: FoundryApproval = Object.freeze({
      ...request,
      status,
      ...(resolution ? { resolvedAt: resolution.resolvedAt } : {}),
    });
    if (filter.runId && approval.runId !== filter.runId) continue;
    if (filter.status && approval.status !== filter.status) continue;
    approvals.push(approval);
  }
  return approvals.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

export async function resolveFoundryApproval(
  directory: string,
  id: string,
  decision: FoundryApprovalDecision,
): Promise<FoundryApproval> {
  const request = requestRecord(await readJson(approvalPath(directory, id, REQUEST_SUFFIX)));
  if (!request) throw new Error(`Foundry approval "${id}" was not found.`);
  const current = (await listFoundryApprovals(directory)).find((item) => item.id === id);
  if (!current || current.status !== "pending") {
    throw new Error(`Foundry approval "${id}" is already ${current?.status ?? "unavailable"}.`);
  }
  const resolution = await writeResolution(
    directory,
    id,
    decision === "approve" ? "approved" : "denied",
    true,
  );
  return Object.freeze({ ...request, status: resolution.status, resolvedAt: resolution.resolvedAt });
}

/** Whether the request was made in this directory (by a run of this runtime process). */
export async function foundryApprovalRequested(directory: string, id: string): Promise<boolean> {
  return requestRecord(await readJson(approvalPath(directory, id, REQUEST_SUFFIX))) !== null;
}

/** The decision written for an approval, if any. */
export async function readFoundryApprovalResolution(
  directory: string,
  id: string,
): Promise<{ readonly status: Exclude<FoundryApprovalStatus, "pending">; readonly resolvedAt: string } | null> {
  return resolutionRecord(await readJson(approvalPath(directory, id, RESOLUTION_SUFFIX)));
}

/**
 * Mark an approval's run as no longer waiting. The run and a decider race:
 * the run marks first and then looks for a decision once more; a decider
 * writes its decision first and then looks for the mark. Whichever comes
 * second sees the other, so a decision is either read by the run or resumed,
 * never both and never neither. True when this call made the mark.
 */
export async function markFoundryApprovalSuspended(directory: string, id: string): Promise<boolean> {
  try {
    await writeFile(
      approvalPath(directory, id, SUSPENDED_SUFFIX),
      `${JSON.stringify({ id, suspendedAt: new Date().toISOString() })}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw cause;
  }
}

export async function foundryApprovalSuspended(directory: string, id: string): Promise<boolean> {
  return (await readJson(approvalPath(directory, id, SUSPENDED_SUFFIX))) !== null;
}

/** Wait for a decision until `waitMs` passes or the run stops. Null when nobody decided. */
async function waitForDecision(
  directory: string,
  approval: FoundryApproval,
  signal: AbortSignal,
  waitMs: number,
): Promise<ApprovalResolutionRecord | null> {
  const until = Math.min(Date.now() + waitMs, Date.parse(approval.expiresAt));
  for (;;) {
    const resolved = resolutionRecord(
      await readJson(approvalPath(directory, approval.id, RESOLUTION_SUFFIX)),
    );
    if (resolved) return resolved;
    if (signal.aborted || Date.now() >= until) return null;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
  }
}

async function waitForResolution(
  directory: string,
  approval: FoundryApproval,
  signal: AbortSignal,
): Promise<ApprovalResolutionRecord> {
  for (;;) {
    const resolved = resolutionRecord(
      await readJson(approvalPath(directory, approval.id, RESOLUTION_SUFFIX)),
    );
    if (resolved) return resolved;
    if (signal.aborted) return writeResolution(directory, approval.id, "cancelled");
    if (Date.parse(approval.expiresAt) <= Date.now()) {
      return writeResolution(directory, approval.id, "expired");
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
  }
}

export class FoundryApprovalDisplayManager extends Displaymanager implements DisplayManagerAdapter {
  constructor(
    private readonly context: {
      readonly directory?: string;
      readonly runId: string;
      readonly definitionId: string;
      readonly agentId: string;
      readonly conversationId: string;
      readonly workspaceId: string;
      readonly signal: AbortSignal;
      readonly emit: (event: { readonly type: string; readonly data?: unknown }) => void;
      /** With durable approvals the run suspends after `waitMs` instead of the approval expiring. */
      readonly policy?: FoundryApprovalPolicy;
    },
  ) {
    super();
  }

  override async pushAndWait<I, O>(slot: Omit<Slot<I>, "id">): Promise<O> {
    if (slot.renderer !== "permission_request") {
      return super.pushAndWait(slot);
    }
    const request = slot.input && typeof slot.input === "object"
      ? slot.input as Record<string, unknown>
      : {};
    const toolName = typeof request.toolName === "string" ? request.toolName : undefined;
    if (!this.context.directory || !toolName) {
      this.context.emit({
        type: "foundry.approval.unavailable",
        data: { toolName: toolName ?? "unknown", reason: "approval-channel-unavailable" },
      });
      return false as O;
    }
    const toolCallId = typeof request.toolCallId === "string" ? request.toolCallId : undefined;
    const durable = this.context.policy?.durable ? this.context.policy : undefined;
    if (durable) return this.durableDecision<O>(this.context.directory, toolName, request.toolInput, toolCallId, durable);
    try {
      const approval = await createFoundryApproval(this.context.directory, {
        runId: this.context.runId,
        definitionId: this.context.definitionId,
        agentId: this.context.agentId,
        conversationId: this.context.conversationId,
        workspaceId: this.context.workspaceId,
        toolName,
        toolInput: request.toolInput,
        ...(toolCallId ? { toolCallId } : {}),
        ...(this.context.policy ? { timeoutMs: this.context.policy.waitMs } : {}),
      });
      this.context.emit({ type: "foundry.approval.requested", data: approval });
      const resolution = await waitForResolution(
        this.context.directory,
        approval,
        this.context.signal,
      );
      this.context.emit({
        type: "foundry.approval.settled",
        data: { approvalId: approval.id, toolName, status: resolution.status },
      });
      return (resolution.status === "approved") as O;
    } catch (cause) {
      this.context.emit({
        type: "foundry.approval.failed",
        data: { toolName, error: cause instanceof Error ? cause.message : String(cause) },
      });
      return false as O;
    }
  }

  /**
   * A durable approval: wait a while for the decision in this run. If nobody
   * decides in time, or the run is stopping, the approval stays open and the
   * turn suspends at this tool call (`ToolPermissionDeferred`), with no
   * result recorded for it. The runtime resumes it when someone decides.
   */
  private async durableDecision<O>(
    directory: string,
    toolName: string,
    toolInput: unknown,
    toolCallId: string | undefined,
    policy: FoundryApprovalPolicy,
  ): Promise<O> {
    let approval: FoundryApproval;
    try {
      approval = await createFoundryApproval(directory, {
        runId: this.context.runId,
        definitionId: this.context.definitionId,
        agentId: this.context.agentId,
        conversationId: this.context.conversationId,
        workspaceId: this.context.workspaceId,
        toolName,
        toolInput,
        ...(toolCallId ? { toolCallId } : {}),
        expiresAfterMs: policy.expiresAfterMs,
      });
    } catch (cause) {
      this.context.emit({
        type: "foundry.approval.failed",
        data: { toolName, error: cause instanceof Error ? cause.message : String(cause) },
      });
      return false as O;
    }
    this.context.emit({ type: "foundry.approval.requested", data: approval });
    let resolution = await waitForDecision(directory, approval, this.context.signal, policy.waitMs);
    if (!resolution) {
      await markFoundryApprovalSuspended(directory, approval.id);
      // A decision that landed just before the mark is still this run's to use.
      resolution = resolutionRecord(await readJson(approvalPath(directory, approval.id, RESOLUTION_SUFFIX)));
    }
    if (resolution) {
      this.context.emit({
        type: "foundry.approval.settled",
        data: { approvalId: approval.id, toolName, status: resolution.status },
      });
      return (resolution.status === "approved") as O;
    }
    this.context.emit({ type: "foundry.approval.suspended", data: { approvalId: approval.id, toolName } });
    throw new ToolPermissionDeferred(
      `Approval ${approval.id} for ${toolName} waits for a decision.`,
      { approvalId: approval.id, toolName },
    );
  }
}

/** Add fail-closed per-input permissions to a custom store that omitted them. */
export function withFoundryPermissions(store: StoreAdapter): StoreAdapter {
  if (store.getPermission && store.setPermission) return store;
  const permissions = new Map<string, "granted" | "denied">();
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "getPermission") {
        return async (toolName: string, input?: unknown) =>
          permissions.get(permissionKey(toolName, input)) ?? "unset";
      }
      if (property === "setPermission") {
        return async (toolName: string, status: "granted" | "denied" | "unset", input?: unknown) => {
          const key = permissionKey(toolName, input);
          if (status === "unset") permissions.delete(key);
          else permissions.set(key, status);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
