"use client";

/**
 * The right half: what the agent wrote, as it wrote it.
 *
 * One card per file, updated in place — a card is the file, not a log line,
 * so an edit revises the card rather than appending a near-duplicate. Scripts
 * carry the output of their last run underneath.
 */
import { useEffect, useRef } from "react";
import type { CodeCard } from "@/lib/useDesk";
import { highlight } from "@/lib/highlight";

export function CodePane({ cards, busy }: { cards: CodeCard[]; busy: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activePath = cards.find((c) => c.status === "running")?.path ?? cards[cards.length - 1]?.path;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cards.length, activePath]);

  return (
    <section className="code-pane">
      <div className="code-head">
        <span className="code-title">
          {cards.length === 0 ? (
            "the agent's work"
          ) : (
            <>
              <b>{cards.length}</b> file{cards.length === 1 ? "" : "s"} written
            </>
          )}
        </span>
      </div>

      {cards.length === 0 ? (
        <div className="code-empty">
          <span>
            {busy
              ? "Waiting for the agent's first file…"
              : "Every file the agent writes shows up here — scripts with what they printed, reports as they are drafted."}
          </span>
        </div>
      ) : (
        <div className="code-scroll" ref={scrollRef}>
          {cards.map((card) => (
            <article key={card.path} className="code-block">
              <header className="code-block-head">
                <span className="path">{card.path}</span>
                {card.runs > 0 && <span>· ran {card.runs}×</span>}
                {card.status === "running" && <span>· running…</span>}
                {card.status === "error" && <span>· failed</span>}
              </header>
              <pre>
                <code>
                  {!card.content
                    ? "// written in an earlier session"
                    : card.code
                      ? highlight(card.content)
                      : card.content}
                </code>
              </pre>
              {card.output && (
                <div className={`code-out ${card.status === "error" ? "err" : ""}`}>{card.output}</div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
