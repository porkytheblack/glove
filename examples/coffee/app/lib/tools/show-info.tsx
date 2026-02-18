import React from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { SAGE, CREAM } from "../theme";

// ─── show_info — general info card (pushAndForget) ──────────────────────────

const inputSchema = z.object({
  title: z.string().describe("Card title"),
  content: z
    .string()
    .describe("Card body text (use \\n for line breaks)"),
  variant: z
    .enum(["info", "success"])
    .optional()
    .describe("info = general, success = confirmation/order placed"),
});

const displaySchema = z.object({
  title: z.string(),
  content: z.string(),
  variant: z.string(),
});

function InfoCard({
  title,
  content,
  variant,
}: {
  title: string;
  content: string;
  variant: string;
}) {
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
}

export function createShowInfoTool() {
  return defineTool({
    name: "show_info",
    description:
      "Display a persistent information card in the chat. Use for sourcing details, brewing tips, order confirmations, or general info. Cards stay visible.",
    inputSchema,
    displayPropsSchema: displaySchema,
    async do(input, display) {
      const variant = input.variant ?? "info";
      await display.pushAndForget({
        title: input.title,
        content: input.content,
        variant,
      });
      return {
        status: "success" as const,
        data: `Displayed info card: ${input.title}`,
        renderData: { title: input.title, content: input.content, variant },
      };
    },
    render({ props }) {
      return (
        <InfoCard
          title={props.title}
          content={props.content}
          variant={props.variant}
        />
      );
    },
    renderResult({ data }) {
      const { title, content, variant } = data as {
        title: string;
        content: string;
        variant: string;
      };
      return <InfoCard title={title} content={content} variant={variant} />;
    },
  });
}
