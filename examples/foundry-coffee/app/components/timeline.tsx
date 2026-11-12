import React from "react";
import type { Bag } from "../../lib/bag";
import type { BagView } from "../lib/bag-view";
import type { Entry } from "../lib/use-shop";
import { ApprovalCard, ToolCard } from "./cards";
import { CoffeeIcon } from "./icons";

/** A spoken message with speaker labels: one line per speaker, the label set apart. */
function UserText({ text }: { text: string }) {
  const lines = text.split("\n").map((line) => /^\[([^\]]+)\]\s*(.*)$/.exec(line) ?? [line, null, line]);
  if (!lines.some((line) => line[1])) return <>{text}</>;
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} className="speaker-line">
          {line[1] && <span className="speaker-chip">{line[1]}</span>}
          {line[2]}
        </span>
      ))}
    </>
  );
}

export function Timeline({ entries, streaming, busy, bag, onSay, onDecide }: {
  entries: Entry[];
  streaming: string;
  busy: boolean;
  bag: BagView;
  onSay: (text: string) => void;
  onDecide: (approvalId: string, decision: "approve" | "deny", seen: Bag) => void;
}) {
  const waiting = entries.some((entry) => entry.kind === "approval" && entry.status === "pending");
  return (
    <div className="chat-messages-inner">
      {entries.map((entry) => {
        switch (entry.kind) {
          case "user":
            return (
              <div key={entry.id} className="message-user">
                <div className="message-user-bubble">
                  {entry.spoken && <span className="spoken-tag">spoken</span>}
                  <UserText text={entry.text} />
                </div>
              </div>
            );
          case "agent":
            return (
              <div key={entry.id} className="message-agent">
                <div className="agent-avatar"><CoffeeIcon color="#3d5a3d" size={14} /></div>
                <div className="agent-text">{entry.text}</div>
              </div>
            );
          case "tool":
            return <ToolCard key={entry.id} entry={entry} onSay={onSay} disabled={busy} />;
          case "approval":
            return <ApprovalCard key={entry.id} entry={entry} bag={bag} onDecide={(decision, seen) => onDecide(entry.id, decision, seen)} />;
          case "note":
            return <div key={entry.id} className="timeline-note">{entry.text}</div>;
        }
      })}

      {streaming && (
        <div className="message-agent">
          <div className="agent-avatar"><CoffeeIcon color="#3d5a3d" size={14} /></div>
          <div className="agent-text streaming">{streaming}</div>
        </div>
      )}

      {busy && !streaming && !waiting && (
        <div className="typing-indicator">
          <div className="agent-avatar"><CoffeeIcon color="#3d5a3d" size={14} /></div>
          <div className="typing-dots">
            <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
          </div>
        </div>
      )}
    </div>
  );
}
