import React from "react";
import { CoffeeIcon } from "./icons";

// ─── Empty state / welcome message ──────────────────────────────────────────

interface EmptyStateProps {
  onSuggestion: (text: string) => void;
}

export function EmptyState({ onSuggestion }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <CoffeeIcon color="#3d5a3d" size={24} />
      </div>
      <h2>Welcome to Glove Coffee</h2>
      <p>
        AI-powered specialty coffee, sourced directly from origin.
        <br />
        Tell us what you&apos;re in the mood for.
      </p>
      <div className="suggestions">
        <button
          className="suggestion-chip"
          onClick={() => onSuggestion("Help me choose something")}
        >
          Help me choose
        </button>
        <button
          className="suggestion-chip"
          onClick={() => onSuggestion("Show me all your beans")}
        >
          Browse all beans
        </button>
        <button
          className="suggestion-chip"
          onClick={() => onSuggestion("I want something light and fruity")}
        >
          Something light & fruity
        </button>
        <button
          className="suggestion-chip"
          onClick={() => onSuggestion("I want something bold and rich")}
        >
          Something bold & rich
        </button>
      </div>
    </div>
  );
}
