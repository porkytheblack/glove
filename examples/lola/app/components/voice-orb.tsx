import React from "react";
import type { VoiceMode, TurnMode } from "glove-react/voice";

// ---- Voice orb -------------------------------------------------------------
//
// An 80px sharp square orb (amber/charcoal palette) that communicates voice
// state through layered ring animations and ambient glow:
//   - listening:  gentle breathing pulse -- "I'm here, speak"
//   - thinking:   counter-rotating dashed rings -- "processing your words"
//   - speaking:   concentric ripples expanding -- "sound is coming from me"
//   - recording:  warm orange pulse -- "capturing your voice"
//   - processing: subdued spin -- "finalizing transcription"
//
// The orb has three concentric ring layers for visual depth. The core icon
// adapts between a mic (listening/recording) and a pause icon (speaking)
// to reinforce the current interaction mode.

interface VoiceOrbProps {
  mode: VoiceMode;
  transcript: string;
  turnMode: TurnMode;
  isManualRecording: boolean;
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

  // Build the orb CSS class
  const isRecording = isManual && isManualRecording && mode === "listening";
  const orbClass = isProcessing
    ? "voice-orb voice-orb--processing"
    : isRecording
      ? "voice-orb voice-orb--recording"
      : `voice-orb voice-orb--${mode}`;

  // Icon adapts to state: pause bars when speaking, mic otherwise
  const iconColor = mode === "thinking" || isProcessing ? "#faf7f2" : "#0d0d0f";
  const showPause = mode === "speaking";

  // Status text adapts to turn mode and processing state
  const statusText = (() => {
    if (isProcessing) {
      return "Processing...";
    }
    if (isRecording) {
      return transcript || "Recording...";
    }
    if (isManual && mode === "listening" && !isManualRecording) {
      return "Hold space or tap to speak";
    }
    if (mode === "listening" && transcript) {
      return transcript;
    }
    if (mode === "listening") {
      return "Listening";
    }
    if (mode === "thinking") {
      return "Thinking";
    }
    return "Speaking";
  })();

  // Aria label for accessibility
  const ariaLabel = (() => {
    if (isProcessing) return "Processing -- tap to cancel";
    if (mode === "speaking") return "Tap to interrupt";
    if (isManual && mode === "listening") {
      return isManualRecording ? "Stop recording and send" : "Start recording";
    }
    return "End voice session";
  })();

  return (
    <div className="voice-orb-container">
      <button
        className={orbClass}
        onClick={handleClick}
        aria-label={ariaLabel}
        type="button"
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
          {showPause ? (
            <PauseIcon color={iconColor} size={18} />
          ) : (
            <MicIcon color={iconColor} size={20} />
          )}
        </span>
      </button>

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

// ---- Inline SVG icons ------------------------------------------------------

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

function PauseIcon({
  color = "#0d0d0f",
  size = 18,
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
      strokeWidth="2.5"
      strokeLinecap="square"
      strokeLinejoin="round"
    >
      <line x1="8" y1="5" x2="8" y2="19" />
      <line x1="16" y1="5" x2="16" y2="19" />
    </svg>
  );
}
