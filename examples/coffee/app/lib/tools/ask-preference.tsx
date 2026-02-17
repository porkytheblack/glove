import React from "react";
import type { SlotRenderProps, ToolConfig } from "glove-react";
import { z } from "zod";
import { SAGE, CREAM } from "../theme";

// ─── ask_preference — multi-choice selector (pushAndWait) ───────────────────

export function createAskPreferenceTool(): ToolConfig {
  return {
    name: "ask_preference",
    description:
      "Present the user with a set of options to choose from. Blocks until they pick one. Use for brew method, roast preference, mood, or any multiple-choice question.",
    inputSchema: z.object({
      question: z.string().describe("The question to display"),
      options: z
        .array(
          z.object({
            label: z.string().describe("Display text"),
            value: z.string().describe("Value returned when selected"),
          }),
        )
        .describe("2-6 options to present"),
    }),
    async do(input, display) {
      const selected = await display.pushAndWait({ input });
      return `User selected: ${selected}`;
    },
    render({ data, resolve }: SlotRenderProps) {
      const { question, options } = data as {
        question: string;
        options: { label: string; value: string }[];
      };
      return (
        <div
          style={{
            padding: 20,
            background: CREAM[50],
            border: `1px dashed ${SAGE[300]}`,
            marginTop: 12,
          }}
        >
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 14,
              fontWeight: 500,
              color: SAGE[800],
              margin: "0 0 14px",
            }}
          >
            {question}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => resolve(opt.value)}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  border: `1px solid ${SAGE[200]}`,
                  color: SAGE[700],
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLButtonElement).style.background = SAGE[900];
                  (e.target as HTMLButtonElement).style.color = CREAM[50];
                  (e.target as HTMLButtonElement).style.borderColor = SAGE[900];
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLButtonElement).style.background =
                    "transparent";
                  (e.target as HTMLButtonElement).style.color = SAGE[700];
                  (e.target as HTMLButtonElement).style.borderColor = SAGE[200];
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      );
    },
  };
}
