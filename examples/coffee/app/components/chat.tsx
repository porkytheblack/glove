"use client";

import { useState, useRef, useMemo, useCallback } from "react";
import { useGlove } from "glove-react";
import { createCoffeeTools, type CartOps } from "../lib/tools";
import { getProductById, type CartItem } from "../lib/products";
import { ChatHeader } from "./chat-header";
import { ChatInput } from "./chat-input";
import { EmptyState } from "./empty-state";
import { MessageList } from "./message-list";

// ─── Chat orchestrator ──────────────────────────────────────────────────────

export default function Chat() {
  const [input, setInput] = useState("");

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
  const {
    timeline,
    streamingText,
    busy,
    stats,
    slots,
    sendMessage,
    abort,
    renderSlot,
  } = useGlove({ tools });

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
        <MessageList
          timeline={timeline}
          slots={slots}
          streamingText={streamingText}
          busy={busy}
          renderSlot={renderSlot}
        />
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
