import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface ProviderGateWait {
  readonly waitedMs: number;
  readonly gate: string;
}

export interface ProviderGateRunOptions {
  readonly signal?: AbortSignal;
  readonly onQueued?: (wait: ProviderGateWait) => void;
}

export interface ProviderGate {
  readonly name: string;
  readonly run: <T>(operation: () => Promise<T>, options?: ProviderGateRunOptions) => Promise<T>;
}

export interface FileProviderGateOptions {
  readonly name: string;
  readonly lockPath: string;
  readonly minimumIntervalMs?: number;
  readonly staleAfterMs?: number;
  readonly pollMs?: number;
}

function abortError(): Error {
  const error = new Error("Provider wait was aborted.");
  error.name = "AbortError";
  return error;
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAlreadyExists(cause: unknown): boolean {
  return Boolean(cause && typeof cause === "object" && (cause as { code?: unknown }).code === "EEXIST");
}

async function stealStaleLock(lockPath: string, staleAfterMs: number): Promise<void> {
  try {
    const current = await stat(lockPath);
    if (Date.now() - current.mtimeMs < staleAfterMs) return;
    const stalePath = `${lockPath}.stale-${randomUUID()}`;
    await rename(lockPath, stalePath);
    await rm(stalePath, { recursive: true, force: true });
  } catch {
    // Another process released or recovered the lock first.
  }
}

/**
 * A small host adapter for provider admission. Atomic directory creation makes
 * the lease work across Foundry subprocesses without moving credentials or
 * quota policy into agent definitions.
 */
export function fileProviderGate(options: FileProviderGateOptions): ProviderGate {
  const minimumIntervalMs = Math.max(0, options.minimumIntervalMs ?? 8_000);
  const staleAfterMs = Math.max(30_000, options.staleAfterMs ?? 180_000);
  const pollMs = Math.max(50, options.pollMs ?? 250);
  return {
    name: options.name,
    async run<T>(operation: () => Promise<T>, runOptions: ProviderGateRunOptions = {}): Promise<T> {
      await mkdir(dirname(options.lockPath), { recursive: true });
      const queuedAt = Date.now();
      let announced = false;
      for (;;) {
        if (runOptions.signal?.aborted) throw abortError();
        try {
          await mkdir(options.lockPath);
          break;
        } catch (cause) {
          if (!isAlreadyExists(cause)) throw cause;
          await stealStaleLock(options.lockPath, staleAfterMs);
          const waitedMs = Date.now() - queuedAt;
          if (!announced && waitedMs >= 750) {
            announced = true;
            runOptions.onQueued?.({ waitedMs, gate: options.name });
          }
          await abortableDelay(pollMs + Math.floor(Math.random() * Math.min(150, pollMs)), runOptions.signal);
        }
      }

      try {
        return await operation();
      } finally {
        if (!runOptions.signal?.aborted && minimumIntervalMs > 0) {
          await abortableDelay(minimumIntervalMs).catch(() => undefined);
        }
        await rm(options.lockPath, { recursive: true, force: true });
      }
    },
  };
}

function errorChain(cause: unknown): ReadonlyArray<unknown> {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = cause;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    if (!current || typeof current !== "object") break;
    current = (current as { error?: unknown; cause?: unknown }).error
      ?? (current as { cause?: unknown }).cause;
  }
  return chain;
}

export function providerErrorMessage(cause: unknown): string {
  for (const item of errorChain(cause)) {
    if (item instanceof Error && item.message) return item.message;
    if (typeof item === "string" && item) return item;
  }
  return String(cause);
}

export function providerErrorStatus(cause: unknown): number | undefined {
  for (const item of errorChain(cause)) {
    if (!item || typeof item !== "object") continue;
    const status = (item as { status?: unknown; statusCode?: unknown }).status
      ?? (item as { statusCode?: unknown }).statusCode;
    if (typeof status === "number") return status;
  }
  const match = providerErrorMessage(cause).match(/\b([45]\d\d)\b/);
  return match ? Number(match[1]) : undefined;
}

export function isRetryableProviderError(cause: unknown): boolean {
  const status = providerErrorStatus(cause);
  if (status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500)) return true;
  return /rate|quota|timeout|timed out|connection|empty|visible output|temporar|overload/i.test(providerErrorMessage(cause));
}

function retryAfterMs(cause: unknown): number | undefined {
  for (const item of errorChain(cause)) {
    if (!item || typeof item !== "object") continue;
    const headers = (item as { headers?: { get?: (name: string) => string | null } }).headers;
    const value = headers?.get?.("retry-after");
    if (!value) continue;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(value);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return undefined;
}

/** `failedAttempt` is one-based: 1 means the first request just failed. */
export function providerRetryDelayMs(cause: unknown, failedAttempt: number): number {
  const headerDelay = retryAfterMs(cause);
  if (headerDelay !== undefined) return Math.min(120_000, headerDelay + 500);
  const base = providerErrorStatus(cause) === 429 ? 15_000 : 5_000;
  const exponential = Math.min(60_000, base * 2 ** Math.max(0, failedAttempt - 1));
  return exponential + Math.floor(Math.random() * 1_500);
}
