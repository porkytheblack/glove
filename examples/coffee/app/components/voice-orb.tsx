import React from "react";
import type { VoiceMode, TurnMode } from "glove-react/voice";
import { MicIcon } from "./icons";

// ─── Voice orb ──────────────────────────────────────────────────────────────
//
// A centered, animated orb that communicates voice state through motion:
//   - listening:  gentle breathing pulse on outer ring — "I'm here, speak"
//   - thinking:   ring tightens and rotates — "processing your words"
//   - speaking:   concentric ripples expand outward — "sound is coming from me"
//
// In VAD (auto) mode, the orb is the primary touch target for ending a voice
// session. Tapping during any active state returns to idle. During speaking,
// this also triggers barge-in (interrupt), snapping immediately to listening.
//
// In manual (push-to-speak) mode, the orb behavior changes:
//   - listening + not recording: click starts recording (orb turns red/active)
//   - listening + recording: click stops recording and commits the turn
//   - thinking/speaking: click triggers barge-in (same as auto)
//
// A distinct "recording" visual (warm red glow) differentiates manual
// recording from the passive listening state.

interface VoiceOrbProps {
  mode: VoiceMode;
  transcript: string;
  turnMode: TurnMode;
  isManualRecording: boolean;
  /** Waiting for STT to finalize after user stopped recording */
  isProcessing: boolean;
  onStop: () => void;
  onInterrupt: () => void;
  onManualRecordStart: () => void;
  onManualRecordStop: () => void;
}

export function VoiceOrb({
  mode,
  transcript,
  turnMode,
  isManualRecording,
  isProcessing,
  onStop,
  onInterrupt,
  onManualRecordStart,
  onManualRecordStop,
}: VoiceOrbProps) {
  const isManual = turnMode === "manual";

  const handleClick = () => {
    if (mode === "speaking") {
      onInterrupt();
    } else if (isProcessing) {
      // User can cancel while processing — end the session
      onStop();
    } else if (isManual && mode === "listening") {
      if (isManualRecording) {
        onManualRecordStop();
      } else {
        onManualRecordStart();
      }
    } else {
      onStop();
    }
  };

  // Build the orb CSS class.
  const isRecording = isManual && isManualRecording && mode === "listening";
  const orbClass = isProcessing
    ? "voice-orb voice-orb--processing"
    : isRecording
      ? "voice-orb voice-orb--recording"
      : `voice-orb voice-orb--${mode}`;

  // Status text adapts to turn mode and processing state
  const statusText = (() => {
    if (isProcessing) {
      return "Processing...";
    }
    if (isRecording) {
      return transcript || "Recording... release to send";
    }
    if (isManual && mode === "listening" && !isManualRecording) {
      return "Hold space or click to speak";
    }
    if (mode === "listening" && transcript) {
      return transcript;
    }
    if (mode === "listening") {
      return "Listening...";
    }
    if (mode === "thinking") {
      return "Thinking...";
    }
    return "Speaking...";
  })();

  // Aria label adapts to context
  const ariaLabel = (() => {
    if (isProcessing) return "Processing — click to cancel";
    if (mode === "speaking") return "Interrupt and speak";
    if (isManual && mode === "listening") {
      return isManualRecording ? "Stop recording and send" : "Start recording";
    }
    return "End voice session";
  })();

  return (
    <div className="voice-orb-container">
      {/* The orb itself — layered rings + icon center */}
      <button
        className={orbClass}
        onClick={handleClick}
        aria-label={ariaLabel}
        type="button"
      >
        {/* Outer ring: breathing (listening), spinning (thinking), rippling (speaking), pulsing (recording) */}
        <span className="voice-orb__ring voice-orb__ring--outer" aria-hidden="true" />

        {/* Middle ring: visible during speaking (ripple depth) and recording (warm glow) */}
        <span className="voice-orb__ring voice-orb__ring--middle" aria-hidden="true" />

        {/* Core: the mic icon, always present */}
        <span className="voice-orb__core">
          <MicIcon color="#fefdfb" size={20} />
        </span>
      </button>

      {/* Status text below the orb */}
      <p
        className={`voice-orb__status ${
          isProcessing
            ? "voice-orb__status--processing"
            : isRecording
              ? "voice-orb__status--recording"
              : mode === "listening" && transcript
                ? "voice-orb__status--transcript"
                : ""
        }`}
        aria-live="polite"
      >
        {statusText}
      </p>
    </div>
  );
}
