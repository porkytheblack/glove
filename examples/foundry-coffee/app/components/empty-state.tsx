import React from "react";
import { CoffeeIcon } from "./icons";

const SUGGESTIONS: Array<[label: string, message: string]> = [
  ["Help me choose", "Help me choose something"],
  ["Browse all beans", "Show me all your beans"],
  ["Something light & fruity", "I want something light and fruity"],
  ["Something bold & rich", "I want something bold and rich"],
];

export function EmptyState({ shop, onSuggestion }: { shop: string; onSuggestion: (text: string) => void }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <CoffeeIcon color="#3d5a3d" size={24} />
      </div>
      <h2>Welcome to {shop}</h2>
      <p>
        Specialty coffee, sourced directly from origin.
        <br />
        Type, or tap the microphone and just talk. Bring a friend: the barista can tell you apart.
      </p>
      <div className="suggestions">
        {SUGGESTIONS.map(([label, message]) => (
          <button key={label} className="suggestion-chip" onClick={() => onSuggestion(message)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
