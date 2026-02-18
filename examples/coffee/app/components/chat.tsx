"use client";

import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useGlove, Render } from "glove-react";
import type {
  MessageRenderProps,
  StreamingRenderProps,
  ToolStatusRenderProps,
} from "glove-react";
import { createCoffeeTools, type CartOps } from "../lib/tools";
import { getProductById, type CartItem } from "../lib/products";
import { ChatHeader } from "./chat-header";
import { ChatInput } from "./chat-input";
import { EmptyState } from "./empty-state";
import { CoffeeIcon } from "./icons";

// ─── Custom renderers ───────────────────────────────────────────────────────

function renderMessage({ entry }: MessageRenderProps): ReactNode {
  if (entry.kind === "user") {
    return (
      <div className="message-user">
        <div className="message-user-bubble">{entry.text}</div>
      </div>
    );
  }
  return (
    <div className="message-agent">
      <div className="agent-avatar">
        <CoffeeIcon color="#3d5a3d" size={14} />
      </div>
      <div className="agent-text">{entry.text}</div>
    </div>
  );
}

function renderStreaming({ text }: StreamingRenderProps): ReactNode {
  return (
    <div className="message-agent">
      <div className="agent-avatar">
        <CoffeeIcon color="#3d5a3d" size={14} />
      </div>
      <div className="agent-text streaming">{text}</div>
    </div>
  );
}

function renderToolStatus({ entry }: ToolStatusRenderProps): ReactNode {
  return (
    <div className="tool-entry">
      <div className={`tool-badge ${entry.status}`}>
        {entry.status === "running"
          ? "..."
          : entry.status === "success"
            ? "ok"
            : "err"}
      </div>
      <span className="tool-name">{entry.name}</span>
      {entry.output && (
        <span className="tool-output">
          {entry.output.length > 60
            ? entry.output.slice(0, 60) + "..."
            : entry.output}
        </span>
      )}
    </div>
  );
}

// ─── Chat orchestrator ──────────────────────────────────────────────────────

export default function Chat() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Cart state ────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([]);
  const cartRef = useRef<CartItem[]>(cart);
  cartRef.current = cart;

  const cartOps: CartOps = useMemo(
    () => ({
      add: (productId: string, quantity = 1) => {
        setCart((prev) => {
          const product = getProductById(productId);
          if (!product) return prev;
          const existing = prev.find((i) => i.id === productId);
          if (existing) {
            return prev.map((i) =>
              i.id === productId ? { ...i, qty: i.qty + quantity } : i,
            );
          }
          return [...prev, { ...product, qty: quantity }];
        });
      },
      get: () => cartRef.current,
      clear: () => setCart([]),
    }),
    [],
  );

  // ── Tools (stable, created once) ──────────────────────────────────────
  const tools = useMemo(() => createCoffeeTools(cartOps), [cartOps]);

  // ── Glove hook ────────────────────────────────────────────────────────
  const glove = useGlove({ tools });
  const { timeline, streamingText, busy, stats, slots, sendMessage, abort } =
    glove;

  // ── Auto-scroll ─────────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [timeline, streamingText, slots]);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (e: { preventDefault: () => void }) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || busy) return;
      setInput("");
      sendMessage(text);
    },
    [input, busy, sendMessage],
  );

  const handleSuggestion = useCallback(
    (text: string) => {
      if (busy) return;
      sendMessage(text);
    },
    [busy, sendMessage],
  );

  return (
    <div className="chat-container">
      <ChatHeader cart={cart} stats={stats} />

      {timeline.length === 0 && !busy ? (
        <div className="chat-messages">
          <div className="chat-messages-inner">
            <EmptyState onSuggestion={handleSuggestion} />
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
            className="chat-messages-inner"
          />

          {/* Typing indicator */}
          {busy && !streamingText && slots.length === 0 && (
            <div className="typing-indicator">
              <div className="agent-avatar">
                <CoffeeIcon color="#3d5a3d" size={14} />
              </div>
              <div className="typing-dots">
                <div className="typing-dot" />
                <div className="typing-dot" />
                <div className="typing-dot" />
              </div>
            </div>
          )}
        </div>
      )}

      <ChatInput
        input={input}
        setInput={setInput}
        busy={busy}
        onSubmit={handleSubmit}
        onAbort={abort}
      />
    </div>
  );
}
