import { useEffect, useRef, useState, useCallback } from "react";
import type {
  AgentState,
  AgentConnectionConfig,
  TimelineEntry,
  Task,
  Slot,
  SessionFeatures,
  ContentPart,
} from "./useAgent";

// Re-export types for convenience
export type { AgentState, AgentConnectionConfig, TimelineEntry, Task, Slot, SessionFeatures, ContentPart };

/* -------------------------------------------------------------------------- */
/*  Per-connection state that lives in a ref (not React state)                */
/* -------------------------------------------------------------------------- */

interface ConnectionState {
  ws: WebSocket | null;
  connected: boolean;
  busy: boolean;
  sessionId: string | null;
  sessionName: string;
  workingDir: string;
  modelName: string;
  features: SessionFeatures;
  timeline: TimelineEntry[];
  streamingText: string;
  tasks: Task[];
  slots: Slot[];
  stats: { turns: number; tokens_in: number; tokens_out: number };
  streamBuffer: string;
}

function emptyConnection(): ConnectionState {
  return {
    ws: null,
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
    streamBuffer: "",
  };
}

/** Summary of a background session's live status */
export interface SessionStatus {
  sessionId: string;
  connected: boolean;
  busy: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Hook: useAgentPool                                                        */
/*                                                                            */
/*  Manages multiple concurrent WebSocket connections. Each session the user   */
/*  has visited gets its own connection. Switching the "active" session just   */
/*  changes which connection's state is surfaced to React -- no teardown.     */
/* -------------------------------------------------------------------------- */

export function useAgentPool(
  serverUrl: string,
  activeSessionKey: string | null,
  config: AgentConnectionConfig = {},
) {
  const { cwd, provider, model, planning, tasking, autoAccept } = config;

  // Map of sessionKey -> ConnectionState. Lives in a ref so we don't
  // re-render on every background session's text_delta.
  const poolRef = useRef<Map<string, ConnectionState>>(new Map());

  // The active session's state is mirrored into React state for rendering.
  const [activeState, setActiveState] = useState<AgentState>({
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

  // Track all session statuses for the sidebar indicators
  const [sessionStatuses, setSessionStatuses] = useState<Map<string, SessionStatus>>(new Map());

  // Ref for activeSessionKey so WebSocket callbacks can read the current value
  const activeKeyRef = useRef<string | null>(activeSessionKey);
  activeKeyRef.current = activeSessionKey;

  // Pushes a connection's state into React if it's the active session
  const syncToReact = useCallback((key: string, conn: ConnectionState) => {
    if (key === activeKeyRef.current) {
      setActiveState({
        connected: conn.connected,
        busy: conn.busy,
        sessionId: conn.sessionId,
        sessionName: conn.sessionName,
        workingDir: conn.workingDir,
        modelName: conn.modelName,
        features: conn.features,
        timeline: conn.timeline,
        streamingText: conn.streamingText,
        tasks: conn.tasks,
        slots: conn.slots,
        stats: conn.stats,
      });
    }
    // Always update session statuses for sidebar
    setSessionStatuses((prev) => {
      const next = new Map(prev);
      next.set(key, {
        sessionId: conn.sessionId ?? key,
        connected: conn.connected,
        busy: conn.busy,
      });
      return next;
    });
  }, []);

  // Create or retrieve a connection for a session key.
  // Keys starting with "_new_" are treated as new sessions — we omit the
  // "session" query param so the server generates a fresh UUID.  When the
  // server responds with the real session_id (via the "state" event) we re-key
  // the connection under that real ID.
  const ensureConnection = useCallback(
    (key: string) => {
      const pool = poolRef.current;
      if (pool.has(key)) return;

      const isNewSession = key.startsWith("_new_");

      // Mutable key so the closure can track re-keying (new session → real UUID)
      let currentKey = key;

      const conn = emptyConnection();
      pool.set(key, conn);

      // Build WS URL
      const params = new URLSearchParams();
      if (!isNewSession && key) params.set("session", key);
      if (cwd) params.set("cwd", cwd);
      if (provider) params.set("provider", provider);
      if (model) params.set("model", model);
      if (planning !== undefined) params.set("planning", String(planning));
      if (tasking !== undefined) params.set("tasking", String(tasking));
      if (autoAccept !== undefined) params.set("autoAccept", String(autoAccept));
      const qs = params.toString();
      const url = qs ? `${serverUrl}?${qs}` : serverUrl;

      const ws = new WebSocket(url);
      conn.ws = ws;

      ws.onopen = () => {
        conn.connected = true;
        syncToReact(currentKey, conn);
      };

      ws.onclose = () => {
        conn.connected = false;
        conn.busy = false;
        syncToReact(currentKey, conn);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "text_delta":
            conn.streamBuffer += msg.data.text;
            conn.streamingText = conn.streamBuffer;
            break;

          case "tool_use": {
            const flushed = conn.streamBuffer.trim();
            conn.streamBuffer = "";
            if (flushed) conn.timeline = [...conn.timeline, { kind: "agent_text", text: flushed }];
            conn.timeline = [
              ...conn.timeline,
              {
                kind: "tool",
                id: msg.data.id,
                name: msg.data.name,
                input: msg.data.input,
                status: "running",
              },
            ];
            conn.streamingText = "";
            break;
          }

          case "tool_use_result":
            conn.timeline = conn.timeline.map((entry) =>
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
            );
            break;

          case "turn_complete":
            conn.stats = {
              turns: conn.stats.turns + 1,
              tokens_in: conn.stats.tokens_in + msg.data.tokens_in,
              tokens_out: conn.stats.tokens_out + msg.data.tokens_out,
            };
            break;

          case "request_complete": {
            const remaining = conn.streamBuffer.trim();
            conn.streamBuffer = "";
            if (remaining) {
              conn.timeline = [...conn.timeline, { kind: "agent_text", text: remaining }];
            }
            conn.streamingText = "";
            conn.busy = false;
            break;
          }

          case "slot_push":
            conn.slots = [...conn.slots, msg.data];
            break;

          case "slot_remove":
            conn.slots = conn.slots.filter((sl: Slot) => sl.id !== msg.data.id);
            break;

          case "tasks_updated":
            conn.tasks = msg.data.tasks;
            break;

          case "model_changed":
            conn.modelName = msg.data.model;
            break;

          case "state": {
            conn.sessionId = msg.data.session_id ?? conn.sessionId;
            conn.sessionName = msg.data.name ?? conn.sessionName;
            conn.workingDir = msg.data.working_dir ?? conn.workingDir;
            conn.tasks = msg.data.tasks;
            conn.stats = msg.data.stats;
            conn.modelName = msg.data.model ?? conn.modelName;
            conn.features = msg.data.features ?? conn.features;

            // Re-key from temp key to real session ID when the server
            // tells us the actual ID for a newly created session.
            const realId = msg.data.session_id;
            if (realId && realId !== currentKey && isNewSession) {
              pool.delete(currentKey);
              pool.set(realId, conn);
              // If this was the active session, update the active key ref
              // so future commands go to the right connection.
              if (activeKeyRef.current === currentKey) {
                activeKeyRef.current = realId;
              }
              // Update mutable key so all future events use the real ID
              currentKey = realId;
              // Update session statuses under the real key
              setSessionStatuses((prev) => {
                const next = new Map(prev);
                next.delete(key); // delete the original temp key
                next.set(realId, {
                  sessionId: realId,
                  connected: conn.connected,
                  busy: conn.busy,
                });
                return next;
              });
              // Notify App so it can update its selectedSession state
              syncToReact(realId, conn);
              return; // skip the normal syncToReact below
            }
            break;
          }

          case "history":
            // Restore timeline from persisted messages on session resume
            conn.timeline = msg.data.entries;
            break;

          case "error":
            conn.streamBuffer = "";
            conn.busy = false;
            conn.streamingText = "";
            conn.timeline = [
              ...conn.timeline,
              { kind: "agent_text", text: `Error: ${msg.data.message}` },
            ];
            break;
        }

        syncToReact(currentKey, conn);
      };
    },
    [serverUrl, cwd, provider, model, planning, tasking, autoAccept, syncToReact],
  );

  // When a new session (that has no existing connection) becomes active, create a connection.
  // When no session is active, reset state so stale data doesn't leak.
  useEffect(() => {
    if (activeSessionKey === null) {
      setActiveState({
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
      return;
    }
    ensureConnection(activeSessionKey);
    // Immediately sync the existing state (may be cached from a prior visit)
    const conn = poolRef.current.get(activeSessionKey);
    if (conn) {
      syncToReact(activeSessionKey, conn);
    }
  }, [activeSessionKey, ensureConnection, syncToReact]);

  // Cleanup all connections on unmount
  useEffect(() => {
    return () => {
      for (const conn of poolRef.current.values()) {
        conn.ws?.close();
      }
      poolRef.current.clear();
    };
  }, []);

  // ---- Helper: look up the active connection via the ref -------------------
  // We use activeKeyRef so commands work even if the key was just remapped
  // from a temp key to a real session ID (before the parent re-renders).

  const getActiveConn = useCallback((): ConnectionState | null => {
    const key = activeKeyRef.current;
    if (!key) return null;
    return poolRef.current.get(key) ?? null;
  }, []);

  // ---- Commands (sent to the active session's WebSocket) --------------------

  const sendRequest = useCallback(
    (text: string, images?: Array<{ data: string; media_type: string }>) => {
      const conn = getActiveConn();
      if (!conn?.ws || conn.busy) return;

      const key = activeKeyRef.current!;
      conn.streamBuffer = "";

      // Build image preview URLs for the timeline
      const imageUrls = images?.map(
        (img) => `data:${img.media_type};base64,${img.data}`,
      );

      conn.timeline = [
        ...conn.timeline,
        { kind: "user", text, images: imageUrls },
      ];
      conn.busy = true;
      conn.streamingText = "";
      syncToReact(key, conn);

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
        conn.ws.send(
          JSON.stringify({ type: "user_request", data: { content } }),
        );
      } else {
        conn.ws.send(
          JSON.stringify({ type: "user_request", data: { text } }),
        );
      }
    },
    [getActiveConn, syncToReact],
  );

  const resolveSlot = useCallback(
    (slotId: string, value: unknown) => {
      const conn = getActiveConn();
      conn?.ws?.send(
        JSON.stringify({ type: "slot_resolve", data: { slot_id: slotId, value } }),
      );
    },
    [getActiveConn],
  );

  const rejectSlot = useCallback(
    (slotId: string) => {
      const conn = getActiveConn();
      conn?.ws?.send(
        JSON.stringify({ type: "slot_reject", data: { slot_id: slotId } }),
      );
    },
    [getActiveConn],
  );

  const abort = useCallback(() => {
    const conn = getActiveConn();
    conn?.ws?.send(JSON.stringify({ type: "abort", data: {} }));
  }, [getActiveConn]);

  const changeModel = useCallback(
    (newProvider: string, newModel?: string) => {
      const conn = getActiveConn();
      conn?.ws?.send(
        JSON.stringify({
          type: "change_model",
          data: { provider: newProvider, model: newModel },
        }),
      );
    },
    [getActiveConn],
  );

  /** Remove a connection from the pool (e.g., when the session is explicitly closed) */
  const destroyConnection = useCallback((key: string) => {
    const conn = poolRef.current.get(key);
    if (conn) {
      conn.ws?.close();
      poolRef.current.delete(key);
      setSessionStatuses((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  return {
    ...activeState,
    /** The current active key (may differ from the originally passed key after remapping) */
    resolvedActiveKey: activeKeyRef.current,
    sessionStatuses,
    sendRequest,
    resolveSlot,
    rejectSlot,
    abort,
    changeModel,
    destroyConnection,
  };
}
