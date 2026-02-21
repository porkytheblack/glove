import React from "react";
import type { UseGloveVoiceReturn, TurnMode } from "glove-react/voice";
import { SendIcon, MicIcon, StopCircleIcon } from "./icons";
import { VoiceOrb } from "./voice-orb";

// ─── Chat input bar ─────────────────────────────────────────────────────────
//
// Two-mode input area that smoothly transitions between text and voice.
//
// Text mode (default):
//   [___text input___]  [mic | send]
//   Below the input row sits a compact voice-mode selector: Auto | Push to speak
//   The mic button and send button share the trailing slot — mic shows when the
//   input is empty, send shows when there's text. This naturally guides the user:
//   type to chat, or tap the mic when the input is clear.
//
// Voice mode (active):
//   A centered VoiceOrb replaces the text input row. An "End" button
//   at the trailing edge provides an explicit exit. The entire area
//   has a subtle background shift to signal the mode change.
//
//   In manual (push-to-speak) mode, the orb acts as a click-to-toggle
//   recording button. Space bar acts as hold-to-speak while voice is active.
//
// The transition uses CSS opacity + transform for a fluid crossfade.

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  onSubmit: (e: { preventDefault: () => void }) => void;
  onAbort: () => void;
  voice: UseGloveVoiceReturn;
  turnMode: TurnMode;
  onTurnModeChange: (mode: TurnMode) => void;
  /** Whether the user is actively holding the space bar / recording in manual mode */
  isManualRecording: boolean;
  /** Whether we're waiting for STT to finalize after recording stopped */
  isProcessing: boolean;
  onManualRecordStart: () => void;
  onManualRecordStop: () => void;
}

export function ChatInput({
  input,
  setInput,
  busy,
  onSubmit,
  onAbort,
  voice,
  turnMode,
  onTurnModeChange,
  isManualRecording,
  isProcessing,
  onManualRecordStart,
  onManualRecordStop,
}: ChatInputProps) {
  const handleMicClick = () => {
    void voice.start();
  };

  const handleVoiceStop = () => {
    void voice.stop();
  };

  // Disable mode switching when voice is actively processing (thinking or speaking)
  const canSwitchMode = !voice.isActive || voice.mode === "listening";
  const hasText = input.trim().length > 0;

  return (
    <div className={`chat-input-area ${voice.isActive ? "chat-input-area--voice" : ""}`}>
      <div className="chat-input-inner">
        {/* ── Text mode ────────────────────────────────────────── */}
        <div
          className={`chat-input-mode chat-input-mode--text ${
            voice.isActive ? "chat-input-mode--hidden" : ""
          }`}
          aria-hidden={voice.isActive}
        >
          <form className="chat-input-row" onSubmit={onSubmit}>
            <input
              type="text"
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about our coffee..."
              disabled={busy || voice.isActive}
              autoFocus
            />

            {/* ── Trailing actions: contextual mic / send / abort ─── */}
            <div className="input-trailing">
              {busy ? (
                <button type="button" className="abort-btn" onClick={onAbort}>
                  Stop
                </button>
              ) : hasText ? (
                <button
                  type="submit"
                  className="send-btn"
                  disabled={voice.isActive}
                >
                  <SendIcon />
                </button>
              ) : (
                <button
                  type="button"
                  className="mic-btn"
                  onClick={handleMicClick}
                  title={turnMode === "vad" ? "Start voice (auto mode)" : "Start voice (push to speak)"}
                  aria-label="Start voice conversation"
                >
                  <MicIcon color="#3d5a3d" size={18} />
                </button>
              )}
            </div>
          </form>

          {/* ── Voice mode selector below the input ────────────── */}
          <div className="voice-mode-bar">
            <span className="voice-mode-label">Voice mode</span>
            <TurnModeToggle
              turnMode={turnMode}
              onChange={onTurnModeChange}
              disabled={!canSwitchMode}
            />
          </div>
        </div>

        {/* ── Voice mode ───────────────────────────────────────── */}
        <div
          className={`chat-input-mode chat-input-mode--voice ${
            voice.isActive ? "" : "chat-input-mode--hidden"
          }`}
          aria-hidden={!voice.isActive}
        >
          <VoiceOrb
            mode={voice.mode}
            transcript={voice.transcript}
            turnMode={turnMode}
            isManualRecording={isManualRecording}
            isProcessing={isProcessing}
            onStop={handleVoiceStop}
            onInterrupt={voice.interrupt}
            onManualRecordStart={onManualRecordStart}
            onManualRecordStop={onManualRecordStop}
          />

          <button
            type="button"
            className="voice-end-btn"
            onClick={handleVoiceStop}
            aria-label="End voice session"
          >
            <StopCircleIcon color="#3d5a3d" size={16} />
            <span>End</span>
          </button>
        </div>

        {/* ── Footer ───────────────────────────────────────────── */}
        <div className="chat-footer">
          <span className="footer-label">POWERED BY</span>
          <span className="footer-brand">Glove</span>
          <span className="footer-dot">·</span>
          <span className="footer-url">dterminal.net</span>
        </div>
      </div>
    </div>
  );
}

// ─── Turn mode segmented control ─────────────────────────────────────────────
//
// A compact, two-option segmented control: Auto | Push to speak
//
// Design rationale:
//   - Sits below the text input as a secondary preference control.
//   - Small and unobtrusive — doesn't compete with the primary input.
//   - Uses pill-shaped segments with a sliding background indicator.
//   - Disabled state greys out and prevents switching mid-conversation.
//   - "Auto" = VAD-based hands-free detection.
//   - "Push to speak" = manual mode, hold space or click mic to record.

interface TurnModeToggleProps {
  turnMode: TurnMode;
  onChange: (mode: TurnMode) => void;
  disabled: boolean;
}

function TurnModeToggle({ turnMode, onChange, disabled }: TurnModeToggleProps) {
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
        onClick={() => onChange("vad")}
        disabled={disabled}
      >
        Auto
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={turnMode === "manual"}
        className={`turn-mode-option ${turnMode === "manual" ? "turn-mode-option--active" : ""}`}
        onClick={() => onChange("manual")}
        disabled={disabled}
      >
        Push to speak
      </button>
    </div>
  );
}
