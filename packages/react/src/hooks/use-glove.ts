"use client";

import { useState, useMemo, useCallback, useRef, useEffect, createElement, type Dispatch, type SetStateAction, type ReactNode } from "react";
import type {
  StoreAdapter,
  ModelAdapter,
  SubscriberAdapter,
  SubscriberEvent,
  SubscriberEventDataMap,
  ContentPart,
  Message,
} from "glove-core/core";
import { Glove } from "glove-core/glove";
import { Displaymanager } from "glove-core/display-manager";
import type {
  GloveState,
  ToolConfig,
  CompactionConfig,
  SlotRenderProps,
  ToolResultRenderProps,
  TimelineEntry,
  EnhancedSlot,
  SlotDisplayStrategy,
  IGloveRunnable,
} from "../types";
import type { Slot } from "glove-core/display-manager";
import { MemoryStore } from "../adapters/memory-store";
import { createEndpointModel } from "../adapters/endpoint-model";
import { useGloveClient } from "./context";
import {
  generateSessionId,
  readPersistedSession,
  resolveSessionStorageKey,
  writePersistedSession,
  type PersistSessionSetting,
} from "../session";

// ─── Config & return types ───────────────────────────────────────────────────

export interface UseGloveConfig {
  // ── Simple endpoint mode ─────────────────────────────────────────────────
  /** URL of the chat handler endpoint (e.g. "/api/chat"). Auto-creates store + model. */
  endpoint?: string;
  /**
   * Session ID. Auto-generated if omitted (a fresh `glove_<uuid>`).
   * Reactive: passing a *different* value later switches the hook to that
   * conversation in place — no remount/`key` tricks needed. Equivalent to
   * calling `switchConversation(id)`.
   */
  sessionId?: string;
  /**
   * Async function to fetch a session ID (e.g. from the backend).
   * Overrides `sessionId` when provided. Falls back to `GloveClient.getSessionId`.
   */
  getSessionId?: () => Promise<string>;
  /**
   * Persist the active session ID in `localStorage` so a reload resumes the
   * same conversation (pair with a persistent store). `true` for the default
   * key (`"glove:session"`) or `{ storageKey }` to customize. Falls back to
   * `GloveClient.persistSession`. Off by default.
   */
  persistSession?: PersistSessionSetting;
  /**
   * Called whenever the active session ID resolves or changes — initial
   * async resolution, `newConversation()`, `switchConversation()`, or a
   * `sessionId` prop change. Useful for syncing tabs/URL state.
   */
  onSessionChange?: (sessionId: string) => void;

  // ── Advanced mode (explicit adapters) ────────────────────────────────────
  store?: StoreAdapter;
  model?: ModelAdapter;

  // ── Agent config (all optional — falls back to GloveClient defaults) ───
  systemPrompt?: string;
  tools?: ToolConfig[];
  compaction?: CompactionConfig;
  /** Extra subscribers beyond the built-in state tracker */
  subscribers?: SubscriberAdapter[];
}

