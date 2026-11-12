"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_BAG, totals, type Bag, type Order } from "../../lib/bag";
import type { RunTurn } from "./foundry-runnable";
import { streamTurn } from "./turn-stream";
import type { TurnEvent } from "./turn-events";

// The page's view of one customer conversation in Foundry: what was said,
// what the barista did, the bag and the orders.

export type Entry =
  | { kind: "user"; id: string; text: string; spoken: boolean }
  | { kind: "agent"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: "running" | "done" | "error"; message?: string }
  | { kind: "approval"; id: string; toolName: string; input: unknown; status: string }
  | { kind: "note"; id: string; text: string };

export interface ShopStatus {
  shop: string;
  foundry: { ok: boolean; url: string };
  model: { provider: string; model: string; demo: boolean };
  elevenlabs: boolean;
}

export interface Shop {
  status: ShopStatus | null;
  conversationId: string | null;
  timeline: Entry[];
  /** The reply as it streams in. */
  streaming: string;
  busy: boolean;
  bag: Bag;
  orders: Order[];
  error: string | null;
  /** Send a typed message. */
  send: (text: string) => void;
  /** Stop the current run. */
  stop: () => void;
  /** Answer a checkout. */
  decide: (approvalId: string, decision: "approve" | "deny") => Promise<void>;
  newConversation: () => Promise<void>;
  /** Add a line to the timeline that is not part of the conversation. */
  note: (text: string) => void;
  /** Run one turn; the voice pipeline uses this too. */
  runTurn: RunTurn;
  /** Called with every run event, typed or spoken. */
  onRunEvent: React.MutableRefObject<((event: TurnEvent) => void) | null>;
}

let counter = 0;
const id = (prefix: string) => `${prefix}-${Date.now()}-${counter++}`;

