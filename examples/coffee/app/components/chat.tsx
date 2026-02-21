"use client";

import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useGlove, Render } from "glove-react";
import { useGloveVoice } from "glove-react/voice";
import type {
  MessageRenderProps,
  StreamingRenderProps,
  ToolStatusRenderProps,
} from "glove-react";
import type { TurnMode } from "glove-react/voice";
import { createCoffeeTools, type CartOps } from "../lib/tools";
import { getProductById, type CartItem } from "../lib/products";
import { stt, createTTS, createSileroVAD } from "../lib/voice";
import { systemPrompt, voiceSystemPrompt } from "../lib/system-prompt";
import { RightPanel } from "./right-panel";
import { ChatInput } from "./chat-input";
import { EmptyState } from "./empty-state";
import { CoffeeIcon } from "./icons";

// ─── Custom renderers ───────────────────────────────────────────────────────

function renderMessage({ entry }: MessageRenderProps): ReactNode {
  if (entry.kind === "user") {
    return (
      <div className="message-user">
        <div className="message-user-bubble">{entry.text}</div>
      </div>
    );
  }
  return (
    <div className="message-agent">
      <div className="agent-avatar">
        <CoffeeIcon color="#3d5a3d" size={14} />
      </div>
      <div className="agent-text">{entry.text}</div>
    </div>
  );
}

function renderStreaming({ text }: StreamingRenderProps): ReactNode {
  return (
    <div className="message-agent">
      <div className="agent-avatar">
        <CoffeeIcon color="#3d5a3d" size={14} />
      </div>
      <div className="agent-text streaming">{text}</div>
    </div>
  );
}

function renderToolStatus({ entry }: ToolStatusRenderProps): ReactNode {
  // Don't render aborted tools — abort is not an error, just the user ending the turn
  if (entry.status === "aborted") return null;

  return (
    <div className="tool-entry">
      <div className={`tool-badge ${entry.status}`}>
        {entry.status === "running"
          ? "..."
          : entry.status === "success"
            ? "ok"
            : "err"}
      </div>
      <span className="tool-name">{entry.name}</span>
      {entry.output && (
        <span className="tool-output">
          {entry.output.length > 60
            ? entry.output.slice(0, 60) + "..."
            : entry.output}
        </span>
      )}
    </div>
  );
}

// ─── Chat orchestrator ──────────────────────────────────────────────────────

interface ChatProps {
  sessionId: string;
  onFirstMessage?: (sessionId: string, text: string) => void;
}