export interface UseGloveReturn extends GloveState {
  /** The underlying Glove runnable. Pass to useGloveVoice or use directly.
   *  `null` until the Glove instance is built (first render) or while waiting
   *  for an async `getSessionId` to resolve. */
  runnable: IGloveRunnable | null;
  /** `false` while an async `getSessionId` is still resolving. Always `true` when
   *  no async session ID fetcher is configured. */
  sessionReady: boolean;
  /** The resolved session ID (empty string while an async `getSessionId` resolves). */
  sessionId: string;
  /**
   * Start a fresh conversation in place — no remount needed. Mints a new
   * session ID (explicit `sessionId` argument → `GloveClient.createSessionId`
   * → generated `glove_<uuid>`), aborts any in-flight request, resets the
   * timeline, and rebuilds the store/agent for the new session. Returns the
   * new session ID.
   *
   * Unavailable when an explicit `store` was passed to the hook (the store
   * owns the session in that mode).
   */
  newConversation: (sessionId?: string) => Promise<string>;
  /**
   * Switch to an existing conversation by session ID — aborts any in-flight
   * request, rebuilds the store for that session, and rehydrates its
   * timeline. No remount/`key` tricks needed.
   *
   * Unavailable when an explicit `store` was passed to the hook.
   */
  switchConversation: (sessionId: string) => void;
  sendMessage: (
    text: string,
    images?: Array<{ data: string; media_type: string }>,
  ) => void;
  abort: () => void;
  resolveSlot: (slotId: string, value: unknown) => void;
  rejectSlot: (slotId: string, reason?: string) => void;
  /** Renders a slot using the colocated `render` from its tool. Returns `null`
   *  if no renderer is registered for the slot's renderer key. */
  renderSlot: (slot: EnhancedSlot) => ReactNode;
  /** Renders a completed tool result from the timeline using `renderResult`.
   *  Uses `renderData` to show a read-only view (e.g. after reload when the
   *  interactive pushAndWait slot is gone). Returns `null` if no `renderResult`
   *  is registered or if the entry has no `renderData`. */
  renderToolResult: (entry: TimelineEntry & { kind: "tool" }) => ReactNode;
}

// ─── Internal subscriber ─────────────────────────────────────────────────────

/**
 * Bridges core SDK events into React state updates.
 *
 * Uses a streaming text buffer (ref) to avoid micro-renders on every
 * text_delta, flushing to timeline only when a tool call or request
 * completes.
 */
class ReactSubscriber implements SubscriberAdapter {
  private streamBuffer = "";
  private toolIdCounter = 0;
  private setState: Dispatch<SetStateAction<GloveState>>;
  private _currentToolCall: { id: string; name: string } | null = null;

  constructor(setState: Dispatch<SetStateAction<GloveState>>) {
    this.setState = setState;
  }

  getCurrentToolCall(): { id: string; name: string } | null {
    return this._currentToolCall;
  }

  getStreamBuffer(): string {
    return this.streamBuffer;
  }

  resetStreamBuffer(): void {
    this.streamBuffer = "";
  }

  /** Flush accumulated stream text to the timeline as an agent_text entry */
  flushStreamToTimeline(): void {
    const text = this.streamBuffer.trim();
    if (!text) return;
    this.streamBuffer = "";
    this.setState((s) => ({
      ...s,
      streamingText: "",
      timeline: [...s.timeline, { kind: "agent_text", text }],
    }));
  }

