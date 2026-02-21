import React, { useMemo, type ReactNode } from "react";
import type { TimelineEntry, EnhancedSlot } from "glove-react";

// ---- Visual area -----------------------------------------------------------
//
// Renders the latest display content in the center of the screen:
//   1. Active slots (tool UIs currently awaiting resolution or fire-and-forget)
//   2. If no active slots, the most recent completed tool result with renderData
//   3. If nothing to show and not busy, the empty state with cinematic onboarding

interface VisualAreaProps {
  slots: EnhancedSlot[];
  timeline: TimelineEntry[];
  renderSlot: (slot: EnhancedSlot) => ReactNode;
  renderToolResult: (entry: TimelineEntry & { kind: "tool" }) => ReactNode;
  busy: boolean;
  onSuggestion?: (text: string) => void;
}

// Sample prompts that hint at Lola's capabilities without being prescriptive.
// These give first-time users a concrete starting point and showcase the range
// of things Lola can help with.
const SUGGESTIONS = [
  "Best sci-fi from the 90s",
  "Something like Eternal Sunshine",
  "Who directed Parasite?",
  "Cozy rainy day movies",
];

export function VisualArea({
  slots,
  timeline,
  renderSlot,
  renderToolResult,
  busy,
  onSuggestion,
}: VisualAreaProps) {
  // Find the most recent tool result with renderData for fallback display
  const lastToolResult = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const entry = timeline[i];
      if (
        entry.kind === "tool" &&
        entry.status === "success" &&
        entry.renderData !== undefined
      ) {
        return entry;
      }
    }
    return null;
  }, [timeline]);

  // Case 1: Active slots -- render each via renderSlot
  if (slots.length > 0) {
    return (
      <div className="visual-area">
        {slots.map((slot) => {
          const rendered = renderSlot(slot);
          if (!rendered) return null;
          return (
            <div key={slot.id} className="display-card">
              {rendered}
            </div>
          );
        })}
      </div>
    );
  }

  // Case 2: No active slots, but there is a recent tool result with renderData
  if (lastToolResult) {
    const rendered = renderToolResult(lastToolResult);
    if (rendered) {
      return (
        <div className="visual-area">
          <div className="display-card">{rendered}</div>
        </div>
      );
    }
  }

  // Case 3: Nothing to show and not busy -- cinematic empty state
  if (!busy) {
    return (
      <div className="visual-area">
        <div className="lola-empty">
          <h1 className="lola-empty__title">Lola</h1>
          <div className="lola-empty__accent" aria-hidden="true" />
          <p className="lola-empty__subtitle">
            Your voice-first movie companion.
            <br />
            Ask me anything about film.
          </p>
          <p className="lola-empty__hint">Tap the orb to begin</p>
          {onSuggestion && (
            <div className="lola-empty__suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="lola-empty__chip"
                  onClick={() => onSuggestion(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Busy with no visual content -- render empty visual area with loading hint
  return (
    <div className="visual-area">
      <div className="loading-state">
        <div className="loading-state__bar" />
      </div>
    </div>
  );
}
