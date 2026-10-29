import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import {
  Displaymanager,
  permissionKey,
  type DisplayManagerAdapter,
  type Slot,
  type StoreAdapter,
} from "glove-core";

export const FOUNDRY_APPROVAL_DIRECTORY_ENV = "GLOVE_FOUNDRY_APPROVAL_DIRECTORY";
/** Child processes read this. `none` means a pending approval does not expire. */
export const FOUNDRY_APPROVAL_TIMEOUT_ENV = "GLOVE_FOUNDRY_APPROVAL_TIMEOUT_MS";
/**
 * Set when the control process's data adapter can store approvals. An abort
 * then leaves the record pending (shutdown, crash, run timeout) instead of
 * failing it closed. An explicit cancel still denies it from the control process.
 */
export const FOUNDRY_APPROVAL_DURABLE_ENV = "GLOVE_FOUNDRY_APPROVAL_DURABLE";
/** Request payload key for a run that continues a decided approval. */
export const FOUNDRY_APPROVAL_RESUME_KEY = "foundryApproval";

const REQUEST_SUFFIX = ".request.json";
const RESOLUTION_SUFFIX = ".resolution.json";
const APPROVAL_ID = /^approval_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FoundryApprovalDecision = "approve" | "deny";
export type FoundryApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";
export type FoundryApprovalTerminalStatus = Exclude<FoundryApprovalStatus, "pending">;

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
  /** `null` means the approval waits until someone decides or the run is cancelled. */
  readonly expiresAt: string | null;
  readonly resolvedAt?: string;
  /**
   * The decision arrived after the waiting run was gone, so a continuation run
   * still has to perform it. Cleared once that run is admitted.
   */
  readonly needsResume?: boolean;
  /** The continuation run, once one has been admitted. */
  readonly resumeRunId?: string;
}

/** The decision a continuation run carries. The child trusts this envelope, not the model. */
export interface FoundryApprovalResume {
  readonly id: string;
  readonly status: FoundryApprovalTerminalStatus;
  readonly toolName: string;
  readonly toolInput: unknown;
}

/**
 * Process-shared approval storage. `FoundryDataAdapter` implementations wrap
 * these operations; the temp directory remains only as a wake-up channel
 * between a live run and the control process.
 */
export interface FoundryApprovalStore {
  put(approval: FoundryApproval): Promise<void>;
  list(): Promise<ReadonlyArray<FoundryApproval>>;
  settle(
    id: string,
    status: FoundryApprovalTerminalStatus,
    needsResume?: boolean,
  ): Promise<FoundryApproval>;
  noteResume?(id: string, resumeRunId: string): Promise<void>;
}

interface ApprovalRequestRecord extends Omit<FoundryApproval, "status" | "resolvedAt" | "needsResume" | "resumeRunId"> {}

interface ApprovalResolutionRecord {
  readonly id: string;
  readonly status: FoundryApprovalTerminalStatus;
  readonly resolvedAt: string;
}

interface ApprovalAdapter {
  putApproval?(approval: FoundryApproval): Effect.Effect<void, unknown, never>;
  listApprovals?(): Effect.Effect<ReadonlyArray<FoundryApproval>, unknown, never>;
  settleApproval?(
    id: string,
    status: FoundryApprovalTerminalStatus,
    needsResume?: boolean,
  ): Effect.Effect<FoundryApproval, unknown, never>;
  noteApprovalResume?(id: string, resumeRunId: string): Effect.Effect<void, unknown, never>;
}

/** Adapter methods, when the data adapter implements all three, become the durable store. */
export function approvalStoreFrom(data: ApprovalAdapter | undefined): FoundryApprovalStore | undefined {
  if (!data?.putApproval || !data.listApprovals || !data.settleApproval) return undefined;
  const putApproval = data.putApproval.bind(data);
  const listApprovals = data.listApprovals.bind(data);
  const settleApproval = data.settleApproval.bind(data);
  const noteApprovalResume = data.noteApprovalResume?.bind(data);
  return {
    put: (approval) => Effect.runPromise(putApproval(approval)),
    list: () => Effect.runPromise(listApprovals()),
    settle: (id, status, needsResume) => Effect.runPromise(settleApproval(id, status, needsResume)),
    ...(noteApprovalResume
      ? { noteResume: (id: string, resumeRunId: string) => Effect.runPromise(noteApprovalResume(id, resumeRunId)) }
      : {}),
  };
}

export function approvalTimeoutFromEnv(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env[FOUNDRY_APPROVAL_TIMEOUT_ENV];
  if (raw === undefined || raw === "" || raw === "none") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1_000, parsed);
}

export function foundryApprovalStatus(
  approval: Pick<FoundryApproval, "status" | "expiresAt">,
  now = Date.now(),
): FoundryApprovalStatus {
  if (approval.status !== "pending") return approval.status;
  if (approval.expiresAt !== null && Date.parse(approval.expiresAt) <= now) return "expired";
  return "pending";
}

