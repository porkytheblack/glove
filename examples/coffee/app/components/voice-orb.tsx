import React from "react";
import type { VoiceMode } from "glove-react/voice";
import { MicIcon } from "./icons";

// ─── Voice orb ──────────────────────────────────────────────────────────────
//
// A centered, animated orb that communicates voice state through motion:
//   - listening:  gentle breathing pulse on outer ring — "I'm here, speak"
//   - thinking:   ring tightens and rotates — "processing your words"
//   - speaking:   concentric ripples expand outward — "sound is coming from me"
//
// The orb is the primary touch target for ending a voice session. Tapping
// during any active state returns to idle. During speaking, this also
// triggers barge-in (interrupt), snapping immediately to listening.

interface VoiceOrbProps {
  mode: VoiceMode;
  transcript: string;
  onStop: () => void;
  onInterrupt: () => void;
}

export function VoiceOrb({ mode, transcript, onStop, onInterrupt }: VoiceOrbProps) {
  const handleClick = () => {
    if (mode === "speaking") {
      // Barge-in: interrupt the agent, return to listening
      onInterrupt();
    } else {
      // Any other active state: end the session
      onStop();
    }
  };

  const statusText =
    mode === "listening" && transcript
      ? transcript
      : mode === "listening"
        ? "Listening..."
        : mode === "thinking"
          ? "Thinking..."
          : "Speaking...";

  return (
    <div className="voice-orb-container">
      {/* The orb itself — layered rings + icon center */}
      <button
        className={`voice-orb voice-orb--${mode}`}
        onClick={handleClick}
        aria-label={
          mode === "speaking"
            ? "Interrupt and speak"
            : "End voice session"
        }
        type="button"
      >
        {/* Outer ring: breathing (listening), spinning (thinking), rippling (speaking) */}
        <span className="voice-orb__ring voice-orb__ring--outer" aria-hidden="true" />

        {/* Middle ring: only visible during speaking for ripple depth */}
        <span className="voice-orb__ring voice-orb__ring--middle" aria-hidden="true" />

        {/* Core: the mic icon, always present */}
        <span className="voice-orb__core">
          <MicIcon color="#fefdfb" size={20} />
        </span>
      </button>

      {/* Status text below the orb */}
      <p
        className={`voice-orb__status ${
          mode === "listening" && transcript ? "voice-orb__status--transcript" : ""
        }`}
        aria-live="polite"
      >
        {statusText}
      </p>
    </div>
  );
}
