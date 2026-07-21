"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AddressingVerdict,
  AgentRole,
  AgentStats,
  Phase,
  SessionConfig,
  SessionEvent,
  SpeakerRole,
} from "../shared/types";

export interface RoomUtterance {
  kind: "utterance";
  id: string;
  speaker: SpeakerRole;
  text: string;
  verdict?: AddressingVerdict;
  silent?: boolean;
  silentReason?: string;
}
export interface RoomSay {
  kind: "say";
  id: string;
  sayKind: "response" | "relay";
  text: string;
}
export type RoomItem = RoomUtterance | RoomSay;

export interface BackstageItem {
  id: string;
  kind: "delegate" | "reply" | "tool";
  role?: AgentRole;
  name?: string;
  content: string;
}

const EMPTY_STATS: Record<AgentRole, AgentStats> = {
  front: { tokensIn: 0, tokensOut: 0, turns: 0 },
  worker: { tokensIn: 0, tokensOut: 0, turns: 0 },
  monitor: { tokensIn: 0, tokensOut: 0, turns: 0 },
};

export function useSession(opts?: { onEvent?: (e: SessionEvent) => void }) {
  const onEventRef = useRef(opts?.onEvent);
  onEventRef.current = opts?.onEvent;

  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stats, setStats] = useState<Record<AgentRole, AgentStats>>(EMPTY_STATS);
  const [room, setRoom] = useState<RoomItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [backstage, setBackstage] = useState<BackstageItem[]>([]);
  const [busy, setBusy] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const nextId = () => `evt${++seqRef.current}`;

  const handleEvent = useCallback((e: SessionEvent) => {
    // Let consumers (e.g. the voice layer + metrics HUD) tap the raw stream.
    onEventRef.current?.(e);
    switch (e.type) {
      case "utterance":
        setRoom((r) => [
          ...r,
          { kind: "utterance", id: e.utterance.id, speaker: e.utterance.speaker, text: e.utterance.text },
        ]);
        break;
      case "verdict":
        setRoom((r) =>
          r.map((it) =>
            it.kind === "utterance" && it.id === e.utteranceId ? { ...it, verdict: e.verdict } : it,
          ),
        );
        break;
      case "silent":
        setRoom((r) =>
          r.map((it) =>
            it.kind === "utterance" && it.id === e.utteranceId
              ? { ...it, silent: true, silentReason: e.reason }
              : it,
          ),
        );
        break;
      case "delta":
        if (e.role === "front") setStreaming((s) => s + e.text);
        break;
      case "say":
        if (e.role === "front") {
          setStreaming("");
          setRoom((r) => [...r, { kind: "say", id: nextId(), sayKind: e.kind, text: e.text }]);
        }
        break;
      case "mesh":
        setBackstage((b) => [
          ...b,
          { id: nextId(), kind: e.direction, content: e.content },
        ]);
        break;
      case "tool":
        setBackstage((b) => [
          ...b,
          { id: nextId(), kind: "tool", role: e.role, name: e.name, content: e.summary },
        ]);
        break;
      case "phase":
        setPhase(e.phase);
        break;
      case "stats":
        setStats(e.stats);
        break;
      case "error":
        setError(e.message);
        break;
    }
  }, []);

  const boot = useCallback(async () => {
    // Tear down any prior connection.
    esRef.current?.close();
    setReady(false);
    setError(null);
    setRoom([]);
    setBackstage([]);
    setStreaming("");
    setStats(EMPTY_STATS);
    setPhase("idle");

    try {
      const res = await fetch("/api/session", { method: "POST" });
      const cfg = (await res.json()) as SessionConfig & { buildError?: string | null };
      setConfig({ sessionId: cfg.sessionId, speakers: cfg.speakers, assistantName: cfg.assistantName });
      sessionIdRef.current = cfg.sessionId;
      if (cfg.buildError) setError(cfg.buildError);

      const es = new EventSource(`/api/session/${cfg.sessionId}/stream`);
      es.onmessage = (msg) => {
        try {
          handleEvent(JSON.parse(msg.data) as SessionEvent);
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        // EventSource auto-reconnects; nothing to do but note we're not ready
        // if it never opened.
      };
      esRef.current = es;
      setReady(true);
    } catch (err) {
      setError((err as Error)?.message ?? "Failed to start a session.");
    }
  }, [handleEvent]);

  useEffect(() => {
    boot();
    return () => {
      esRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(async (speaker: SpeakerRole, text: string) => {
    const id = sessionIdRef.current;
    if (!id || !text.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/session/${id}/utterance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaker, text: text.trim() }),
      });
    } catch (err) {
      setError((err as Error)?.message ?? "Failed to send.");
    } finally {
      setBusy(false);
    }
  }, []);

  const playScenario = useCallback(
    async (lines: { speaker: SpeakerRole; text: string }[]) => {
      for (const line of lines) {
        await send(line.speaker, line.text);
        // small beat between turns for readability
        await new Promise((r) => setTimeout(r, 500));
      }
    },
    [send],
  );

  return {
    config,
    ready,
    error,
    phase,
    stats,
    room,
    streaming,
    backstage,
    busy,
    send,
    playScenario,
    reset: boot,
  };
}
