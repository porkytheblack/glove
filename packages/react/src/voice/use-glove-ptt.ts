"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useGloveVoice, type UseGloveVoiceReturn } from "./use-glove-voice";
import type { GloveVoiceConfig, VoiceMode } from "glove-voice";
import type { IGloveRunnable } from "glove-core/glove";

// ─── Config ─────────────────────────────────────────────────────────────────

export interface UseGlovePTTConfig {
  /** The Glove runnable instance — pass `useGlove().runnable`. */
  runnable: IGloveRunnable | null;

  /** Voice pipeline config (STT adapter, TTS factory, etc.). `turnMode` is forced to `"manual"`. */
  voice: Omit<GloveVoiceConfig, "turnMode">;

  /**
   * Hotkey for push-to-talk (default: `"Space"`).
   * Uses `KeyboardEvent.code` values (e.g. `"Space"`, `"KeyT"`, `"ControlLeft"`).
   * Set to `false` to disable keyboard binding entirely.
   *
   * Automatically ignores key events when the focused element is an
   * `<input>`, `<textarea>`, or `<select>`.
   */
  hotkey?: string | false;

  /**
   * Hold duration threshold in ms for click-vs-hold discrimination (default: 300).
   * - Quick click (< threshold) on the mic button → toggles voice on/off
   * - Hold (≥ threshold) → PTT recording
   */
  holdThreshold?: number;

  /**
   * Minimum recording duration in ms before committing a turn (default: 350).
   * If the user releases before this threshold, the mic stays hot and the
   * commit is delayed until the minimum is reached. This ensures enough audio
   * reaches the STT provider for accurate transcription.
   */
  minRecordingMs?: number;
}

// ─── Return type ────────────────────────────────────────────────────────────

export interface UseGlovePTTReturn {
  /** Whether the voice pipeline is enabled (user toggled voice on). */
  enabled: boolean;

  /** Whether the user is currently holding to record. */
  recording: boolean;

  /** Whether STT is finalizing after a short recording. */
  processing: boolean;

  /** Current voice pipeline state: idle → listening → thinking → speaking */
  mode: VoiceMode;

  /** Current partial transcript while user is speaking. */
  transcript: string;

  /** Last error from the voice pipeline. */
  error: Error | null;

  /** Toggle the voice pipeline on/off. */
  toggle: () => Promise<void>;

  /** Interrupt current response (barge-in). */
  interrupt: () => void;

  /**
   * Pointer event handlers to spread onto a mic button.
   *
   * Includes click-vs-hold discrimination:
   * - Quick click → toggle voice on/off
   * - Hold → PTT recording (unmute on down, commit on up)
   *
   * Also handles `onPointerLeave` to commit the turn if the
   * pointer drifts off the button while holding.
   *
   * @example
   * ```tsx
   * <button {...ptt.bind}>
   *   <MicIcon />
   * </button>
   * ```
   */
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerLeave: (e: React.PointerEvent) => void;
  };

  /** The underlying voice hook return — for advanced use cases. */
  voice: UseGloveVoiceReturn;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * High-level React hook for push-to-talk voice interaction.
 *
 * Encapsulates the full PTT lifecycle:
 * - Pipeline enable/disable (toggle)
 * - Auto-mute on start (manual mode)
 * - Unmute on hold, commit + re-mute on release
 * - Keyboard hotkey binding (Space by default)
 * - Click-vs-hold discrimination on mic button
 * - Minimum recording duration enforcement
 * - Auto-sync of enabled state on pipeline death
 *
 * @example
 * ```tsx
 * const glove = useGlove({ endpoint: "/api/chat", tools });
 * const ptt = useGlovePTT({
 *   runnable: glove.runnable,
 *   voice: { stt, createTTS },
 *   hotkey: "Space",
 * });
 *
 * return (
 *   <>
 *     <Render glove={glove} voice={ptt} />
 *     <button {...ptt.bind}><MicIcon /></button>
 *   </>
 * );
 * ```
 */
