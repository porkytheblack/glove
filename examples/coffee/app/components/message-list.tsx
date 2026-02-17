import React, {
  useRef,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { Slot } from "glove-react";
import { CoffeeIcon } from "./icons";

// ─── Types ──────────────────────────────────────────────────────────────────

type TimelineEntry =
  | { kind: "user"; text: string }
  | { kind: "agent_text"; text: string }
  | { kind: "tool"; name: string; status: string; output?: string };

type MergedItem =
  | { type: "timeline"; index: number }
  | { type: "slot"; slot: Slot<unknown> };

// ─── Message list with slot interleaving ────────────────────────────────────

interface MessageListProps {
  timeline: TimelineEntry[];
  slots: Slot<unknown>[];
  streamingText: string;
  busy: boolean;
  renderSlot: (slot: Slot<unknown>) => ReactNode;
}

export function MessageList({
  timeline,
  slots,
  streamingText,
  busy,
  renderSlot,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Slot position tracking ──────────────────────────────────────────────
  // Record each slot's timeline position when it first appears,
  // so we can render it inline at that position.
  const slotPositionsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    for (const slot of slots) {
      if (!slotPositionsRef.current.has(slot.id)) {
        slotPositionsRef.current.set(slot.id, timeline.length);
      }
    }
  }, [slots, timeline.length]);

  // ── Build merged render list ────────────────────────────────────────────
  // Timeline entries stay in order. Slots are inserted right after the
  // timeline position they were created at.
  const mergedItems = useMemo((): MergedItem[] => {
    const slotsByPos = new Map<number, Slot<unknown>[]>();
    for (const slot of slots) {
      const pos = slotPositionsRef.current.get(slot.id) ?? timeline.length;
      const arr = slotsByPos.get(pos) ?? [];
      arr.push(slot);
      slotsByPos.set(pos, arr);
    }

    const result: MergedItem[] = [];
    for (let i = 0; i < timeline.length; i++) {
      result.push({ type: "timeline", index: i });
      const slotsHere = slotsByPos.get(i);
      if (slotsHere) {
        for (const slot of slotsHere) {
          result.push({ type: "slot", slot });
        }
      }
    }
    const slotsAtEnd = slotsByPos.get(timeline.length);
    if (slotsAtEnd) {
      for (const slot of slotsAtEnd) {
        result.push({ type: "slot", slot });
      }
    }

    return result;
  }, [timeline, slots]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mergedItems, streamingText]);

  // ── Render a single timeline entry ──────────────────────────────────────
  function renderTimelineEntry(index: number): ReactNode {
    const entry = timeline[index];
    switch (entry.kind) {
      case "user":
        return (
          <div key={`tl-${index}`} className="message-user">
            <div className="message-user-bubble">{entry.text}</div>
          </div>
        );

      case "agent_text":
        return (
          <div key={`tl-${index}`} className="message-agent">
            <div className="agent-avatar">
              <CoffeeIcon color="#3d5a3d" size={14} />
            </div>
            <div className="agent-text">{entry.text}</div>
          </div>
        );

      case "tool":
        return (
          <div key={`tl-${index}`} className="tool-entry">
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
  }

  return (
    <div className="chat-messages">
      <div className="chat-messages-inner">
        {/* Merged timeline + interleaved slots */}
        {mergedItems.map((item) => {
          if (item.type === "timeline") {
            return renderTimelineEntry(item.index);
          }
          return (
            <div key={`slot-${item.slot.id}`} className="slot-container">
              {renderSlot(item.slot)}
            </div>
          );
        })}

        {/* Streaming text */}
        {streamingText && (
          <div className="message-agent">
            <div className="agent-avatar">
              <CoffeeIcon color="#3d5a3d" size={14} />
            </div>
            <div className="agent-text streaming">{streamingText}</div>
          </div>
        )}

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

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
