import React from "react";
import type { UseGloveVoiceReturn } from "glove-react/voice";
import { TURN_LABELS, type TurnDetection, type VoiceSettings } from "../lib/voice";
import { MicIcon, SendIcon, StopCircleIcon } from "./icons";
import { VoiceOrb } from "./voice-orb";

// The coffee example's input bar: a text row with a mic, replaced by the orb
// while voice is on. The row under it picks how Scribe is used.

const HINTS: Record<TurnDetection, string> = {
  "scribe-turn": "Listening... Scribe decides when you are done",
  "scribe-vad": "Listening... Scribe ends the turn after a pause",
  "local-vad": "Listening...",
};

export function ChatInput({ input, setInput, busy, ready, onSubmit, onStop, voice, onStartVoice, voiceStarting, voiceAvailable, settings, onSettings }: {
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  ready: boolean;
  onSubmit: (e: { preventDefault: () => void }) => void;
  onStop: () => void;
  voice: UseGloveVoiceReturn;
  onStartVoice: () => void;
  /** The microphone and Scribe are being connected. */
  voiceStarting: boolean;
  /** False when ELEVENLABS_API_KEY is not set. */
  voiceAvailable: boolean;
  settings: VoiceSettings;
  onSettings: (settings: VoiceSettings) => void;
}) {
  const hasText = input.trim().length > 0;
  return (
    <div className={`chat-input-area ${voice.isActive ? "chat-input-area--voice" : ""}`}>
      <div className="chat-input-inner">
        {/* `inert` takes the hidden mode out of the tab order as well as out of sight. */}
        <div className={`chat-input-mode chat-input-mode--text ${voice.isActive ? "chat-input-mode--hidden" : ""}`} aria-hidden={voice.isActive} inert={voice.isActive}>
          <form className="chat-input-row" onSubmit={onSubmit}>
            <input
              type="text"
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ready ? "Ask about our coffee..." : "Connecting to the shop..."}
              disabled={busy || voice.isActive || !ready}
              autoFocus
            />
            <div className="input-trailing">
              {busy ? (
                <button type="button" className="abort-btn" onClick={onStop}>Stop</button>
              ) : hasText ? (
                <button type="submit" className="send-btn" disabled={!ready} aria-label="Send message"><SendIcon /></button>
              ) : (
                <button
                  type="button"
                  className="mic-btn"
                  onClick={onStartVoice}
                  disabled={!ready || !voiceAvailable || voiceStarting}
                  title={voiceAvailable ? `Start voice (${TURN_LABELS[settings.turns]})` : "Set ELEVENLABS_API_KEY to use voice"}
                  aria-label="Start voice conversation"
                >
                  <MicIcon color="#3d5a3d" size={18} />
                </button>
              )}
            </div>
          </form>

          <div className="voice-mode-bar voice-settings">
            <span className="voice-mode-label">Turns end by</span>
            <div className="turn-mode-toggle" role="radiogroup" aria-label="Who ends the turn">
              {(Object.keys(TURN_LABELS) as TurnDetection[]).map((turns) => (
                <button
                  key={turns}
                  type="button"
                  role="radio"
                  aria-checked={settings.turns === turns}
                  className={`turn-mode-option ${settings.turns === turns ? "turn-mode-option--active" : ""}`}
                  onClick={() => onSettings({ ...settings, turns })}
                >
                  {TURN_LABELS[turns]}
                </button>
              ))}
            </div>
            <label className="voice-check">
              <input type="checkbox" checked={settings.speakers} onChange={(e) => onSettings({ ...settings, speakers: e.target.checked })} />
              Tell speakers apart
            </label>
          </div>
        </div>

        <div className={`chat-input-mode chat-input-mode--voice ${voice.isActive ? "" : "chat-input-mode--hidden"}`} aria-hidden={!voice.isActive} inert={!voice.isActive}>
          <VoiceOrb
            mode={voice.mode}
            transcript={voice.transcript}
            hint={HINTS[settings.turns]}
            onStop={() => void voice.stop()}
            onInterrupt={voice.interrupt}
          />
          <button type="button" className="voice-end-btn" onClick={() => void voice.stop()} aria-label="End voice session">
            <StopCircleIcon color="#3d5a3d" size={16} />
            <span>End</span>
          </button>
        </div>

        <div className="chat-footer">
          <span className="footer-label">POWERED BY</span>
          <span className="footer-brand">Glove Foundry</span>
          <span className="footer-dot">·</span>
          <span className="footer-url">Scribe v3 Live</span>
        </div>
      </div>
    </div>
  );
}
