"use client";

import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import { useGlove } from "glove-react";
import { useGloveVoice } from "glove-react/voice";
import type { TurnMode } from "glove-react/voice";
import { createLolaTools } from "../lib/tools";
import { stt, createTTS, createSileroVAD } from "../lib/voice";
import { systemPrompt, voiceSystemPrompt } from "../lib/system-prompt";
import { VisualArea } from "./visual-area";
import { TranscriptStrip } from "./transcript-strip";
import { VoiceOrb } from "./voice-orb";
import { TextInput } from "./text-input";

// ---- Lola orchestrator -----------------------------------------------------
//
// Single-screen, voice-first movie companion. No chat column -- the screen
// is divided into a visual area (tool cards), a transcript strip (agent speech),
// and an orb area (voice controls + optional text input).

interface LolaProps {
  sessionId: string;
  onFirstMessage?: (sessionId: string, text: string) => void;
}

export function Lola({ sessionId, onFirstMessage }: LolaProps) {
  // ---- State ---------------------------------------------------------------
  const [turnMode, setTurnMode] = useState<TurnMode>("vad");
  const [isManualRecording, setIsManualRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [input, setInput] = useState("");
  const [vadReady, setVadReady] = useState(false);

  // ---- Refs ----------------------------------------------------------------
  const namedRef = useRef(false);
  const recordingRef = useRef(false);
  const recordingStartRef = useRef(0);
  const pendingCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vadRef = useRef<Awaited<ReturnType<typeof createSileroVAD>> | null>(
    null,
  );

  const MIN_RECORDING_MS = 350;

  // Reset named tracking when session changes
  useEffect(() => {
    namedRef.current = false;
  }, [sessionId]);

  // ---- Tools (stable, created once) ----------------------------------------
  const tools = useMemo(() => createLolaTools(), []);

  // ---- Glove hook ----------------------------------------------------------
  const glove = useGlove({ tools, sessionId });
  const {
    runnable,
    timeline,
    streamingText,
    busy,
    slots,
    sendMessage,
    renderSlot,
    renderToolResult,
  } = glove;

  // ---- Silero VAD initialization -------------------------------------------
  useEffect(() => {
    createSileroVAD().then((v) => {
      vadRef.current = v;
      setVadReady(true);
    });
  }, []);

  // ---- Voice pipeline ------------------------------------------------------
  const voiceConfig = useMemo(
    () => ({
      stt,
      createTTS,
      vad: vadReady ? vadRef.current ?? undefined : undefined,
      turnMode,
    }),
    [vadReady, turnMode],
  );
  const voice = useGloveVoice({ runnable, voice: voiceConfig });

  // Stable ref for voice.commitTurn
  const commitTurnRef = useRef(voice.commitTurn);
  commitTurnRef.current = voice.commitTurn;

  // ---- Voice-specific system prompt ----------------------------------------
  useEffect(() => {
    if (!runnable) return;
    if (voice.isActive) {
      runnable.setSystemPrompt(voiceSystemPrompt);
    } else {
      runnable.setSystemPrompt(systemPrompt);
    }
  }, [voice.isActive, runnable]);

  // ---- Reset manual recording when voice mode changes ----------------------
  useEffect(() => {
    if (voice.mode !== "listening") {
      recordingRef.current = false;
      setIsManualRecording(false);
      setIsProcessing(false);
      if (pendingCommitRef.current) {
        clearTimeout(pendingCommitRef.current);
        pendingCommitRef.current = null;
      }
    }
  }, [voice.mode]);

  // ---- Thinking sound loop -------------------------------------------------
  useEffect(() => {
    if (voice.mode !== "thinking") return;
    const audio = new Audio("/lola-thinking.mp3");
    audio.loop = true;
    audio.play().catch(() => {});
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [voice.mode]);

  // ---- Commit with min-duration handling -----------------------------------
  const commitRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setIsManualRecording(false);

    const elapsed = Date.now() - recordingStartRef.current;

    if (elapsed >= MIN_RECORDING_MS) {
      setIsProcessing(true);
      commitTurnRef.current();
    } else {
      setIsProcessing(true);
      const remaining = MIN_RECORDING_MS - elapsed;
      pendingCommitRef.current = setTimeout(() => {
        pendingCommitRef.current = null;
        commitTurnRef.current();
      }, remaining);
    }
  }, []);

  // ---- Manual recording handlers -------------------------------------------
  const handleManualRecordStart = useCallback(() => {
    if (turnMode !== "manual" || voice.mode !== "listening") return;
    if (recordingRef.current) return;
    recordingRef.current = true;
    recordingStartRef.current = Date.now();
    setIsProcessing(false);
    setIsManualRecording(true);
  }, [turnMode, voice.mode]);

  const handleManualRecordStop = useCallback(() => {
    commitRecording();
  }, [commitRecording]);

  // ---- Space bar: hold-to-speak in manual mode -----------------------------
  useEffect(() => {
    if (!voice.isActive || turnMode !== "manual") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      e.preventDefault();
      if (e.repeat) return;

      if (voice.mode === "listening" && !recordingRef.current) {
        recordingRef.current = true;
        recordingStartRef.current = Date.now();
        setIsProcessing(false);
        setIsManualRecording(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      e.preventDefault();
      commitRecording();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [voice.isActive, turnMode, voice.mode, commitRecording]);

  // ---- Compute last agent text from timeline -------------------------------
  const lastAgentText = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const entry = timeline[i];
      if (entry.kind === "agent_text") return entry.text;
    }
    return "";
  }, [timeline]);

  // ---- Text submit handler -------------------------------------------------
  const handleSubmit = useCallback(
    (e: { preventDefault: () => void }) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || busy) return;
      setInput("");
      sendMessage(text);

      if (!namedRef.current && onFirstMessage) {
        namedRef.current = true;
        const name = text.length > 40 ? text.slice(0, 40) + "..." : text;
        onFirstMessage(sessionId, name);
      }
    },
    [input, busy, sendMessage, sessionId, onFirstMessage],
  );

  // ---- Suggestion chip handler ----------------------------------------------
  const handleSuggestion = useCallback(
    (text: string) => {
      if (busy) return;
      sendMessage(text);
      if (!namedRef.current && onFirstMessage) {
        namedRef.current = true;
        onFirstMessage(sessionId, text);
      }
    },
    [busy, sendMessage, sessionId, onFirstMessage],
  );

  // ---- Render --------------------------------------------------------------
  return (
    <div className="lola-screen">
      <VisualArea
        slots={slots}
        timeline={timeline}
        renderSlot={renderSlot}
        renderToolResult={renderToolResult}
        busy={busy}
        onSuggestion={handleSuggestion}
      />

      <TranscriptStrip
        text={streamingText || lastAgentText}
        isStreaming={!!streamingText}
      />

      <div className="orb-area">
        {voice.isActive ? (
          <>
            <VoiceOrb
              mode={voice.mode}
              transcript={voice.transcript}
              turnMode={turnMode}
              isManualRecording={isManualRecording}
              isProcessing={isProcessing}
              onStop={() => voice.stop()}
              onInterrupt={voice.interrupt}
              onManualRecordStart={handleManualRecordStart}
              onManualRecordStop={handleManualRecordStop}
            />
            <button
              type="button"
              className="voice-end-btn"
              onClick={() => voice.stop()}
              aria-label="End voice session"
            >
              End
            </button>
            <TurnModeToggle
              turnMode={turnMode}
              setTurnMode={setTurnMode}
              disabled={voice.mode !== "listening"}
            />
          </>
        ) : (
          <IdleOrb onStart={() => voice.start()} />
        )}

        <TextInput
          visible={showTextInput}
          onToggle={() => setShowTextInput(!showTextInput)}
          input={input}
          setInput={setInput}
          busy={busy}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}

