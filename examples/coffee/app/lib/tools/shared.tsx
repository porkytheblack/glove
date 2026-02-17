import React from "react";
import { SAGE } from "../theme";

// ─── IntensityBar (shared across product renderers) ─────────────────────────

export function IntensityBar({ level }: { level: number }) {
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 12,
            height: 4,
            background: i < level ? SAGE[700] : SAGE[100],
            transition: "background 0.3s ease",
          }}
        />
      ))}
    </div>
  );
}