export function useGlovePTT(config: UseGlovePTTConfig): UseGlovePTTReturn {
  const {
    runnable,
    voice: voiceConfigBase,
    hotkey = "Space",
    holdThreshold = 300,
    minRecordingMs = 350,
  } = config;

  // Force manual turn mode and startMuted
  const voiceConfig = useMemo<GloveVoiceConfig>(
    () => ({ ...voiceConfigBase, turnMode: "manual", startMuted: true }),
    [voiceConfigBase],
  );

  const voice = useGloveVoice({ runnable, voice: voiceConfig });

  // ── Recording state ─────────────────────────────────────────────────────

  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);

  const recordingRef = useRef(false);
  const recordingStartRef = useRef(0);
  const pendingCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerDownTimeRef = useRef(0);
  const holdingRef = useRef(false);

  // Stable ref for voice methods to avoid listener churn
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  // ── Reset recording state when mode changes ─────────────────────────────

  useEffect(() => {
    if (voice.mode !== "listening") {
      recordingRef.current = false;
      setRecording(false);
      setProcessing(false);
      if (pendingCommitRef.current) {
        clearTimeout(pendingCommitRef.current);
        pendingCommitRef.current = null;
      }
    }
  }, [voice.mode]);

  // ── Toggle ──────────────────────────────────────────────────────────────

  const toggle = useCallback(async () => {
    if (voiceRef.current.enabled) {
      await voiceRef.current.stop();
    } else {
      await voiceRef.current.start();
    }
  }, []);

  // ── PTT down/up ─────────────────────────────────────────────────────────

  const pttDown = useCallback(() => {
    const v = voiceRef.current;
    if (!v.enabled || v.mode !== "listening") return;
    if (recordingRef.current) return;

    recordingRef.current = true;
    recordingStartRef.current = Date.now();
    setProcessing(false);
    setRecording(true);
    v.unmute();
  }, []);

  const pttUp = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);

    const v = voiceRef.current;
    v.mute();

    const elapsed = Date.now() - recordingStartRef.current;

    if (elapsed >= minRecordingMs) {
      setProcessing(true);
      v.commitTurn();
    } else {
      // Not enough audio — keep mic hot briefly, then commit
      setProcessing(true);
      v.unmute(); // keep feeding audio
      const remaining = minRecordingMs - elapsed;
      pendingCommitRef.current = setTimeout(() => {
        pendingCommitRef.current = null;
        voiceRef.current.mute();
        voiceRef.current.commitTurn();
      }, remaining);
    }
  }, [minRecordingMs]);

  // ── Keyboard binding ────────────────────────────────────────────────────

  useEffect(() => {
    if (hotkey === false || !voice.enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== hotkey || e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      pttDown();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== hotkey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      pttUp();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [hotkey, voice.enabled, pttDown, pttUp]);

  // ── Pointer bind (click-vs-hold discrimination) ─────────────────────────

  const onPointerDown = useCallback(
    (_e: React.PointerEvent) => {
      pointerDownTimeRef.current = Date.now();
      holdingRef.current = false;

      // If voice is enabled and listening, start PTT immediately
      // (will be treated as hold if pointer stays down long enough)
      if (voice.enabled && voice.mode === "listening") {
        holdingRef.current = true;
        pttDown();
      }
    },
    [voice.enabled, voice.mode, pttDown],
  );

  const onPointerUp = useCallback(
    (_e: React.PointerEvent) => {
      const elapsed = Date.now() - pointerDownTimeRef.current;

      if (elapsed < holdThreshold) {
        // Quick click → toggle voice
        if (holdingRef.current) {
          // Cancel the PTT that started on pointer down
          recordingRef.current = false;
          setRecording(false);
          voiceRef.current.mute();
        }
        void toggle();
      } else if (holdingRef.current) {
        // Long hold → release PTT
        pttUp();
      }

      holdingRef.current = false;
    },
    [holdThreshold, toggle, pttUp],
  );

  const onPointerLeave = useCallback(
    (_e: React.PointerEvent) => {
      if (holdingRef.current) {
        pttUp();
        holdingRef.current = false;
      }
    },
    [pttUp],
  );

  const bind = useMemo(
    () => ({ onPointerDown, onPointerUp, onPointerLeave }),
    [onPointerDown, onPointerUp, onPointerLeave],
  );

  return {
    enabled: voice.enabled,
    recording,
    processing,
    mode: voice.mode,
    transcript: voice.transcript,
    error: voice.error,
    toggle,
    interrupt: voice.interrupt,
    bind,
    voice,
  };
}
