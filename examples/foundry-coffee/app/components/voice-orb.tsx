import React from "react";
import type { VoiceMode } from "glove-react/voice";
import { MicIcon } from "./icons";

// The orb from the coffee example, for hands-free modes only:
//   listening: a slow pulse; thinking: the ring turns; speaking: ripples.
// Tapping it while the barista speaks interrupts; otherwise it ends voice.

export function VoiceOrb({ mode, transcript, hint, onStop, onInterrupt }: {
  mode: VoiceMode;
  transcript: string;
  /** Shown while listening with nothing heard yet. */
  hint: string;
  onStop: () => void;
  onInterrupt: () => void;
}) {
  const status =
    mode === "listening" ? transcript || hint : mode === "thinking" ? "Thinking..." : mode === "speaking" ? "Speaking..." : "";
  return (
    <div className="voice-orb-container">
      <button
        className={`voice-orb voice-orb--${mode}`}
        onClick={mode === "speaking" ? onInterrupt : onStop}
        aria-label={mode === "speaking" ? "Interrupt and speak" : "End voice session"}
        type="button"
      >
        <span className="voice-orb__ring voice-orb__ring--outer" aria-hidden="true" />
        <span className="voice-orb__ring voice-orb__ring--middle" aria-hidden="true" />
        <span className="voice-orb__core">
          <MicIcon color="#fefdfb" size={20} />
        </span>
      </button>
      <p
        className={`voice-orb__status ${mode === "listening" && transcript ? "voice-orb__status--transcript" : ""}`}
        aria-live="polite"
      >
        {status}
      </p>
    </div>
  );
}
