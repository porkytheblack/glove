"use client";

import { useState, useRef, useEffect } from "react";
import { useGlove } from "@glove/react";

// ─── Chat component ──────────────────────────────────────────────────────────

export default function Chat() {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    timeline,
    streamingText,
    busy,
    stats,
    slots,
    sendMessage,
    abort,
    renderSlot,
  } = useGlove();

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timeline, streamingText, slots]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    sendMessage(text);
  };

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
      <div className="chat-messages">
        {timeline.length === 0 && !busy && (
          <div className="empty-state">
            <p>Where are we headed?</p>
            <p className="hint">
              Try: &quot;Plan a weekend trip to Tokyo&quot; or
              &quot;Help me plan a 5-day Italy road trip for two&quot;
            </p>
          </div>
        )}

        {timeline.map((entry, i) => {
          switch (entry.kind) {
            case "user":
              return (
                <div key={i} className="message user-message">
                  <div className="message-content">{entry.text}</div>
                </div>
              );

            case "agent_text":
              return (
                <div key={i} className="message agent-message">
                  <div className="message-content">{entry.text}</div>
                </div>
              );

            case "tool":
              return (
                <div key={i} className="tool-entry">
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
        })}

        {/* Active display slots — rendered by colocated tool renderers */}
        {slots.map(renderSlot)}

        {/* Streaming text */}
        {streamingText && (
          <div className="message agent-message streaming">
            <div className="message-content">{streamingText}</div>
          </div>
        )}

        {/* Busy indicator (only when no streaming and no waiting slots) */}
        {busy && !streamingText && slots.length === 0 && (
          <div className="thinking">Thinking...</div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={busy}
          autoFocus
        />
        {busy ? (
          <button type="button" onClick={abort} className="abort-btn">
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}