// ---- Idle orb (voice not active) -------------------------------------------

function IdleOrb({ onStart }: { onStart: () => void }) {
  return (
    <div className="voice-orb-container">
      <button
        type="button"
        className="voice-orb voice-orb--idle"
        onClick={onStart}
        aria-label="Start voice conversation"
      >
        <span
          className="voice-orb__ring voice-orb__ring--outer"
          aria-hidden="true"
        />
        <span
          className="voice-orb__ring voice-orb__ring--middle"
          aria-hidden="true"
        />
        <span className="voice-orb__core">
          <MicIcon color="#0d0d0f" size={20} />
        </span>
      </button>
      <p className="voice-orb__status">Tap to speak</p>
    </div>
  );
}

// ---- Turn mode segmented control -------------------------------------------

interface TurnModeToggleProps {
  turnMode: TurnMode;
  setTurnMode: (mode: TurnMode) => void;
  disabled: boolean;
}

function TurnModeToggle({
  turnMode,
  setTurnMode,
  disabled,
}: TurnModeToggleProps) {
  return (
    <div
      className={`turn-mode-toggle ${disabled ? "turn-mode-toggle--disabled" : ""}`}
      role="radiogroup"
      aria-label="Voice input mode"
    >
      <button
        type="button"
        role="radio"
        aria-checked={turnMode === "vad"}
        className={`turn-mode-option ${turnMode === "vad" ? "turn-mode-option--active" : ""}`}
        onClick={() => setTurnMode("vad")}
        disabled={disabled}
      >
        Auto
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={turnMode === "manual"}
        className={`turn-mode-option ${turnMode === "manual" ? "turn-mode-option--active" : ""}`}
        onClick={() => setTurnMode("manual")}
        disabled={disabled}
      >
        Push to speak
      </button>
    </div>
  );
}

// ---- Inline MicIcon --------------------------------------------------------

function MicIcon({
  color = "#0d0d0f",
  size = 20,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="1" width="6" height="14" rx="3" />
      <path d="M19 10v2a7 7 0 01-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
