import React from "react";
import type { UseGloveVoiceReturn } from "glove-react/voice";
import { SendIcon, MicIcon, StopCircleIcon } from "./icons";
import { VoiceOrb } from "./voice-orb";

// ─── Chat input bar ─────────────────────────────────────────────────────────
//
// Two-mode input area that smoothly transitions between text and voice.
//
// Text mode (default):
//   [mic]  [___text input___]  [send]
//   The mic button sits at the leading edge, easy to discover and reach.
//
// Voice mode (active):
//   A centered VoiceOrb replaces the text input row. An "End" button
//   at the trailing edge provides an explicit exit. The entire area
//   has a subtle background shift to signal the mode change.
//
// The transition uses CSS opacity + transform for a fluid crossfade.

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  onSubmit: (e: { preventDefault: () => void }) => void;
  onAbort: () => void;
  voice: UseGloveVoiceReturn;
}

export function ChatInput({
  input,
  setInput,
  busy,
  onSubmit,
  onAbort,
  voice,
}: ChatInputProps) {
  const handleMicClick = () => {
    void voice.start();
  };

  const handleVoiceStop = () => {
    void voice.stop();
  };

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
            <button
              type="button"
              className="mic-btn"
              onClick={handleMicClick}
              title="Start voice conversation"
              aria-label="Start voice conversation"
            >
              <MicIcon color="#3d5a3d" size={16} />
            </button>

            <input
              type="text"
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about our coffee..."
              disabled={busy || voice.isActive}
              autoFocus
            />

            {busy ? (
              <button type="button" className="abort-btn" onClick={onAbort}>
                Stop
              </button>
            ) : (
              <button
                type="submit"
                className="send-btn"
                disabled={!input.trim() || voice.isActive}
              >
                <SendIcon />
              </button>
            )}
          </form>
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
            onStop={handleVoiceStop}
            onInterrupt={voice.interrupt}
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
