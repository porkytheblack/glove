import type { ToolMeta } from "./_meta";

// ─── Meta ────────────────────────────────────────────────────────────────────

export const meta: ToolMeta = {
  slug: "confirm-action",
  name: "confirm_action",
  category: "confirmation",
  pattern: "pushAndWait",
  description:
    "Present a yes/no confirmation before proceeding with an action.",
};

// ─── Preview data ────────────────────────────────────────────────────────────

export const preview = {
  data: {
    title: "Confirm purchase",
    message:
      "You're about to buy 3 items totaling $247.00. Continue?",
  },
};

// ─── Source (copy-pasteable ToolConfig) ───────────────────────────────────────

export const source = `import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "@glove/react";

export const confirmAction: ToolConfig = {
  name: "confirm_action",
  description:
    "Present a yes/no confirmation before proceeding with an action. " +
    "Blocks until the user confirms or cancels.",
  inputSchema: z.object({
    title: z.string().describe("What you are asking confirmation for"),
    message: z
      .string()
      .describe("Details about the action to be confirmed"),
  }),
  async do(input, display) {
    const confirmed = await display.pushAndWait({ input });
    return confirmed ? "User confirmed." : "User cancelled.";
  },
  render({ data, resolve }: SlotRenderProps) {
    const { title, message } = data as {
      title: string;
      message: string;
    };
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          border: "1px dashed var(--warning, #f59e0b)",
          background: "var(--surface, #141414)",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <p
          style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 8,
            color: "var(--text, #ededed)",
          }}
        >
          {title}
        </p>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-muted, #888)",
            lineHeight: 1.5,
            marginBottom: 12,
          }}
        >
          {message}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => resolve(true)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 6,
              background: "var(--success, #22c55e)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Confirm
          </button>
          <button
            onClick={() => resolve(false)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 6,
              background: "var(--border, #262626)",
              color: "var(--text-muted, #888)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  },
};`;

// ─── Render ──────────────────────────────────────────────────────────────────

export function render({
  data,
  resolve,
}: {
  data: Record<string, unknown>;
  resolve: (value: unknown) => void;
}) {
  const title = data.title as string;
  const message = data.message as string;

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        border: "1px dashed var(--warning, #f59e0b)",
        background: "var(--surface, #141414)",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <p
        style={{
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 8,
          color: "var(--text, #ededed)",
        }}
      >
        {title}
      </p>
      <p
        style={{
          fontSize: 13,
          color: "var(--text-muted, #888)",
          lineHeight: 1.5,
          marginBottom: 12,
        }}
      >
        {message}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => resolve(true)}
          style={{
            padding: "8px 16px",
            border: "none",
            borderRadius: 6,
            background: "var(--success, #22c55e)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "0.85";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "1";
          }}
        >
          Confirm
        </button>
        <button
          onClick={() => resolve(false)}
          style={{
            padding: "8px 16px",
            border: "none",
            borderRadius: 6,
            background: "var(--border, #262626)",
            color: "var(--text-muted, #888)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "0.85";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "1";
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
