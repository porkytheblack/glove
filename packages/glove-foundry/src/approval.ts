import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Displaymanager,
  permissionKey,
  type DisplayManagerAdapter,
  type Slot,
  type StoreAdapter,
} from "glove-core";

export const FOUNDRY_APPROVAL_DIRECTORY_ENV = "GLOVE_FOUNDRY_APPROVAL_DIRECTORY";
const REQUEST_SUFFIX = ".request.json";
const RESOLUTION_SUFFIX = ".resolution.json";
const APPROVAL_ID = /^approval_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FoundryApprovalDecision = "approve" | "deny";
export type FoundryApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";

export interface FoundryApproval {
  readonly id: string;
  readonly runId: string;
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly status: FoundryApprovalStatus;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly resolvedAt?: string;
}

interface ApprovalRequestRecord extends Omit<FoundryApproval, "status" | "resolvedAt"> {}

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
    readonly timeoutMs?: number;
  },
): Promise<FoundryApproval> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const requestedAt = new Date();
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 300_000, 1_000), 600_000);
  const request: ApprovalRequestRecord = Object.freeze({
    id: `approval_${randomUUID()}`,
    runId: input.runId,
    definitionId: input.definitionId,
    agentId: input.agentId,
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
    toolName: input.toolName,
    toolInput: serializable(input.toolInput),
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
    try {
      const approval = await createFoundryApproval(this.context.directory, {
        runId: this.context.runId,
        definitionId: this.context.definitionId,
        agentId: this.context.agentId,
        conversationId: this.context.conversationId,
        workspaceId: this.context.workspaceId,
        toolName,
        toolInput: request.toolInput,
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