export function approvalResumeFrom(payload: unknown): FoundryApprovalResume | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = (payload as Record<string, unknown>)[FOUNDRY_APPROVAL_RESUME_KEY];
  if (!record || typeof record !== "object") return undefined;
  const item = record as Partial<FoundryApprovalResume>;
  if (typeof item.id !== "string" || !APPROVAL_ID.test(item.id)) return undefined;
  if (typeof item.toolName !== "string" || !item.toolName) return undefined;
  if (
    item.status !== "approved"
    && item.status !== "denied"
    && item.status !== "expired"
    && item.status !== "cancelled"
  ) return undefined;
  return {
    id: item.id,
    status: item.status,
    toolName: item.toolName,
    toolInput: item.toolInput,
  };
}

export function approvalResumeMessage(approval: FoundryApproval): string {
  const input = JSON.stringify(approval.toolInput);
  if (approval.status === "approved") {
    return [
      `A human approved ${approval.toolName} (${approval.id}).`,
      `Call ${approval.toolName} now with exactly this input: ${input}.`,
      "Then finish in one short sentence.",
    ].join(" ");
  }
  const why = approval.status === "denied"
    ? "denied"
    : approval.status === "expired"
      ? "let expire, which denies it"
      : "cancelled";
  return [
    `A human ${why} ${approval.toolName} (${approval.id}).`,
    `Do not call ${approval.toolName}.`,
    "Tell the user the action was not approved.",
  ].join(" ");
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

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(serializable(value)));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

export function sameApprovalInput(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function resolveTimeout(timeoutMs: number | null | undefined): number | null {
  if (timeoutMs === undefined || timeoutMs === null) return null;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  return Math.max(1_000, timeoutMs);
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
    && (item.expiresAt === null || typeof item.expiresAt === "string")
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

function isTerminal(status: string): status is FoundryApprovalTerminalStatus {
  return status === "approved" || status === "denied" || status === "expired" || status === "cancelled";
}

/** Accept an approval object coming back from a data adapter or an agent event. */
export function foundryApprovalRecord(value: unknown): FoundryApproval | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<FoundryApproval>;
  if (
    typeof item.id !== "string" || !APPROVAL_ID.test(item.id)
    || typeof item.runId !== "string"
    || typeof item.definitionId !== "string"
    || typeof item.agentId !== "string"
    || typeof item.conversationId !== "string"
    || typeof item.workspaceId !== "string"
    || typeof item.toolName !== "string"
    || typeof item.requestedAt !== "string"
    || (item.expiresAt !== null && typeof item.expiresAt !== "string")
    || typeof item.status !== "string"
    || !isTerminal(item.status) && item.status !== "pending"
  ) return null;
  return Object.freeze({
    id: item.id,
    runId: item.runId,
    definitionId: item.definitionId,
    agentId: item.agentId,
    conversationId: item.conversationId,
    workspaceId: item.workspaceId,
    toolName: item.toolName,
    toolInput: serializable(item.toolInput),
    status: foundryApprovalStatus({ status: item.status, expiresAt: item.expiresAt ?? null }),
    requestedAt: item.requestedAt,
    expiresAt: item.expiresAt ?? null,
    ...(typeof item.resolvedAt === "string" ? { resolvedAt: item.resolvedAt } : {}),
    ...(item.needsResume === true ? { needsResume: true } : {}),
    ...(typeof item.resumeRunId === "string" && item.resumeRunId ? { resumeRunId: item.resumeRunId } : {}),
  });
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
    /** Omit or pass null to wait until a person decides. A positive number is a millisecond limit (at least 1s). */
    readonly timeoutMs?: number | null;
  },
): Promise<FoundryApproval> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const requestedAt = new Date();
  const timeoutMs = resolveTimeout(input.timeoutMs);
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
    expiresAt: timeoutMs === null ? null : new Date(requestedAt.getTime() + timeoutMs).toISOString(),
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
    const status = resolution?.status ?? foundryApprovalStatus({ status: "pending", expiresAt: request.expiresAt });
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

async function directoryResolution(
  directory: string | undefined,
  id: string,
): Promise<ApprovalResolutionRecord | null> {
  if (!directory) return null;
  return resolutionRecord(await readJson(approvalPath(directory, id, RESOLUTION_SUFFIX)));
}

