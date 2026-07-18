import type { ModelAdapter, StoreAdapter } from "glove-core/core";
import type { ToolConfig, CompactionConfig } from "./types";
import type { SubscriberAdapter } from "glove-core/core";
import { MemoryStore } from "./adapters/memory-store";
import { createEndpointModel } from "./adapters/endpoint-model";
import { generateSessionId, type PersistSessionSetting } from "./session";

// ─── Config ─────────────────────────────────────────────────────────────────

export interface GloveClientConfig {
  /** Chat endpoint URL (e.g. "/api/chat"). Each session creates its own endpoint model. */
  endpoint?: string;

  /** Factory to create a ModelAdapter per session. Overrides endpoint. */
  createModel?: () => ModelAdapter;

  /** Factory to create a StoreAdapter per session. Defaults to MemoryStore. */
  createStore?: (sessionId: string) => StoreAdapter;

  /**
   * Async function to fetch a session ID (e.g. from the backend).
   * When provided, the hook will call this instead of using a passed-in
   * or auto-generated sessionId. The resolved ID is then forwarded to `createStore`.
   */
  getSessionId?: () => Promise<string>;

  /**
   * Factory used by `newConversation()` to mint a fresh session ID —
   * e.g. create the session on your backend and return its id.
   * Defaults to a locally generated `glove_<uuid>`.
   */
  createSessionId?: () => string | Promise<string>;

  /**
   * Persist the active session ID in `localStorage` so a page reload
   * resumes the same conversation (pair with a persistent store such as
   * `createRemoteStore`). Pass `true` for the default storage key
   * (`"glove:session"`), or `{ storageKey }` to customize — e.g. a
   * per-user key. Off by default.
   */
  persistSession?: PersistSessionSetting;

  /** System prompt for the agent. Can be overridden per-hook. */
  systemPrompt?: string;

  /** Tools available to the agent. Can be overridden per-hook. */
  tools?: ToolConfig[];

  /** Compaction config. Can be overridden per-hook. */
  compaction?: CompactionConfig;

  /** Extra subscribers beyond the built-in state tracker. Can be overridden per-hook. */
  subscribers?: SubscriberAdapter[];
}

// ─── Client ─────────────────────────────────────────────────────────────────

/**
 * Central configuration object for Glove — created once, provided to `GloveProvider`.
 *
 * ```ts
 * // Simple — endpoint mode
 * const client = new GloveClient({ endpoint: "/api/chat" });
 *
 * // Advanced — custom model + store
 * const client = new GloveClient({
 *   createModel: () => myModelAdapter,
 *   createStore: (sid) => createRemoteStore(sid, actions),
 * });
 * ```
 */
export class GloveClient {
  private _endpoint?: string;
  private _createModel?: () => ModelAdapter;
  private _createStore: (sessionId: string) => StoreAdapter;
  private _getSessionId?: () => Promise<string>;
  private _createSessionId?: () => string | Promise<string>;

  /** @internal Defaults consumed by useGlove */
  readonly systemPrompt?: string;
  readonly tools?: ToolConfig[];
  readonly compaction?: CompactionConfig;
  readonly subscribers?: SubscriberAdapter[];
  readonly persistSession?: PersistSessionSetting;

  constructor(config: GloveClientConfig) {
    if (!config.endpoint && !config.createModel) {
      throw new Error(
        "GloveClient requires either 'endpoint' or 'createModel'",
      );
    }
    this._endpoint = config.endpoint;
    this._createModel = config.createModel;
    this._createStore =
      config.createStore ?? ((sid) => new MemoryStore(sid));
    this._getSessionId = config.getSessionId;
    this._createSessionId = config.createSessionId;

    this.systemPrompt = config.systemPrompt;
    this.tools = config.tools;
    this.compaction = config.compaction;
    this.subscribers = config.subscribers;
    this.persistSession = config.persistSession;
  }

  /** @internal Called by useGlove to create a model adapter per session. */
  resolveModel(): ModelAdapter {
    if (this._createModel) return this._createModel();
    return createEndpointModel(this._endpoint!);
  }

  /** @internal Called by useGlove to create a store per session. */
  resolveStore(sessionId: string): StoreAdapter {
    return this._createStore(sessionId);
  }

  /** @internal Returns the async getSessionId function, if configured. */
  get getSessionId(): (() => Promise<string>) | undefined {
    return this._getSessionId;
  }

  /** @internal Mints a fresh session ID for `newConversation()`. */
  async mintSessionId(): Promise<string> {
    if (this._createSessionId) return this._createSessionId();
    return generateSessionId();
  }
}