  async record<T extends SubscriberEvent["type"]>(event_type: T, data: SubscriberEventDataMap[T]): Promise<void> {
    // Cast to the specific event data type within each branch.
    // TypeScript cannot narrow generic mapped types via switch, but
    // the discriminant guarantees correctness at runtime.
    const d = data as SubscriberEventDataMap[typeof event_type];
    switch (event_type) {
      case "text_delta": {
        const e = d as SubscriberEventDataMap["text_delta"];
        this.streamBuffer += e.text;
        this.setState((s) => ({
          ...s,
          streamingText: this.streamBuffer,
        }));
        break;
      }

      case "tool_use": {
        const e = d as SubscriberEventDataMap["tool_use"];
        // Track current tool call for slot enhancement
        this._currentToolCall = { id: e.id ?? `tool_${this.toolIdCounter + 1}`, name: e.name };

        // Flush pending text before the tool entry
        const flushed = this.streamBuffer.trim();
        this.streamBuffer = "";
        const toolId = `tool_${++this.toolIdCounter}`;

        this.setState((s) => {
          const tl = [...s.timeline];
          if (flushed) tl.push({ kind: "agent_text", text: flushed });
          tl.push({
            kind: "tool",
            id: e.id ?? toolId,
            name: e.name,
            input: e.input,
            status: "running",
          });
          return { ...s, timeline: tl, streamingText: "" };
        });
        break;
      }

      case "tool_use_result": {
        const e = d as SubscriberEventDataMap["tool_use_result"];
        this._currentToolCall = null;

        this.setState((s) => {
          const timeline = s.timeline.map((entry) =>
            entry.kind === "tool" && entry.id === e.call_id
              ? {
                  ...entry,
                  status: (e.result.status as "success" | "error" | "aborted"),
                  output:
                    e.result.data != null
                      ? String(e.result.data)
                      : e.result.message,
                  ...(e.result.renderData !== undefined
                    ? { renderData: e.result.renderData }
                    : {}),
                }
              : entry,
          );

          // Detect task updates from glove_update_tasks tool
          let tasks = s.tasks;
          if (
            e.tool_name === "glove_update_tasks" &&
            e.result?.status === "success" &&
            (e.result?.data as any)?.tasks
          ) {
            tasks = (e.result.data as any).tasks;
          }

          return { ...s, timeline, tasks };
        });
        break;
      }

      case "model_response":
      case "model_response_complete": {
        // Count the turn here; token + cache totals come from the canonical
        // `token_consumption` event below so they aren't double-counted.
        this.setState((s) => ({
          ...s,
          stats: { ...s.stats, turns: s.stats.turns + 1 },
        }));
        break;
      }

      case "token_consumption": {
        const e = d as SubscriberEventDataMap["token_consumption"];
        const c = e.consumption;
        this.setState((s) => ({
          ...s,
          stats: {
            ...s.stats,
            tokens_in: s.stats.tokens_in + (c.tokens_in ?? 0),
            tokens_out: s.stats.tokens_out + (c.tokens_out ?? 0),
            cache_creation_input_tokens:
              s.stats.cache_creation_input_tokens +
              (c.cache_creation_input_tokens ?? 0),
            cache_read_input_tokens:
              s.stats.cache_read_input_tokens +
              (c.cache_read_input_tokens ?? 0),
          },
        }));
        break;
      }

      case "compaction_start":
        this.setState((s) => ({ ...s, isCompacting: true }));
        break;

      case "compaction_end":
        this.setState((s) => ({ ...s, isCompacting: false }));
        break;
    }
  }
}

// ─── Message → Timeline conversion ───────────────────────────────────────────

/**
 * Converts stored messages into timeline entries for hydrating the UI on reload.
 * Matches tool_calls with their tool_results to reconstruct completed tool entries
 * (including `renderData` for post-renderers).
 */
function messagesToTimeline(messages: Message[]): TimelineEntry[] {
  // Build a lookup of call_id → tool result for matching
  const resultsByCallId = new Map<string, { status: string; data: unknown; message?: string; renderData?: unknown }>();
  for (const msg of messages) {
    if (!msg.tool_results) continue;
    for (const tr of msg.tool_results) {
      if (tr.call_id) {
        resultsByCallId.set(tr.call_id, tr.result);
      }
    }
  }

  const timeline: TimelineEntry[] = [];

  for (const msg of messages) {
    if (msg.sender === "user") {
      // Skip synthetic "tool results" messages
      if (msg.tool_results) continue;

      const images = msg.content
        ?.filter((p) => p.type === "image" && p.source)
        .map((p) =>
          p.source!.type === "url"
            ? p.source!.url!
            : `data:${p.source!.media_type};base64,${p.source!.data}`,
        );

      timeline.push({
        kind: "user",
        text: msg.text,
        ...(images?.length ? { images } : {}),
      });
    } else if (msg.sender === "agent") {
      // Agent text (before any tool calls)
      if (msg.text) {
        timeline.push({ kind: "agent_text", text: msg.text });
      }

      // Tool calls
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const result = tc.id ? resultsByCallId.get(tc.id) : undefined;
          const entry: TimelineEntry = {
            kind: "tool",
            id: tc.id ?? `tool_${Math.random().toString(36).slice(2)}`,
            name: tc.tool_name,
            input: tc.input_args,
            status: result
              ? (result.status as "success" | "error" | "aborted")
              : "running",
            output: result
              ? result.data != null
                ? String(result.data)
                : result.message
              : undefined,
            ...(result?.renderData !== undefined
              ? { renderData: result.renderData }
              : {}),
          };
          timeline.push(entry);
        }
      }
    }
  }

  return timeline;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Main React hook for managing a Glove agent instance.
 *
 * **Zero-config** — everything in the client, nothing in the hook:
 * ```tsx
 * const client = new GloveClient({ endpoint: "/api/chat", systemPrompt: "...", tools });
 * <GloveProvider client={client}><App /></GloveProvider>
 *
 * // any component
 * const { timeline, sendMessage, busy } = useGlove();
 * ```
 *
 * **Standalone** — no provider needed:
 * ```tsx
 * const { timeline, sendMessage, busy } = useGlove({
 *   endpoint: "/api/chat",
 *   systemPrompt: "You are a helpful assistant.",
 *   tools,
 * });
 * ```
 *
 * Hook-level config overrides client defaults for any field.
 */