export default function Chat({ sessionId, onFirstMessage }: ChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const namedRef = useRef(false);

  // Reset named tracking when session changes
  useEffect(() => {
    namedRef.current = false;
  }, [sessionId]);

  // ── Cart state ────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([]);
  const cartRef = useRef<CartItem[]>(cart);
  cartRef.current = cart;

  const cartOps: CartOps = useMemo(
    () => ({
      add: (productId: string, quantity = 1) => {
        setCart((prev) => {
          const product = getProductById(productId);
          if (!product) return prev;
          const existing = prev.find((i) => i.id === productId);
          if (existing) {
            return prev.map((i) =>
              i.id === productId ? { ...i, qty: i.qty + quantity } : i,
            );
          }
          return [...prev, { ...product, qty: quantity }];
        });
      },
      get: () => cartRef.current,
      clear: () => setCart([]),
    }),
    [],
  );

  // ── Tools (stable, created once) ──────────────────────────────────────
  const tools = useMemo(() => createCoffeeTools(cartOps), [cartOps]);

  // ── Glove hook — sessionId drives store resolution ──────────────────
  const glove = useGlove({ tools, sessionId });
  const { runnable, timeline, streamingText, busy, stats, slots, sendMessage, abort } =
    glove;

  // ── Turn mode state ──────────────────────────────────────────────────
  const [turnMode, setTurnMode] = useState<TurnMode>("vad");

  // ── Manual recording state ───────────────────────────────────────────
  // Tracks whether the user is actively holding space / clicking to record
  // in manual (push-to-speak) mode. This is purely UI state — the mic is
  // always hot once voice.start() is called. Recording state just controls
  // when we call commitTurn() to flush the utterance.
  const [isManualRecording, setIsManualRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const recordingRef = useRef(false);        // guards against double-commit
  const recordingStartRef = useRef(0);       // timestamp for min-duration check
  const pendingCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MIN_RECORDING_MS = 350;             // ElevenLabs needs ≥0.3s of audio

  // ── Voice pipeline ──────────────────────────────────────────────────
  // Track VAD initialization state
  const [vadReady, setVadReady] = useState(false);
  const vadRef = useRef<Awaited<ReturnType<typeof createSileroVAD>> | null>(null);

  // Initialize Silero VAD model on mount (dynamic import avoids SSR issues)
  useEffect(() => {
    createSileroVAD().then((v) => {
      vadRef.current = v;
      setVadReady(true);
    });
  }, []);

  const voiceConfig = useMemo(
    () => ({
      stt,
      createTTS,
      vad: vadReady ? vadRef.current ?? undefined : undefined,
      turnMode,
    }),
    [vadReady, turnMode]
  );
  const voice = useGloveVoice({ runnable, voice: voiceConfig });

  // Stable ref for voice.commitTurn — avoids capturing the unstable `voice`
  // object in keyboard/click handlers and preventing listener churn.
  const commitTurnRef = useRef(voice.commitTurn);
  commitTurnRef.current = voice.commitTurn;

  // ── Voice-specific system prompt ────────────────────────────────────
  useEffect(() => {
    if (!runnable) return;
    if (voice.isActive) {
      runnable.setSystemPrompt(voiceSystemPrompt);
    } else {
      runnable.setSystemPrompt(systemPrompt);
    }
  }, [voice.isActive, runnable]);

  // ── Reset manual recording when voice mode changes ─────────────────
  // If the pipeline transitions away from listening (e.g. thinking/speaking),
  // the recording session is done — clear all flags.
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

  // ── Thinking sound — loop while agent is processing ────────────────
  useEffect(() => {
    if (voice.mode !== "thinking") return;
    const audio = new Audio("/bow-loading.mp3");
    audio.loop = true;
    audio.play().catch(() => {});
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [voice.mode]);

  // ── Commit with min-duration handling ──────────────────────────────
  // When user stops recording: if enough audio has accumulated, commit
  // immediately. Otherwise, show a processing state and wait until
  // MIN_RECORDING_MS has elapsed before committing. The mic stays hot
  // the entire time so audio keeps flowing to ElevenLabs.
  const commitRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setIsManualRecording(false);

    const elapsed = Date.now() - recordingStartRef.current;

    if (elapsed >= MIN_RECORDING_MS) {
      // Enough audio — commit now, show processing while STT finalizes
      setIsProcessing(true);
      commitTurnRef.current();
    } else {
      // Not enough audio yet — keep mic hot, wait, then commit
      setIsProcessing(true);
      const remaining = MIN_RECORDING_MS - elapsed;
      pendingCommitRef.current = setTimeout(() => {
        pendingCommitRef.current = null;
        commitTurnRef.current();
      }, remaining);
    }
  }, [MIN_RECORDING_MS]);

  // ── Manual recording handlers ──────────────────────────────────────
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

  // ── Space bar: hold-to-speak in manual mode ────────────────────────
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

  // ── Auto-scroll ─────────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [timeline, streamingText, slots]);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (e: { preventDefault: () => void }) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || busy) return;
      setInput("");
      sendMessage(text);

      // Auto-name the session after the first user message
      if (!namedRef.current && onFirstMessage) {
        namedRef.current = true;
        const name = text.length > 40 ? text.slice(0, 40) + "..." : text;
        onFirstMessage(sessionId, name);
      }
    },
    [input, busy, sendMessage, sessionId, onFirstMessage],
  );

  const handleSuggestion = useCallback(
    (text: string) => {
      if (busy) return;
      sendMessage(text);

      if (!namedRef.current && onFirstMessage) {
        namedRef.current = true;
        const name = text.length > 40 ? text.slice(0, 40) + "..." : text;
        onFirstMessage(sessionId, name);
      }
    },
    [busy, sendMessage, sessionId, onFirstMessage],
  );

  return (
    <>
      {/* ── Chat column ──────────────────────────────────── */}
      <div className="chat-main">
        {timeline.length === 0 && !busy ? (
          <div className="chat-messages">
            <div className="chat-messages-inner">
              <EmptyState onSuggestion={handleSuggestion} />
            </div>
          </div>
        ) : (
          <div ref={scrollRef} className="chat-messages">
            <Render
              glove={glove}
              strategy="interleaved"
              renderMessage={renderMessage}
              renderStreaming={renderStreaming}
              renderToolStatus={renderToolStatus}
              renderInput={() => null}
              className="chat-messages-inner"
            />

            {/* Typing indicator */}
            {busy && !streamingText && slots.length === 0 && (
              <div className="typing-indicator">
                <div className="agent-avatar">
                  <CoffeeIcon color="#3d5a3d" size={14} />
                </div>
                <div className="typing-dots">
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                </div>
              </div>
            )}
          </div>
        )}

        <ChatInput
          input={input}
          setInput={setInput}
          busy={busy}
          onSubmit={handleSubmit}
          onAbort={abort}
          voice={voice}
          turnMode={turnMode}
          onTurnModeChange={setTurnMode}
          isManualRecording={isManualRecording}
          isProcessing={isProcessing}
          onManualRecordStart={handleManualRecordStart}
          onManualRecordStop={handleManualRecordStop}
        />
      </div>

      {/* ── Right panel ──────────────────────────────────── */}
      <RightPanel cart={cart} timeline={timeline} stats={stats} />
    </>
  );
}
