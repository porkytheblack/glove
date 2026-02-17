import React from "react";
import type { SlotRenderProps, ToolConfig } from "glove-react";
import { z } from "zod";
import { SAGE, CREAM } from "../theme";

// ─── show_info — general info card (pushAndForget) ──────────────────────────

export function createShowInfoTool(): ToolConfig {
  return {
    name: "show_info",
    description:
      "Display a persistent information card in the chat. Use for sourcing details, brewing tips, order confirmations, or general info. Cards stay visible.",
    inputSchema: z.object({
      title: z.string().describe("Card title"),
      content: z
        .string()
        .describe("Card body text (use \\n for line breaks)"),
      variant: z
        .enum(["info", "success"])
        .optional()
        .describe("info = general, success = confirmation/order placed"),
    }),
    async do(input, display) {
      const { variant, ...rest } = input as {
        title: string;
        content: string;
        variant?: string;
      };
      await display.pushAndForget({
        input: { ...rest, variant: variant ?? "info" },
      });
      return `Displayed info card: ${(input as { title: string }).title}`;
    },
    render({ data }: SlotRenderProps) {
      const { title, content, variant } = data as {
        title: string;
        content: string;
        variant: string;
      };
      const accentColor = variant === "success" ? "#4ade80" : SAGE[400];

      return (
        <div
          style={{
            background: CREAM[50],
            border: `1px solid ${SAGE[100]}`,
            borderLeft: `3px solid ${accentColor}`,
            padding: 16,
            marginTop: 12,
            maxWidth: 400,
          }}
        >
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color: SAGE[900],
              margin: "0 0 8px",
            }}
          >
            {title}
          </p>
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              lineHeight: 1.6,
              color: SAGE[600],
              margin: 0,
              whiteSpace: "pre-wrap",
            }}
          >
            {content}
          </p>
        </div>
      );
    },
  };
}
