"use client";

import { useEffect, useRef, useState } from "react";
import type { ElevenLabsSTTAdapter } from "glove-voice";

// Everything Scribe says, as it says it, so you can see the new behaviour
// rather than infer it: turn probability, who commits (Scribe or the local
// fallback), speaker labels arriving, merges and warnings.

export interface MonitorLine {
  id: number;
  at: number;
  kind: "session" | "commit" | "labels" | "merge" | "flush" | "final" | "warning" | "error" | "turn";
  text: string;
}

export interface ScribeMonitor {
  /** Scribe's end-of-turn probability for the current partial, 0..1. */
  probability: number | null;
  partials: number;
  commits: number;
  /** Commits this side asked for: the local VAD, or the fallback when Scribe stayed silent. */
  flushes: number;
  labelled: number;
  sessionId: string | null;
  lines: MonitorLine[];
  /** Add a line from elsewhere in the pipeline. */
  note: (kind: MonitorLine["kind"], text: string) => void;
  clear: () => void;
}

const MAX_LINES = 200;

export function useScribeMonitor(stt: ElevenLabsSTTAdapter | null): ScribeMonitor {
  const [probability, setProbability] = useState<number | null>(null);
  const [counts, setCounts] = useState({ partials: 0, commits: 0, flushes: 0, labelled: 0 });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<MonitorLine[]>([]);
  const nextId = useRef(0);

  const note = useRef((kind: MonitorLine["kind"], text: string) => {
    setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), { id: nextId.current++, at: Date.now(), kind, text }]);
  }).current;

  const clear = useRef(() => {
    setLines([]);
    setCounts({ partials: 0, commits: 0, flushes: 0, labelled: 0 });
    setProbability(null);
  }).current;

  useEffect(() => {
    if (!stt) return;
    const bump = (key: keyof typeof counts) => setCounts((c) => ({ ...c, [key]: c[key] + 1 }));

    const onPartial = () => bump("partials");
    const onFinal = (text: string) => note("final", text || "(empty)");
    const onError = (error: Error) => note("error", error.message);
    stt.on("partial", onPartial);
    stt.on("final", onFinal);
    stt.on("error", onError);

    const onSession = (info: { sessionId: string; config: unknown }) => {
      setSessionId(info.sessionId);
      const config = (info.config ?? {}) as Record<string, unknown>;
      const shown = ["model_id", "commit_strategy", "diarize", "language_code"]
        .filter((key) => config[key] !== undefined)
        .map((key) => `${key}=${String(config[key])}`)
        .join(" ");
      note("session", `session started${shown ? `: ${shown}` : ""}`);
    };
    const onCommitted = (commit: { text: string; segmentIndex?: number; languageCode?: string; words?: unknown[] }) => {
      bump("commits");
      const extra = [
        commit.segmentIndex !== undefined ? `segment ${commit.segmentIndex}` : "",
        commit.languageCode ? `lang ${commit.languageCode}` : "",
        commit.words ? `${commit.words.length} words` : "",
      ].filter(Boolean).join(", ");
      note("commit", `Scribe committed${extra ? ` (${extra})` : ""}`);
    };
    const onDiarized = (segment: { segmentIndex: number; turns: Array<{ speakerId: string | null; text: string }> }) => {
      bump("labelled");
      note("labels", `segment ${segment.segmentIndex}: ${segment.turns.map((t) => `${t.speakerId ?? "?"}: "${t.text}"`).join(" | ")}`);
    };
    const onMerged = (merge: { from: string; to: string }) => note("merge", `${merge.from} is the same speaker as ${merge.to}`);
    const onProbability = (p: number) => setProbability(p);
    const onWarning = (message: string) => note("warning", message);
    stt.scribe.on("session_started", onSession);
    stt.scribe.on("committed", onCommitted);
    stt.scribe.on("diarized", onDiarized);
    stt.scribe.on("speakers_merged", onMerged);
    stt.scribe.on("turn_probability", onProbability);
    stt.scribe.on("warning", onWarning);

    // A flush is this side asking Scribe to commit: the local VAD in
    // "Local VAD" mode, or the fallback when Scribe did not end the turn.
    const flush = stt.flushUtterance.bind(stt);
    stt.flushUtterance = () => {
      bump("flushes");
      note("flush", "this side asked for a commit (not sent if Scribe already committed)");
      flush();
    };

    return () => {
      stt.off("partial", onPartial);
      stt.off("final", onFinal);
      stt.off("error", onError);
      stt.scribe.off("session_started", onSession);
      stt.scribe.off("committed", onCommitted);
      stt.scribe.off("diarized", onDiarized);
      stt.scribe.off("speakers_merged", onMerged);
      stt.scribe.off("turn_probability", onProbability);
      stt.scribe.off("warning", onWarning);
      stt.flushUtterance = flush;
    };
  }, [stt, note]);

  return { probability, ...counts, sessionId, lines, note, clear };
}
