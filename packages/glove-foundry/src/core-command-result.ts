import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FoundryCoreCommand } from "./core-tools.js";

export const FOUNDRY_CORE_COMMAND_DIRECTORY_ENV =
  "GLOVE_FOUNDRY_CORE_COMMAND_DIRECTORY";

const REQUEST_SUFFIX = ".request.json";
const CLAIM_SUFFIX = ".claim";
const CANCELLATION_SUFFIX = ".cancellation.json";
const RESULT_SUFFIX = ".result.json";
const COMMAND_ID = /^command_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface FoundryCoreCommandRequest {
  readonly id: string;
  readonly runId: string;
  readonly type: "transmit";
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly command?: Extract<FoundryCoreCommand, { readonly type: "transmit" }>;
}

type FoundryCoreCommandResult =
  | {
      readonly id: string;
      readonly status: "success";
      readonly output?: unknown;
      readonly resolvedAt: string;
    }
  | {
      readonly id: string;
      readonly status: "error";
      readonly error: string;
      readonly resolvedAt: string;
    };

interface FoundryCoreCommandCancellation {
  readonly id: string;
  readonly status: "cancelled" | "expired";
  readonly cancelledAt: string;
}

function commandPath(directory: string, id: string, suffix: string): string {
  if (!COMMAND_ID.test(id)) throw new Error("Invalid Foundry core command id.");
  return join(directory, `${id}${suffix}`);
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

function requestRecord(value: unknown): FoundryCoreCommandRequest | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<FoundryCoreCommandRequest>;
  const valid = typeof item.id === "string" && COMMAND_ID.test(item.id)
    && typeof item.runId === "string"
    && item.type === "transmit"
    && typeof item.requestedAt === "string"
    && typeof item.expiresAt === "string";
  if (!valid) return null;
  if (item.command !== undefined) {
    const command = item.command as Partial<Extract<FoundryCoreCommand, { readonly type: "transmit" }>>;
    if (
      !command || typeof command !== "object"
      || command.type !== "transmit"
      || command.id !== item.id
      || typeof command.definitionId !== "string"
      || typeof command.agentId !== "string"
      || typeof command.conversationId !== "string"
      || typeof command.workspaceId !== "string"
      || typeof command.routeId !== "string"
      || !("payload" in command)
    ) return null;
  }
  return item as FoundryCoreCommandRequest;
}

function resultRecord(value: unknown): FoundryCoreCommandResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<FoundryCoreCommandResult>;
  if (
    typeof item.id !== "string"
    || !COMMAND_ID.test(item.id)
    || typeof item.resolvedAt !== "string"
  ) return null;
  if (item.status === "success") return item as FoundryCoreCommandResult;
  return item.status === "error" && typeof item.error === "string"
    ? item as FoundryCoreCommandResult
    : null;
}

function cancellationRecord(value: unknown): FoundryCoreCommandCancellation | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<FoundryCoreCommandCancellation>;
  return typeof item.id === "string" && COMMAND_ID.test(item.id)
    && (item.status === "cancelled" || item.status === "expired")
    && typeof item.cancelledAt === "string"
    ? item as FoundryCoreCommandCancellation
    : null;
}

function jsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/** Persist a private execution command before emitting its small observable event. */
export async function createFoundryCoreCommandRequest(
  directory: string,
  input: {
    readonly id: string;
    readonly runId: string;
    readonly type: "transmit";
    readonly timeoutMs?: number;
    readonly command?: Extract<FoundryCoreCommand, { readonly type: "transmit" }>;
  },
): Promise<FoundryCoreCommandRequest> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const requestedAt = new Date();
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 300_000, 1_000), 600_000);
  const request: FoundryCoreCommandRequest = Object.freeze({
    id: input.id,
    runId: input.runId,
    type: input.type,
    requestedAt: requestedAt.toISOString(),
    expiresAt: new Date(requestedAt.getTime() + timeoutMs).toISOString(),
    ...(input.command ? { command: jsonValue(input.command) as Extract<FoundryCoreCommand, { readonly type: "transmit" }> } : {}),
  });
  await writeFile(
    commandPath(directory, request.id, REQUEST_SUFFIX),
    `${JSON.stringify(request)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return request;
}

/** Read the private marker without exposing this bridge in public definitions. */
export async function getFoundryCoreCommandRequest(
  directory: string,
  id: string,
): Promise<FoundryCoreCommandRequest | null> {
  return requestRecord(await readJson(commandPath(directory, id, REQUEST_SUFFIX)));
}

/** Claim execution exactly once if an agent is awaiting this command. */
export async function claimFoundryCoreCommandRequest(
  directory: string,
  id: string,
): Promise<boolean> {
  try {
    await writeFile(
      commandPath(directory, id, CLAIM_SUFFIX),
      `${new Date().toISOString()}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw cause;
  }
}

