import React, { useRef, useEffect } from "react";

// ---- Text input (hidden by default, slides up) -----------------------------
//
// A secondary text input that slides up from the bottom when toggled. Provides
// a keyboard-based alternative to voice for users who prefer typing.
//
// The toggle button (keyboard icon) sits near the bottom-right of the orb area.
// It visually changes state when the input panel is open (active highlight).
// When visible, the panel slides up smoothly with opacity + transform.

interface TextInputProps {
  visible: boolean;
  onToggle: () => void;
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  onSubmit: (e: { preventDefault: () => void }) => void;
}

export function TextInput({
  visible,
  onToggle,
  input,
  setInput,
  busy,
  onSubmit,
}: TextInputProps) {
  const hasText = input.trim().length > 0;
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the text input when the panel becomes visible
  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [visible]);

  return (
    <>
      {/* Keyboard icon toggle -- positioned near bottom-right */}
      <button
        type="button"
        className={`text-toggle-btn ${visible ? "text-toggle-btn--active" : ""}`}
        onClick={onToggle}
        aria-label={visible ? "Hide text input" : "Type a message"}
        aria-expanded={visible}
        style={{
          position: "absolute",
          bottom: 8,
          right: 16,
        }}
      >
        <KeyboardIcon />
      </button>

      {/* Slide-up text input panel */}
      <div
        className={`text-input-area ${visible ? "text-input-area--visible" : ""}`}
        aria-hidden={!visible}
      >
        <form className="text-input-row" onSubmit={onSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="text-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about a movie..."
            disabled={busy}
            autoComplete="off"
            tabIndex={visible ? 0 : -1}
          />
          <button
            type="submit"
            className="text-send-btn"
            disabled={busy || !hasText}
            aria-label="Send message"
            tabIndex={visible ? 0 : -1}
          >
            <SendIcon />
          </button>
        </form>
      </div>
    </>
  );
}

// ---- Inline SVG icons ------------------------------------------------------

function KeyboardIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="0" />
      <line x1="6" y1="8" x2="6" y2="8" />
      <line x1="10" y1="8" x2="10" y2="8" />
      <line x1="14" y1="8" x2="14" y2="8" />
      <line x1="18" y1="8" x2="18" y2="8" />
      <line x1="6" y1="12" x2="6" y2="12" />
      <line x1="10" y1="12" x2="10" y2="12" />
      <line x1="14" y1="12" x2="14" y2="12" />
      <line x1="18" y1="12" x2="18" y2="12" />
      <line x1="8" y1="16" x2="16" y2="16" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
