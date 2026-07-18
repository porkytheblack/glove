// ─── Session helpers ─────────────────────────────────────────────────────────
//
// Small, dependency-free utilities behind useGlove's session management:
// id generation and (opt-in) localStorage persistence of the active session.

/** Persistence setting shared by `GloveClientConfig` and `UseGloveConfig`. */
export type PersistSessionSetting = boolean | { storageKey?: string };

export const DEFAULT_SESSION_STORAGE_KEY = "glove:session";

/**
 * Generate a fresh, collision-safe session ID (`glove_<uuid>`).
 *
 * Used automatically by `useGlove` when no `sessionId` / `getSessionId` /
 * `store` is configured, and by `newConversation()` when no
 * `createSessionId` factory is set. Exported so apps can mint ids with the
 * same shape (e.g. when creating the session server-side first).
 */
export function generateSessionId(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `glove_${uuid}`;
}

/** Resolve the storage key from a persistence setting. */
export function resolveSessionStorageKey(
  setting: PersistSessionSetting | undefined,
): string {
  if (setting && typeof setting === "object" && setting.storageKey) {
    return setting.storageKey;
  }
  return DEFAULT_SESSION_STORAGE_KEY;
}

/** Read the persisted session id, if any. Safe on the server (returns null). */
export function readPersistedSession(storageKey: string): string | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage.getItem(storageKey);
  } catch {
    return null; // private mode / storage disabled
  }
}

/** Persist the active session id. Safe on the server (no-op). */
export function writePersistedSession(storageKey: string, sessionId: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(storageKey, sessionId);
  } catch {
    // private mode / storage disabled — persistence silently unavailable
  }
}
