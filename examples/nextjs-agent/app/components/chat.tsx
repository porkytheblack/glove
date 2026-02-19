"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { useGlove, Render } from "glove-react";
import type {
  MessageRenderProps,
  StreamingRenderProps,
  ToolStatusRenderProps,
  InputRenderProps,
} from "glove-react";

// ─── Render callbacks ───────────────────────────────────────────────────────

function renderMessage({ entry }: MessageRenderProps): ReactNode {
  if (entry.kind === "user") {
    return (
      <div className="message user-message">
        <div className="message-content">{entry.text}</div>
      </div>
    );
  }
  return (
    <div className="message agent-message">
      <div className="message-content">{entry.text}</div>
    </div>
  );
}

function renderStreaming({ text }: StreamingRenderProps): ReactNode {
  return (
    <div className="message agent-message streaming">
      <div className="message-content">{text}</div>
    </div>
  );
}

function renderToolStatus({ entry, hasSlot }: ToolStatusRenderProps): ReactNode {
  // Hide the tool status pill when there is a renderResult or active slot
  // showing for this tool — keeps things clean
  if (hasSlot) return null;

  return (
    <div className="tool-entry">
      <div className={`tool-badge ${entry.status}`}>
        {entry.status === "running"
          ? "..."
          : entry.status === "success"
            ? "ok"
            : "err"}
      </div>
      <div className="tool-info">
        <span className="tool-name">{entry.name}</span>
        {entry.output && (
          <span className="tool-output">{entry.output}</span>
        )}
      </div>
    </div>
  );
}

// ─── Chat component ─────────────────────────────────────────────────────────

export default function Chat() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const glove = useGlove();
  const { timeline, streamingText, busy, stats, slots, sendMessage, abort } =
    glove;

  // Auto-scroll on new content
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [timeline, streamingText, slots]);

  const handleSend = useCallback(
    (text: string) => {
      if (!text.trim() || busy) return;
      setInput("");
      sendMessage(text.trim());
    },
    [busy, sendMessage],
  );

  const renderInput = useCallback(
    ({ send, busy: isBusy, abort: doAbort }: InputRenderProps): ReactNode => {
      return (
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            const text = input.trim();
            if (!text || isBusy) return;
            setInput("");
            send(text);
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={isBusy}
            autoFocus
          />
          {isBusy ? (
            <button type="button" onClick={doAbort} className="abort-btn">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()}>
              Send
            </button>
          )}
        </form>
      );
    },
    [input],
  );

  return (
    <div className="chat-container">
      {/* Header */}
      <header className="chat-header">
        <h1>Trip Planner</h1>
        <span className="stats">
          {stats.turns > 0 &&
            `${stats.turns} turns | ${stats.tokens_in + stats.tokens_out} tokens`}
        </span>
      </header>

      {/* Timeline + Slots */}
      {timeline.length === 0 && !busy ? (
        <div className="chat-messages">
          <div className="empty-state">
            <p>Where are we headed?</p>
            <p className="hint">
              Try: &quot;Plan a weekend trip to Tokyo&quot; or
              &quot;Help me plan a 5-day Italy road trip for two&quot;
            </p>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="chat-messages">
          <Render
            glove={glove}
            strategy="interleaved"
            renderMessage={renderMessage}
            renderStreaming={renderStreaming}
            renderToolStatus={renderToolStatus}
            renderInput={() => null}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          />

          {/* Busy indicator (only when no streaming and no waiting slots) */}
          {busy && !streamingText && slots.length === 0 && (
            <div className="thinking">Thinking...</div>
          )}
        </div>
      )}

      {/* Input */}
      {renderInput({ send: handleSend, busy, abort })}
    </div>
  );
}
