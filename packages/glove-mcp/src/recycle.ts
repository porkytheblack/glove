import type { ConnectedMcpServerConnection } from "./connect.js";

export interface McpRecyclePolicy {
  /** Close after this much inactivity; 0 disables idle recycling. */
  readonly idleTimeoutMs?: number;
  /** Close after this total connection age; 0 disables lifetime recycling. */
  readonly maxLifetimeMs?: number;
}

export interface RecyclableMcpConnectionOptions extends McpRecyclePolicy {
  readonly initial: ConnectedMcpServerConnection;
  readonly open: () => Promise<ConnectedMcpServerConnection>;
  /** Test seam; production uses Date.now. */
  readonly now?: () => number;
}

function interval(value: number | undefined, field: string): number {
  const resolved = value ?? 0;
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > 2_147_483_647) {
    throw new Error(`${field} must be a non-negative integer no greater than 2147483647ms.`);
  }
  return resolved;
}

export function validateMcpRecyclePolicy(policy: McpRecyclePolicy): {
  idleTimeoutMs: number;
  maxLifetimeMs: number;
} {
  return {
    idleTimeoutMs: interval(policy.idleTimeoutMs, "idleTimeoutMs"),
    maxLifetimeMs: interval(policy.maxLifetimeMs, "maxLifetimeMs"),
  };
}

/**
 * Wrap a stdio connection with transparent idle/lifetime recycling.
 *
 * Lifecycle transitions are serialized, normal operations remain concurrent,
 * and retirement waits until every in-flight operation has released its lease.
 */
export function recyclableMcpConnection(
  options: RecyclableMcpConnectionOptions,
): ConnectedMcpServerConnection {
  const { idleTimeoutMs, maxLifetimeMs } = validateMcpRecyclePolicy(options);
  const now = options.now ?? Date.now;

  let current: ConnectedMcpServerConnection | undefined = options.initial;
  let lastKnown = options.initial;
  let connectedAt = now();
  let lastUsedAt = connectedAt;
  let activeOperations = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lifecycle: Promise<void> = Promise.resolve();
  const idleWaiters = new Set<() => void>();
  const toolChangeHandlers = new Set<() => void | Promise<void>>();
  const forwardToolChange = () => Promise.allSettled(
    [...toolChangeHandlers].map((handler) => handler()),
  ).then(() => undefined);
  let unsubscribeToolChanges = options.initial.onToolsChanged?.(forwardToolChange);

  const detachToolChanges = () => {
    unsubscribeToolChanges?.();
    unsubscribeToolChanges = undefined;
  };

  const attachToolChanges = (connection: ConnectedMcpServerConnection) => {
    detachToolChanges();
    unsubscribeToolChanges = connection.onToolsChanged?.(forwardToolChange);
  };

  const locked = <T>(task: () => Promise<T>): Promise<T> => {
    const result = lifecycle.then(task, task);
    lifecycle = result.then(() => undefined, () => undefined);
    return result;
  };

  const due = () => current !== undefined && (
    (idleTimeoutMs > 0 && now() - lastUsedAt >= idleTimeoutMs)
    || (maxLifetimeMs > 0 && now() - connectedAt >= maxLifetimeMs)
  );

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = () => {
    clearTimer();
    if (closed || !current || activeOperations > 0) return;
    const deadlines = [
      idleTimeoutMs > 0 ? lastUsedAt + idleTimeoutMs : Number.POSITIVE_INFINITY,
      maxLifetimeMs > 0 ? connectedAt + maxLifetimeMs : Number.POSITIVE_INFINITY,
    ];
    const deadline = Math.min(...deadlines);
    if (!Number.isFinite(deadline)) return;
    timer = setTimeout(() => {
      void locked(async () => {
        if (!closed && activeOperations === 0 && due() && current) {
          const retiring = current;
          current = undefined;
          clearTimer();
          detachToolChanges();
          await retiring.close();
        } else {
          schedule();
        }
      }).catch(() => undefined);
    }, Math.max(1, deadline - now()));
    timer.unref?.();
  };

  const acquire = async (): Promise<ConnectedMcpServerConnection> => locked(async () => {
    if (closed) throw new Error("MCP connection is closed.");
    if (due() && current && activeOperations === 0) {
      const retiring = current;
      current = undefined;
      clearTimer();
      detachToolChanges();
      await retiring.close();
    }
    if (!current) {
      current = await options.open();
      lastKnown = current;
      attachToolChanges(current);
      connectedAt = now();
      lastUsedAt = connectedAt;
    }
    activeOperations += 1;
    clearTimer();
    return current;
  });

  const release = async () => locked(async () => {
    activeOperations = Math.max(0, activeOperations - 1);
    lastUsedAt = now();
    if (activeOperations === 0) {
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
      schedule();
    }
  });

  const run = async <T>(
    operation: (connection: ConnectedMcpServerConnection) => Promise<T>,
  ): Promise<T> => {
    const connection = await acquire();
    try {
      return await operation(connection);
    } finally {
      await release();
    }
  };

  schedule();

  return {
    namespace: options.initial.namespace,
    get raw() { return (current ?? lastKnown).raw; },
    get capabilities() { return (current ?? lastKnown).capabilities; },
    onToolsChanged(handler) {
      toolChangeHandlers.add(handler);
      return () => toolChangeHandlers.delete(handler);
    },
    listTools: () => run((connection) => connection.listTools()),
    callTool: (name, args) => run((connection) => connection.callTool(name, args)),
    listResources: (cursor) => run((connection) => connection.listResources(cursor)),
    readResource: (uri) => run((connection) => connection.readResource(uri)),
    listPrompts: (cursor) => run((connection) => connection.listPrompts(cursor)),
    getPrompt: (name, args) => run((connection) => connection.getPrompt(name, args)),
    async close() {
      closed = true;
      clearTimer();
      toolChangeHandlers.clear();
      detachToolChanges();
      if (activeOperations > 0) {
        await new Promise<void>((resolve) => idleWaiters.add(resolve));
      }
      await locked(async () => {
        const retiring = current;
        current = undefined;
        if (retiring) await retiring.close();
      });
    },
  };
}
