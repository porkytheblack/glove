import { useEffect, useRef, useState, useCallback } from "react";

// ---- Types ------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface Task {
  id: string;
  content: string;
  activeForm: string;
  status: TaskStatus;
}

export type TimelineEntry =
  | { kind: "user"; text: string; images?: string[] }
  | { kind: "agent_text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      status: "running" | "success" | "error";
      output?: string;
    };

export interface Slot {
  id: string;
  renderer: string;
  input: unknown;
}

/** Content part for multimodal messages (text + images) */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; media_type: string };

export interface SessionFeatures {
  planning: boolean;
  tasking: boolean;
  autoAccept: boolean;
}

export interface AgentState {
  connected: boolean;
  busy: boolean;
  timeline: TimelineEntry[];
  streamingText: string;
  tasks: Task[];
  slots: Slot[];
  stats: { turns: number; tokens_in: number; tokens_out: number };
  sessionId: string | null;
  sessionName: string;
  workingDir: string;
  modelName: string;
  features: SessionFeatures;
}

export interface AgentConnectionConfig {
  sessionId?: string | null;
  cwd?: string;
  provider?: string;
  model?: string;
  planning?: boolean;
  tasking?: boolean;
  autoAccept?: boolean;
}

// ---- Hook -------------------------------------------------------------------

export function useAgent(
  serverUrl: string,
  config: AgentConnectionConfig = {},
) {
  const { sessionId, cwd, provider, model, planning, tasking, autoAccept } = config;
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef("");
  const [state, setState] = useState<AgentState>({
    connected: false,
    busy: false,
    sessionId: null,
    sessionName: "",
    workingDir: "",
    modelName: "",
    features: { planning: true, tasking: true, autoAccept: false },
    timeline: [],
    streamingText: "",
    tasks: [],
    slots: [],
    stats: { turns: 0, tokens_in: 0, tokens_out: 0 },
  });

  useEffect(() => {
    // Don't connect until session decision is made (null = no session)
    if (sessionId === null) return;

    // Build WS URL with query params
    const params = new URLSearchParams();
    if (sessionId) params.set("session", sessionId);
    if (cwd) params.set("cwd", cwd);
    if (provider) params.set("provider", provider);
    if (model) params.set("model", model);
    if (planning !== undefined) params.set("planning", String(planning));
    if (tasking !== undefined) params.set("tasking", String(tasking));
    if (autoAccept !== undefined) params.set("autoAccept", String(autoAccept));
    const qs = params.toString();
    const url = qs ? `${serverUrl}?${qs}` : serverUrl;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, connected: true }));
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false, busy: false }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "text_delta":
          streamRef.current += msg.data.text;
          setState((s) => ({ ...s, streamingText: streamRef.current }));
          break;

        case "tool_use": {
          // Flush any pending text before the tool entry
          const flushed = streamRef.current.trim();
          streamRef.current = "";
          setState((s) => {
            const tl = [...s.timeline];
            if (flushed) tl.push({ kind: "agent_text", text: flushed });
            tl.push({
              kind: "tool",
              id: msg.data.id,
              name: msg.data.name,
              input: msg.data.input,
              status: "running",
            });
            return { ...s, timeline: tl, streamingText: "" };
          });
          break;
        }

        case "tool_use_result":
          setState((s) => ({
            ...s,
            timeline: s.timeline.map((entry) =>
              entry.kind === "tool" && entry.id === msg.data.call_id
                ? {
                    ...entry,
                    status: msg.data.result.status as "success" | "error",
                    output:
                      msg.data.result.data != null
                        ? String(msg.data.result.data)
                        : msg.data.result.message,
                  }
                : entry,
            ),
          }));
          break;

        case "turn_complete":
          setState((s) => ({
            ...s,
            stats: {
              turns: s.stats.turns + 1,
              tokens_in: s.stats.tokens_in + msg.data.tokens_in,
              tokens_out: s.stats.tokens_out + msg.data.tokens_out,
            },
          }));
          break;

        case "request_complete": {
          // Flush remaining text
          const remaining = streamRef.current.trim();
          streamRef.current = "";
          setState((s) => {
            const tl = remaining
              ? [...s.timeline, { kind: "agent_text" as const, text: remaining }]
              : s.timeline;
            return { ...s, timeline: tl, streamingText: "", busy: false };
          });
          break;
        }

        case "slot_push":
          setState((s) => ({
            ...s,
            slots: [...s.slots, msg.data],
          }));
          break;

        case "slot_remove":
          setState((s) => ({
            ...s,
            slots: s.slots.filter((sl) => sl.id !== msg.data.id),
          }));
          break;

        case "tasks_updated":
          setState((s) => ({ ...s, tasks: msg.data.tasks }));
          break;

        case "state":
          setState((s) => ({
            ...s,
            sessionId: msg.data.session_id ?? s.sessionId,
            sessionName: msg.data.name ?? s.sessionName,
            workingDir: msg.data.working_dir ?? s.workingDir,
            tasks: msg.data.tasks,
            stats: msg.data.stats,
            modelName: msg.data.model ?? s.modelName,
            features: msg.data.features ?? s.features,
          }));
          break;

        case "model_changed":
          setState((s) => ({
            ...s,
            modelName: msg.data.model,
          }));
          break;

        case "error":
          streamRef.current = "";
          setState((s) => ({
            ...s,
            busy: false,
            streamingText: "",
            timeline: [
              ...s.timeline,
              { kind: "agent_text", text: `Error: ${msg.data.message}` },
            ],
          }));
          break;
      }
    };

    return () => {
      ws.close();
    };
  }, [serverUrl, sessionId, cwd, provider, model, planning, tasking, autoAccept]);

  // ---- Commands -------------------------------------------------------------

  /**
   * Send a user request. Supports multimodal content:
   * - text-only: sendRequest("hello")
   * - with images: sendRequest("describe this", [{ type: "image", data: "base64...", media_type: "image/png" }])
   */
  const sendRequest = useCallback(
    (text: string, images?: Array<{ data: string; media_type: string }>) => {
      if (!wsRef.current || state.busy) return;
      streamRef.current = "";

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
          { kind: "user", text, images: imageUrls },
        ],
      }));

      // Build content parts for multimodal messages
      if (images && images.length > 0) {
        const content: ContentPart[] = [
          ...images.map(
            (img) =>
              ({
                type: "image" as const,
                data: img.data,
                media_type: img.media_type,
              }),
          ),
          { type: "text", text },
        ];
        wsRef.current.send(
          JSON.stringify({ type: "user_request", data: { content } }),
        );
      } else {
        wsRef.current.send(
          JSON.stringify({ type: "user_request", data: { text } }),
        );
      }
    },
    [state.busy],
  );

  const resolveSlot = useCallback((slotId: string, value: unknown) => {
    wsRef.current?.send(
      JSON.stringify({ type: "slot_resolve", data: { slot_id: slotId, value } }),
    );
  }, []);

  const rejectSlot = useCallback((slotId: string) => {
    wsRef.current?.send(
      JSON.stringify({ type: "slot_reject", data: { slot_id: slotId } }),
    );
  }, []);

  const abort = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "abort", data: {} }));
  }, []);

  const changeModel = useCallback(
    (provider: string, newModel?: string) => {
      wsRef.current?.send(
        JSON.stringify({
          type: "change_model",
          data: { provider, model: newModel },
        }),
      );
    },
    [],
  );

  return { ...state, sendRequest, resolveSlot, rejectSlot, abort, changeModel };
}