/** Settle an awaited command. Exclusive creation preserves the first result. */
export async function settleFoundryCoreCommandRequest(
  directory: string,
  id: string,
  outcome:
    | { readonly status: "success"; readonly output?: unknown }
    | { readonly status: "error"; readonly error: string },
): Promise<void> {
  const result: FoundryCoreCommandResult = outcome.status === "success"
    ? Object.freeze({
        id,
        status: "success",
        ...(outcome.output !== undefined ? { output: jsonValue(outcome.output) } : {}),
        resolvedAt: new Date().toISOString(),
      })
    : Object.freeze({
        id,
        status: "error",
        error: outcome.error,
        resolvedAt: new Date().toISOString(),
      });
  try {
    await writeFile(
      commandPath(directory, id, RESULT_SUFFIX),
      `${JSON.stringify(result)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
  }
}

async function cancelFoundryCoreCommandRequest(
  directory: string,
  id: string,
  status: FoundryCoreCommandCancellation["status"],
): Promise<void> {
  const cancellation: FoundryCoreCommandCancellation = Object.freeze({
    id,
    status,
    cancelledAt: new Date().toISOString(),
  });
  try {
    await writeFile(
      commandPath(directory, id, CANCELLATION_SUFFIX),
      `${JSON.stringify(cancellation)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
  }
}

/** Abort a parent-owned adapter when the calling run stops or its wait expires. */
export async function monitorFoundryCoreCommandRequest(
  directory: string,
  request: FoundryCoreCommandRequest,
  delivery: AbortController,
  stopped: AbortSignal,
): Promise<void> {
  while (!stopped.aborted && !delivery.signal.aborted) {
    const cancellation = cancellationRecord(
      await readJson(commandPath(directory, request.id, CANCELLATION_SUFFIX)),
    );
    if (cancellation) {
      delivery.abort(new Error(
        cancellation.status === "cancelled"
          ? "Foundry transmission call was cancelled."
          : "Foundry transmission call timed out.",
      ));
      return;
    }
    if (Date.parse(request.expiresAt) <= Date.now()) {
      delivery.abort(new Error("Foundry transmission call timed out."));
      return;
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
  }
}

/** Wait inside the agent process for the parent-owned adapter result. */
export async function waitForFoundryCoreCommandResult(
  directory: string,
  request: FoundryCoreCommandRequest,
  signal: AbortSignal,
  options: { readonly cleanup?: boolean } = {},
): Promise<unknown> {
  for (;;) {
    const result = resultRecord(
      await readJson(commandPath(directory, request.id, RESULT_SUFFIX)),
    );
    if (result) {
      if (options.cleanup) await cleanupFoundryCoreCommandRequest(directory, request.id);
      if (result.status === "error") throw new Error(result.error);
      return result.output;
    }
    if (signal.aborted) {
      await cancelFoundryCoreCommandRequest(directory, request.id, "cancelled");
      throw new Error("Foundry transmission call was cancelled.");
    }
    if (Date.parse(request.expiresAt) <= Date.now()) {
      await cancelFoundryCoreCommandRequest(directory, request.id, "expired");
      throw new Error("Foundry transmission call timed out.");
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
  }
}

/** Remove a settled private bridge exchange; cancellation records stay until runtime cleanup. */
export async function cleanupFoundryCoreCommandRequest(directory: string, id: string): Promise<void> {
  await Promise.all([
    REQUEST_SUFFIX,
    CLAIM_SUFFIX,
    RESULT_SUFFIX,
    CANCELLATION_SUFFIX,
  ].map(async (suffix) => {
    try {
      await unlink(commandPath(directory, id, suffix));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  }));
}