export function useShop(): Shop {
  const [status, setStatus] = useState<ShopStatus | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Entry[]>([]);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [bag, setBag] = useState<Bag>(EMPTY_BAG);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);

  const conversationRef = useRef<string | null>(null);
  const conversationSeq = useRef(0);
  const refreshSeq = useRef(0);
  const bagRef = useRef<Bag>(EMPTY_BAG);
  const turnSeq = useRef(0);
  const typedAbort = useRef<AbortController | null>(null);
  const onRunEvent = useRef<((event: TurnEvent) => void) | null>(null);

  const refreshShop = useCallback(async () => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    // Tool results arrive close together, and their refreshes can answer out
    // of order. Only the newest one is applied.
    const seq = ++refreshSeq.current;
    try {
      const response = await fetch(`/api/shop?conversationId=${encodeURIComponent(conversation)}`);
      if (!response.ok) return;
      const data = (await response.json()) as { bag: Bag; orders: Order[] };
      if (conversationRef.current !== conversation || seq !== refreshSeq.current) return;
      bagRef.current = data.bag;
      setBag(data.bag);
      setOrders(data.orders);
    } catch {
      // The next tool result refreshes again.
    }
  }, []);

  const newConversation = useCallback(async () => {
    typedAbort.current?.abort();
    turnSeq.current += 1;
    setTimeline([]);
    setStreaming("");
    setBusy(false);
    bagRef.current = EMPTY_BAG;
    setBag(EMPTY_BAG);
    setOrders([]);
    setError(null);
    conversationRef.current = null;
    setConversationId(null);
    // Pressed twice, the second press wins whichever request answers first.
    const seq = ++conversationSeq.current;
    try {
      const response = await fetch("/api/conversations", { method: "POST" });
      const data = (await response.json()) as { conversationId?: string; error?: string };
      if (seq !== conversationSeq.current) return;
      if (!response.ok || !data.conversationId) throw new Error(data.error ?? "Could not start a conversation.");
      conversationRef.current = data.conversationId;
      setConversationId(data.conversationId);
    } catch (failure) {
      if (seq === conversationSeq.current) setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);

  useEffect(() => {
    void fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
    void newConversation();
  }, [newConversation]);

  const note = useCallback((text: string) => {
    setTimeline((prev) => [...prev, { kind: "note", id: id("note"), text }]);
  }, []);

  const runTurn: RunTurn = useCallback(
    async (text, { voice, signal, onEvent } = {}) => {
      const conversation = conversationRef.current;
      if (!conversation) throw new Error("The conversation is not ready yet.");
      const seq = ++turnSeq.current;
      const current = () => seq === turnSeq.current;
      let reply = "";

      setError(null);
      setBusy(true);
      setStreaming("");
      setTimeline((prev) => [...prev, { kind: "user", id: id("user"), text, spoken: voice !== undefined }]);

      const flushReply = () => {
        const said = reply.trim();
        reply = "";
        if (!current()) return;
        setStreaming("");
        if (said) setTimeline((prev) => [...prev, { kind: "agent", id: id("agent"), text: said }]);
      };

      try {
        await streamTurn(
          { conversationId: conversation, text, ...(voice ? { voice } : {}) },
          async (event) => {
            if (current()) {
              onRunEvent.current?.(event);
              switch (event.type) {
                case "text":
                  reply += event.text;
                  setStreaming(reply);
                  break;
                case "response_end":
                  flushReply();
                  break;
                case "tool":
                  flushReply();
                  setTimeline((prev) => [...prev, { kind: "tool", id: event.id || id("tool"), name: event.name, input: event.input, status: "running" }]);
                  break;
                case "tool_result":
                  setTimeline((prev) =>
                    prev.map((entry) =>
                      entry.kind === "tool" && entry.id === event.id
                        ? { ...entry, status: event.ok ? "done" : "error", ...(event.message ? { message: event.message } : {}) }
                        : entry,
                    ),
                  );
                  void refreshShop();
                  break;
                case "approval":
                  // The card shows the bag, so have the bag checkout will order
                  // before showing it.
                  await refreshShop();
                  if (!current()) break;
                  setTimeline((prev) => [...prev, { kind: "approval", id: event.id, toolName: event.toolName, input: event.input, status: "pending" }]);
                  break;
                case "approval_resolved":
                  setTimeline((prev) =>
                    prev.map((entry) => (entry.kind === "approval" && entry.id === event.id ? { ...entry, status: event.status } : entry)),
                  );
                  break;
                default:
                  break;
              }
            }
            await onEvent?.(event);
          },
          signal,
        );
      } catch (failure) {
        const aborted = signal?.aborted || (failure instanceof DOMException && failure.name === "AbortError");
        if (current() && !aborted) setError(failure instanceof Error ? failure.message : String(failure));
        throw failure;
      } finally {
        flushReply();
        if (current()) {
          setBusy(false);
          // An approval the run no longer waits for cannot be answered.
          setTimeline((prev) => prev.map((entry) => (entry.kind === "approval" && entry.status === "pending" ? { ...entry, status: "cancelled" } : entry)));
        }
        void refreshShop();
      }
    },
    [refreshShop],
  );

  const send = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message) return;
      typedAbort.current?.abort();
      const controller = new AbortController();
      typedAbort.current = controller;
      void runTurn(message, { signal: controller.signal }).catch(() => undefined);
    },
    [runTurn],
  );

  const stop = useCallback(() => {
    typedAbort.current?.abort();
  }, []);

  const decide = useCallback(async (approvalId: string, decision: "approve" | "deny") => {
    // A confirmation says what the customer was shown; the server refuses it
    // if the bag is no longer that.
    const { count, total } = totals(bagRef.current);
    const response = await fetch(`/api/approvals/${encodeURIComponent(approvalId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, seen: { count, total } }),
    }).catch(() => null);
    if (!response?.ok) {
      const failure = ((await response?.json().catch(() => ({}))) ?? {}) as { error?: string };
      setError(failure.error ?? "The answer could not be recorded.");
      if (response?.status === 409) await refreshShop();
    }
  }, [refreshShop]);

  return useMemo(
    () => ({ status, conversationId, timeline, streaming, busy, bag, orders, error, send, stop, decide, newConversation, note, runTurn, onRunEvent }),
    [status, conversationId, timeline, streaming, busy, bag, orders, error, send, stop, decide, newConversation, note, runTurn],
  );
}
