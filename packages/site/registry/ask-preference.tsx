import type { ToolMeta } from "./_meta";

// ─── Meta ────────────────────────────────────────────────────────────────────

export const meta: ToolMeta = {
  slug: "ask-preference",
  name: "ask_preference",
  category: "input",
  pattern: "pushAndWait",
  description: "Present a set of options and collect the user's selection.",
};

// ─── Preview data ────────────────────────────────────────────────────────────

export const preview = {
  data: {
    question: "Where should we go?",
    options: [
      { label: "Tokyo", value: "tokyo" },
      { label: "Paris", value: "paris" },
      { label: "New York", value: "new_york" },
    ],
  },
};

// ─── Source (copy-pasteable ToolConfig) ───────────────────────────────────────

export const source = `import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "@glove/react";

export const askPreference: ToolConfig = {
  name: "ask_preference",
  description:
    "Present the user with a set of options to choose from. " +
    "Blocks until they pick one.",
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
    return \`User selected: \${selected}\`;
  },
  render({ data, resolve }: SlotRenderProps) {
    const { question, options } = data as {
      question: string;
      options: { label: string; value: string }[];
    };
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          border: "1px dashed var(--accent, #9ED4B8)",
          background: "var(--surface, #141414)",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <p
          style={{
            fontSize: 14,
            fontWeight: 500,
            marginBottom: 12,
            color: "var(--text, #ededed)",
          }}
        >
          {question}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => resolve(opt.value)}
              style={{
                padding: "8px 16px",
                border: "1px solid var(--border, #262626)",
                borderRadius: 6,
                background: "var(--bg, #0a0a0a)",
                color: "var(--text, #ededed)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
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
  const question = data.question as string;
  const options = data.options as { label: string; value: string }[];

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        border: "1px dashed var(--accent, #9ED4B8)",
        background: "var(--surface, #141414)",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <p
        style={{
          fontSize: 14,
          fontWeight: 500,
          marginBottom: 12,
          color: "var(--text, #ededed)",
        }}
      >
        {question}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => resolve(opt.value)}
            style={{
              padding: "8px 16px",
              border: "1px solid var(--border, #262626)",
              borderRadius: 6,
              background: "var(--bg, #0a0a0a)",
              color: "var(--text, #ededed)",
              fontSize: 13,
              cursor: "pointer",
              transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent, #9ED4B8)";
              e.currentTarget.style.background = "rgba(158,212,184,0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border, #262626)";
              e.currentTarget.style.background = "var(--bg, #0a0a0a)";
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
