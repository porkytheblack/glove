import { SendIcon } from "./icons";

// ─── Chat input bar ─────────────────────────────────────────────────────────

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  onSubmit: (e: { preventDefault: () => void }) => void;
  onAbort: () => void;
}

export function ChatInput({
  input,
  setInput,
  busy,
  onSubmit,
  onAbort,
}: ChatInputProps) {
  return (
    <div className="chat-input-area">
      <div className="chat-input-inner">
        <form className="chat-input-row" onSubmit={onSubmit}>
          <input
            type="text"
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about our coffee..."
            disabled={busy}
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
              disabled={!input.trim()}
            >
              <SendIcon />
            </button>
          )}
        </form>
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
