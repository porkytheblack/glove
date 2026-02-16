import type { ModelAdapter, StoreAdapter } from "@glove/core/core";
import type { ToolConfig, CompactionConfig } from "./types";
import type { SubscriberAdapter } from "@glove/core/core";
import { MemoryStore } from "./adapters/memory-store";
import { createEndpointModel } from "./adapters/endpoint-model";

// ─── Config ─────────────────────────────────────────────────────────────────

export interface GloveClientConfig {
  /** Chat endpoint URL (e.g. "/api/chat"). Each session creates its own endpoint model. */
  endpoint?: string;

  /** Factory to create a ModelAdapter per session. Overrides endpoint. */
  createModel?: () => ModelAdapter;

  /** Factory to create a StoreAdapter per session. Defaults to MemoryStore. */
  createStore?: (sessionId: string) => StoreAdapter;

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

  /** @internal Defaults consumed by useGlove */
  readonly systemPrompt?: string;
  readonly tools?: ToolConfig[];
  readonly compaction?: CompactionConfig;
  readonly subscribers?: SubscriberAdapter[];

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

    this.systemPrompt = config.systemPrompt;
    this.tools = config.tools;
    this.compaction = config.compaction;
    this.subscribers = config.subscribers;
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
}
