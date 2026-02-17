"use client";

import { useState, useMemo, useCallback, useRef, useEffect, createElement, type Dispatch, type SetStateAction, type ReactNode } from "react";
import type {
  StoreAdapter,
  ModelAdapter,
  SubscriberAdapter,
  ContentPart,
} from "glove-core/core";
import { Glove } from "glove-core/glove";
import { Displaymanager } from "glove-core/display-manager";
import type {
  GloveState,
  ToolConfig,
  CompactionConfig,
  SlotRenderProps,
} from "../types";
import type { Slot } from "glove-core/display-manager";
import { MemoryStore } from "../adapters/memory-store";
import { createEndpointModel } from "../adapters/endpoint-model";
import { useGloveClient } from "./context";

// ─── Config & return types ───────────────────────────────────────────────────

export interface UseGloveConfig {
  // ── Simple endpoint mode ─────────────────────────────────────────────────
  /** URL of the chat handler endpoint (e.g. "/api/chat"). Auto-creates store + model. */
  endpoint?: string;
  /** Session ID. Auto-generated if omitted. */
  sessionId?: string;

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
  sendMessage: (
    text: string,
    images?: Array<{ data: string; media_type: string }>,
  ) => void;
  abort: () => void;
  resolveSlot: (slotId: string, value: unknown) => void;
  rejectSlot: (slotId: string, reason?: any) => void;
  /** Renders a slot using the colocated `render` from its tool. Returns `null`
   *  if no renderer is registered for the slot's renderer key. */
  renderSlot: (slot: Slot<unknown>) => ReactNode;
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

  constructor(setState: Dispatch<SetStateAction<GloveState>>) {
    this.setState = setState;
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

  async record(event_type: string, data: any): Promise<void> {
    switch (event_type) {
      case "text_delta":
        this.streamBuffer += data.text;
        this.setState((s) => ({
          ...s,
          streamingText: this.streamBuffer,
        }));
        break;

      case "tool_use": {
        // Flush pending text before the tool entry
        const flushed = this.streamBuffer.trim();
        this.streamBuffer = "";
        const toolId = `tool_${++this.toolIdCounter}`;

        this.setState((s) => {
          const tl = [...s.timeline];
          if (flushed) tl.push({ kind: "agent_text", text: flushed });
          tl.push({
            kind: "tool",
            id: data.id ?? toolId,
            name: data.name,
            input: data.input,
            status: "running",
          });
          return { ...s, timeline: tl, streamingText: "" };
        });
        break;
      }

      case "tool_use_result":
        this.setState((s) => {
          const timeline = s.timeline.map((entry) =>
            entry.kind === "tool" && entry.id === data.call_id
              ? {
                  ...entry,
                  status: (data.result.status as "success" | "error"),
                  output:
                    data.result.data != null
                      ? String(data.result.data)
                      : data.result.message,
                }
              : entry,
          );

          // Detect task updates from glove_update_tasks tool
          let tasks = s.tasks;
          if (
            data.tool_name === "glove_update_tasks" &&
            data.result?.status === "success" &&
            data.result?.data?.tasks
          ) {
            tasks = data.result.data.tasks;
          }

          return { ...s, timeline, tasks };
        });
        break;

      case "model_response":
      case "model_response_complete":
        this.setState((s) => ({
          ...s,
          stats: {
            turns: s.stats.turns + 1,
            tokens_in: s.stats.tokens_in + (data.tokens_in ?? 0),
            tokens_out: s.stats.tokens_out + (data.tokens_out ?? 0),
          },
        }));
        break;
    }
  }
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

  const [autoSessionId] = useState(() => crypto.randomUUID());
  const sessionId = config?.sessionId ?? autoSessionId;

  const store = useMemo(() => {
    if (config?.store) return config.store;
    if (client) return client.resolveStore(sessionId);
    return new MemoryStore(sessionId);
  }, [config?.store, client, sessionId]);

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
    timeline: [],
    streamingText: "",
    tasks: [],
    slots: [],
    stats: { turns: 0, tokens_in: 0, tokens_out: 0 },
  });

  // Refs that persist across renders
  const gloveRef = useRef<ReturnType<Glove["build"]> | null>(null);
  const dmRef = useRef<Displaymanager | null>(null);
  const subscriberRef = useRef<ReactSubscriber | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Build Glove instance (once, or when key config changes) ──────────────

  useEffect(() => {
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

    const runnable = builder.build();
    gloveRef.current = runnable;

    // Subscribe to DisplayManager for slot updates
    const unsubDm = dm.subscribe(async (stack: Slot<unknown>[]) => {
      setState((s) => ({ ...s, slots: [...stack] }));
    });

    return () => {
      unsubDm();
      abortRef.current?.abort();
      gloveRef.current = null;
      dmRef.current = null;
      subscriberRef.current = null;
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
      if (!glove || state.busy) return;

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

          // Fetch final task state
          const tasks = await store.getTasks?.();

          setState((s) => ({
            ...s,
            busy: false,
            streamingText: "",
            ...(tasks ? { tasks } : {}),
          }));
        })
        .catch((err: any) => {
          sub?.flushStreamToTimeline();

          const isAbort =
            err?.name === "AbortError" || err?.constructor?.name === "AbortError";

          setState((s) => ({
            ...s,
            busy: false,
            streamingText: "",
            ...(isAbort
              ? {}
              : {
                  timeline: [
                    ...s.timeline,
                    {
                      kind: "agent_text" as const,
                      text: `Error: ${err?.message ?? "Unknown error"}`,
                    },
                  ],
                }),
          }));
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

  const resolveSlot = useCallback((slotId: string, value: unknown) => {
    dmRef.current?.resolve(slotId, value);
  }, []);

  const rejectSlot = useCallback((slotId: string, reason?: any) => {
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

  const renderSlot = useCallback(
    (slot: Slot<unknown>): ReactNode => {
      const Renderer = renderers.get(slot.renderer);
      if (!Renderer) return null;
      return createElement(Renderer, {
        key: slot.id,
        data: slot.input,
        resolve: (value: unknown) => dmRef.current?.resolve(slot.id, value),
      });
    },
    [renderers],
  );

  return {
    ...state,
    sendMessage,
    abort,
    resolveSlot,
    rejectSlot,
    renderSlot,
  };
}