async function waitForResolution(
  approval: FoundryApproval,
  signal: AbortSignal,
  options: {
    readonly directory?: string;
    readonly store?: FoundryApprovalStore;
    readonly preserveOnAbort: boolean;
  },
): Promise<ApprovalResolutionRecord> {
  for (;;) {
    const filed = await directoryResolution(options.directory, approval.id);
    if (filed) return filed;
    if (options.store) {
      const stored = (await options.store.list()).find((item) => item.id === approval.id);
      if (stored && stored.status !== "pending") {
        return {
          id: stored.id,
          status: stored.status as FoundryApprovalTerminalStatus,
          resolvedAt: stored.resolvedAt ?? new Date().toISOString(),
        };
      }
    }
    if (signal.aborted) {
      if (options.preserveOnAbort) {
        throw new Error("Foundry approval wait interrupted.");
      }
      if (!options.directory) {
        if (options.store) {
          const settled = await options.store.settle(approval.id, "cancelled", false);
          return {
            id: settled.id,
            status: "cancelled",
            resolvedAt: settled.resolvedAt ?? new Date().toISOString(),
          };
        }
        throw new Error("Foundry approval wait interrupted.");
      }
      return writeResolution(options.directory, approval.id, "cancelled");
    }
    if (foundryApprovalStatus(approval) === "expired") {
      if (options.store) await options.store.settle(approval.id, "expired", false).catch(() => undefined);
      if (!options.directory) {
        return { id: approval.id, status: "expired", resolvedAt: new Date().toISOString() };
      }
      return writeResolution(options.directory, approval.id, "expired");
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
  }
}

async function pendingMatch(
  options: {
    readonly directory?: string;
    readonly store?: FoundryApprovalStore;
    readonly conversationId: string;
    readonly toolName: string;
    readonly toolInput: unknown;
  },
): Promise<FoundryApproval | undefined> {
  const collected: FoundryApproval[] = [];
  if (options.store) collected.push(...await options.store.list());
  if (options.directory) {
    try {
      collected.push(...await listFoundryApprovals(options.directory, { status: "pending" }));
    } catch {
      // A missing directory just means nothing is waiting there yet.
    }
  }
  return collected
    .filter((item) =>
      foundryApprovalStatus(item) === "pending"
      && item.conversationId === options.conversationId
      && item.toolName === options.toolName
      && sameApprovalInput(item.toolInput, options.toolInput))
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))[0];
}

export class FoundryApprovalDisplayManager extends Displaymanager implements DisplayManagerAdapter {
  constructor(
    private readonly context: {
      readonly directory?: string;
      readonly store?: FoundryApprovalStore;
      readonly runId: string;
      readonly definitionId: string;
      readonly agentId: string;
      readonly conversationId: string;
      readonly workspaceId: string;
      readonly signal: AbortSignal;
      readonly timeoutMs?: number | null;
      /** Leave the stored approval pending when this process is aborted. */
      readonly preserveOnAbort?: boolean;
      /** Set on the continuation run that performs an already decided approval. */
      readonly resume?: FoundryApprovalResume;
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
    if ((!this.context.directory && !this.context.store) || !toolName) {
      this.context.emit({
        type: "foundry.approval.unavailable",
        data: { toolName: toolName ?? "unknown", reason: "approval-channel-unavailable" },
      });
      return false as O;
    }
    const resume = this.context.resume;
    if (
      resume
      && resume.toolName === toolName
      && sameApprovalInput(resume.toolInput, request.toolInput)
    ) {
      const allowed = resume.status === "approved";
      this.context.emit({
        type: "foundry.approval.settled",
        data: { approvalId: resume.id, toolName, status: resume.status },
      });
      return allowed as O;
    }
    try {
      const existing = await pendingMatch({
        directory: this.context.directory,
        store: this.context.store,
        conversationId: this.context.conversationId,
        toolName,
        toolInput: request.toolInput,
      });
      const approval = existing ?? await this.createApproval(toolName, request.toolInput);
      if (!existing) {
        this.context.emit({ type: "foundry.approval.requested", data: approval });
      }
      const resolution = await waitForResolution(approval, this.context.signal, {
        directory: this.context.directory,
        store: this.context.store,
        preserveOnAbort: this.context.preserveOnAbort === true,
      });
      this.context.emit({
        type: "foundry.approval.settled",
        data: { approvalId: approval.id, toolName, status: resolution.status },
      });
      return (resolution.status === "approved") as O;
    } catch (cause) {
      if (this.context.preserveOnAbort && this.context.signal.aborted) throw cause;
      this.context.emit({
        type: "foundry.approval.failed",
        data: { toolName, error: cause instanceof Error ? cause.message : String(cause) },
      });
      return false as O;
    }
  }

  private async createApproval(toolName: string, toolInput: unknown): Promise<FoundryApproval> {
    const timeoutMs = this.context.timeoutMs !== undefined
      ? this.context.timeoutMs
      : approvalTimeoutFromEnv();
    const input = {
      runId: this.context.runId,
      definitionId: this.context.definitionId,
      agentId: this.context.agentId,
      conversationId: this.context.conversationId,
      workspaceId: this.context.workspaceId,
      toolName,
      toolInput,
      timeoutMs,
    };
    if (this.context.directory) {
      const approval = await createFoundryApproval(this.context.directory, input);
      if (this.context.store) await this.context.store.put(approval);
      return approval;
    }
    const requestedAt = new Date();
    const timeout = resolveTimeout(timeoutMs);
    const approval: FoundryApproval = Object.freeze({
      id: `approval_${randomUUID()}`,
      runId: input.runId,
      definitionId: input.definitionId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      workspaceId: input.workspaceId,
      toolName,
      toolInput: serializable(toolInput),
      status: "pending",
      requestedAt: requestedAt.toISOString(),
      expiresAt: timeout === null ? null : new Date(requestedAt.getTime() + timeout).toISOString(),
    });
    await this.context.store!.put(approval);
    return approval;
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