export function useGlove(config?: UseGloveConfig): UseGloveReturn {
  const client = useGloveClient();

  // ── Resolve everything (hook config → client defaults → error) ─────────

  const systemPrompt = config?.systemPrompt ?? client?.systemPrompt;
  if (!systemPrompt) {
    throw new Error("useGlove requires 'systemPrompt' (via config or GloveClient)");
  }

  const tools = config?.tools ?? client?.tools;
  const compaction = config?.compaction ?? client?.compaction;
  const subscribers = config?.subscribers ?? client?.subscribers;

  const getSessionId = config?.getSessionId ?? client?.getSessionId;
  const hasExternalStore = !!config?.store;

  // ── Session resolution ───────────────────────────────────────────────────
  //
  // Zero-config: with no `sessionId` / `getSessionId` / `store`, a fresh
  // `glove_<uuid>` is generated (or, with `persistSession`, the previous one
  // is restored from localStorage) — the hook is usable immediately.
  //
  // Priority: explicit `store` > `getSessionId` (async) > `sessionId` prop >
  // persisted session > auto-generated.

  const persistSetting: PersistSessionSetting | undefined =
    config?.persistSession ?? client?.persistSession;
  const persistEnabled = !!persistSetting && !hasExternalStore;
  const persistKey = resolveSessionStorageKey(persistSetting);

  const [session, setSession] = useState<string | null>(() => {
    if (config?.store) return config.store.identifier;
    if (getSessionId) return null; // async — resolves in the effect below
    if (config?.sessionId) return config.sessionId;
    if (persistEnabled) {
      const persisted = readPersistedSession(persistKey);
      if (persisted) return persisted;
    }
    return generateSessionId();
  });

  // True once the session has been changed imperatively (newConversation /
  // switchConversation) — a late-resolving getSessionId must not clobber it.
  const imperativeOverrideRef = useRef(false);

  // Async session ID resolution (re-runs when the fetcher identity changes,
  // e.g. a consumer hands a new fetcher for a "new chat" action).
  useEffect(() => {
    if (!getSessionId || hasExternalStore) return;
    imperativeOverrideRef.current = false;
    let cancelled = false;
    getSessionId().then((id) => {
      if (!cancelled && !imperativeOverrideRef.current) setSession(id);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSessionId, hasExternalStore]);

  // Reactive `sessionId` prop: adopting a *changed* prop value switches the
  // conversation in place. (Ignored while `getSessionId` is configured —
  // the async fetcher is the source of truth, matching previous behavior.)
  const propSessionRef = useRef(config?.sessionId);
  useEffect(() => {
    if (getSessionId || hasExternalStore) return;
    const prop = config?.sessionId;
    if (prop && prop !== propSessionRef.current) {
      propSessionRef.current = prop;
      setSession(prop);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.sessionId, getSessionId, hasExternalStore]);

  const sessionId = session ?? "";

  const store = useMemo(() => {
    if (config?.store) return config.store;
    // Don't create the real store until the async session ID resolves
    if (!session) return null;
    if (client) return client.resolveStore(session);
    return new MemoryStore(session);
  }, [config?.store, client, session]);

  // Persist the active session + notify the consumer when it changes.
  const onSessionChangeRef = useRef(config?.onSessionChange);
  onSessionChangeRef.current = config?.onSessionChange;
  const lastNotifiedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session) return;
    if (persistEnabled) writePersistedSession(persistKey, session);
    if (lastNotifiedSessionRef.current !== session) {
      lastNotifiedSessionRef.current = session;
      onSessionChangeRef.current?.(session);
    }
  }, [session, persistEnabled, persistKey]);

  const model = useMemo(() => {
    if (config?.model) return config.model;
    if (config?.endpoint) return createEndpointModel(config.endpoint);
    if (client) return client.resolveModel();
    throw new Error(
      "useGlove requires a GloveProvider, 'endpoint', or 'model'",
    );
  }, [config?.model, config?.endpoint, client]);

  const [state, setState] = useState<GloveState>({
    busy: false,
    isCompacting: false,
    timeline: [],
    streamingText: "",
    tasks: [],
    inbox: [],
    slots: [],
    stats: {
      turns: 0,
      tokens_in: 0,
      tokens_out: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });

  // Runnable exposed for external consumers (e.g. useGloveVoice)
  const [runnable, setRunnable] = useState<IGloveRunnable | null>(null);

  // Refs that persist across renders
  const gloveRef = useRef<ReturnType<Glove["build"]> | null>(null);
  const dmRef = useRef<Displaymanager | null>(null);
  const subscriberRef = useRef<ReactSubscriber | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Slot metadata: tracks enhanced info for each slot by ID
  const slotMetaRef = useRef(new Map<string, {
    toolName: string;
    toolCallId: string;
    createdAt: number;
    displayStrategy: SlotDisplayStrategy;
  }>());

  // Display strategy map: toolName → displayStrategy
  const displayStrategiesRef = useRef(new Map<string, SlotDisplayStrategy>());
  useEffect(() => {
    const map = new Map<string, SlotDisplayStrategy>();
    if (tools) {
      for (const tool of tools) {
        if (tool.displayStrategy) map.set(tool.name, tool.displayStrategy);
      }
    }
    displayStrategiesRef.current = map;
  }, [tools]);

  // ── Build Glove instance (once, or when key config changes) ──────────────

  useEffect(() => {
    // Wait for async session ID to resolve before building
    if (!store) return;

    const dm = new Displaymanager();
    dmRef.current = dm;

    const reactSub = new ReactSubscriber(setState);
    subscriberRef.current = reactSub;

    const builder = new Glove({
      store,
      model,
      displayManager: dm,
      systemPrompt,
      compaction_config: compaction ?? {
        compaction_instructions:
          "Summarize the conversation. Preserve key context, decisions, and state.",
      },
    });

    // Register tools — for tools with `render`, auto-default renderer to tool name
    if (tools) {
      for (const tool of tools) {
        if (tool.render) {
          builder.fold({
            ...tool,
            do: (input: any, display: any) => {
              const wrapped = {
                ...display,
                pushAndWait: (opts: any) =>
                  display.pushAndWait({ renderer: tool.name, ...opts }),
                pushAndForget: (opts: any) =>
                  display.pushAndForget({ renderer: tool.name, ...opts }),
              };
              return tool.do(input, wrapped);
            },
          });
        } else {
          builder.fold(tool as any);
        }
      }
    }

    // Register subscribers
    builder.addSubscriber(reactSub);
    if (subscribers) {
      for (const sub of subscribers) {
        builder.addSubscriber(sub);
      }
    }

    const built = builder.build();
    gloveRef.current = built;
    setRunnable(built);

    // Subscribe to DisplayManager for slot updates — enhance raw slots
    const unsubDm = dm.subscribe(async (stack: Slot<unknown>[]) => {
      const activeIds = new Set(stack.map((s) => s.id));

      // Enhance new slots with metadata
      for (const rawSlot of stack) {
        if (!slotMetaRef.current.has(rawSlot.id)) {
          const currentCall = reactSub.getCurrentToolCall();
          slotMetaRef.current.set(rawSlot.id, {
            toolName: currentCall?.name ?? rawSlot.renderer,
            toolCallId: currentCall?.id ?? "",
            createdAt: Date.now(),
            displayStrategy: displayStrategiesRef.current.get(rawSlot.renderer) ?? "stay",
          });
        }
      }

      // Clean up metadata for removed slots
      for (const [id] of slotMetaRef.current) {
        if (!activeIds.has(id)) slotMetaRef.current.delete(id);
      }

      // Build enhanced slot array
      const enhanced: EnhancedSlot[] = stack.map((rawSlot) => {
        const meta = slotMetaRef.current.get(rawSlot.id)!;
        return {
          ...rawSlot,
          toolName: meta.toolName,
          toolCallId: meta.toolCallId,
          createdAt: meta.createdAt,
          displayStrategy: meta.displayStrategy,
          status: "pending" as const,
        };
      });

      setState((s) => ({ ...s, slots: enhanced }));
    });

    return () => {
      unsubDm();
      abortRef.current?.abort();
      gloveRef.current = null;
      setRunnable(null);
      dmRef.current = null;
      subscriberRef.current = null;
      slotMetaRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, systemPrompt]);

  // ── Model hot-swap ───────────────────────────────────────────────────────

  useEffect(() => {
    if (gloveRef.current) {
      gloveRef.current.setModel(model);
    }
  }, [model]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    (text: string, images?: Array<{ data: string; media_type: string }>) => {
      const glove = gloveRef.current;
      const sub = subscriberRef.current;
      if (!glove || !store || state.busy) return;

      // Build image preview URLs for the timeline
      const imageUrls = images?.map(
        (img) => `data:${img.media_type};base64,${img.data}`,
      );

      setState((s) => ({
        ...s,
        busy: true,
        streamingText: "",
        timeline: [
          ...s.timeline,
          {
            kind: "user" as const,
            text,
            ...(imageUrls?.length ? { images: imageUrls } : {}),
          },
        ],
      }));

      const ac = new AbortController();
      abortRef.current = ac;

      // Build request: plain text or multimodal content
      let request: string | ContentPart[];
      if (images?.length) {
        const parts: ContentPart[] = [
          ...images.map(
            (img) =>
              ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: img.media_type,
                  data: img.data,
                },
              }) satisfies ContentPart,
          ),
          { type: "text" as const, text } satisfies ContentPart,
        ];
        request = parts;
      } else {
        request = text;
      }

      glove
        .processRequest(request, ac.signal)
        .then(async () => {
          // Flush any remaining streamed text
          sub?.flushStreamToTimeline();

          // Fetch final task and inbox state
          const tasks = await store?.getTasks?.();
          const inbox = await store?.getInboxItems?.();

          setState((s) => ({
            ...s,
            busy: false,
            streamingText: "",
            ...(tasks ? { tasks } : {}),
            ...(inbox ? { inbox } : {}),
          }));
        })
        .catch((err: any) => {
          sub?.flushStreamToTimeline();

          const isAbort =
            err?.name === "AbortError" || err?.constructor?.name === "AbortError";

          setState((s) => {
            // When aborting, mark any still-running tools as "aborted"
            const timeline = isAbort
              ? s.timeline.map((entry) =>
                  entry.kind === "tool" && entry.status === "running"
                    ? { ...entry, status: "aborted" as const }
                    : entry,
                )
              : [
                  ...s.timeline,
                  {
                    kind: "agent_text" as const,
                    text: `Error: ${err?.message ?? "Unknown error"}`,
                  },
                ];

            return {
              ...s,
              busy: false,
              streamingText: "",
              timeline,
            };
          });
        })
        .finally(() => {
          abortRef.current = null;
        });
    },
    [state.busy, store],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Conversation management ──────────────────────────────────────────────

  const applySession = useCallback((id: string) => {
    if (hasExternalStore) {
      throw new Error(
        "newConversation/switchConversation are unavailable when an explicit 'store' is passed — " +
          "the store owns the session. Swap the store prop instead, or use createStore on GloveClient.",
      );
    }
    imperativeOverrideRef.current = true;
    abortRef.current?.abort();
    setSession(id);
  }, [hasExternalStore]);

  const newConversation = useCallback(
    async (id?: string): Promise<string> => {
      const next = id ?? (client ? await client.mintSessionId() : generateSessionId());
      applySession(next);
      return next;
    },
    [applySession, client],
  );

  const switchConversation = useCallback(
    (id: string): void => {
      applySession(id);
    },
    [applySession],
  );

  const resolveSlot = useCallback((slotId: string, value: unknown) => {
    dmRef.current?.resolve(slotId, value);
  }, []);

  const rejectSlot = useCallback((slotId: string, reason?: string) => {
    dmRef.current?.reject(slotId, reason);
  }, []);

  // ── Slot rendering ────────────────────────────────────────────────────

  const renderers = useMemo(() => {
    const map = new Map<string, (props: SlotRenderProps) => ReactNode>();
    if (tools) {
      for (const tool of tools) {
        if (tool.render) map.set(tool.name, tool.render);
      }
    }
    return map;
  }, [tools]);

  const resultRenderers = useMemo(() => {
    const map = new Map<string, (props: ToolResultRenderProps) => ReactNode>();
    if (tools) {
      for (const tool of tools) {
        if (tool.renderResult) map.set(tool.name, tool.renderResult);
      }
    }
    return map;
  }, [tools]);

  const renderSlot = useCallback(
    (slot: EnhancedSlot): ReactNode => {
      const Renderer = renderers.get(slot.renderer);
      if (!Renderer) return null;
      return createElement(Renderer, {
        key: slot.id,
        data: slot.input,
        resolve: (value: unknown) => dmRef.current?.resolve(slot.id, value),
        reject: (reason?: string) => dmRef.current?.reject(slot.id, reason),
      });
    },
    [renderers],
  );

  const renderToolResult = useCallback(
    (entry: TimelineEntry & { kind: "tool" }): ReactNode => {
      if (entry.renderData === undefined) return null;
      const Renderer = resultRenderers.get(entry.name);
      if (!Renderer) return null;
      return createElement(Renderer, {
        key: entry.id,
        data: entry.renderData,
        output: entry.output,
        status: entry.status as "success" | "error",
      });
    },
    [resultRenderers],
  );

  // ── Timeline hydration from store ────────────────────────────────────────

  const hydratedStoreRef = useRef<StoreAdapter | null>(null);
  useEffect(() => {
    if (!store) return;
    let cancelled = false;

    // Session switch (not initial mount): wipe the previous conversation's
    // UI state before hydrating the new one.
    if (hydratedStoreRef.current && hydratedStoreRef.current !== store) {
      setState({
        busy: false,
        isCompacting: false,
        timeline: [],
        streamingText: "",
        tasks: [],
        inbox: [],
        slots: [],
        stats: {
          turns: 0,
          tokens_in: 0,
          tokens_out: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      });
    }
    hydratedStoreRef.current = store;

    store.getMessages().then((messages: Message[]) => {
      if (cancelled || messages.length === 0) return;
      setState((s) => ({ ...s, timeline: messagesToTimeline(messages) }));
    });

    store.getInboxItems?.().then((inbox) => {
      if (cancelled || !inbox?.length) return;
      setState((s) => ({ ...s, inbox }));
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  return {
    ...state,
    runnable,
    sessionReady: store !== null,
    sessionId,
    newConversation,
    switchConversation,
    sendMessage,
    abort,
    resolveSlot,
    rejectSlot,
    renderSlot,
    renderToolResult,
  };
}
