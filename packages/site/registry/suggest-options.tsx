import type { ToolMeta } from "./_meta";

// ─── Meta ────────────────────────────────────────────────────────────────────

export const meta: ToolMeta = {
  slug: "suggest-options",
  name: "suggest_options",
  category: "navigation",
  pattern: "pushAndWait",
  description: "Present suggested next actions the user can pick from.",
};

// ─── Preview data ────────────────────────────────────────────────────────────

export const preview = {
  data: {
    prompt: "What would you like to do next?",
    options: [
      {
        label: "Plan activities",
        value: "activities",
        description: "Browse and schedule things to do",
      },
      {
        label: "Set budget",
        value: "budget",
        description: "Define spending limits per category",
      },
      {
        label: "Book flights",
        value: "flights",
        description: "Search and compare flight options",
      },
    ],
  },
};

// ─── Source (copy-pasteable ToolConfig) ───────────────────────────────────────

export const source = `import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const suggestOptions: ToolConfig = {
  name: "suggest_options",
  description:
    "Present suggested next actions the user can pick from. " +
    "Blocks until they select one.",
  inputSchema: z.object({
    prompt: z.string().describe("Prompt text shown above the options"),
    options: z
      .array(
        z.object({
          label: z.string().describe("Option title"),
          value: z.string().describe("Value returned when selected"),
          description: z
            .string()
            .optional()
            .describe("Short description shown below the label"),
        }),
      )
      .describe("2-6 suggested actions"),
  }),
  async do(input, display) {
    const selected = await display.pushAndWait({ input });
    return \`User chose: \${selected}\`;
  },
  render({ data, resolve }: SlotRenderProps) {
    const { prompt, options } = data as {
      prompt: string;
      options: { label: string; value: string; description?: string }[];
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
          {prompt}
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => resolve(opt.value)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "10px 14px",
                border: "1px solid var(--border, #262626)",
                borderRadius: 8,
                background: "var(--bg, #0a0a0a)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text, #ededed)",
                }}
              >
                {opt.label}
              </span>
              {opt.description && (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted, #888)",
                  }}
                >
                  {opt.description}
                </span>
              )}
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
  const prompt = data.prompt as string;
  const options = data.options as {
    label: string;
    value: string;
    description?: string;
  }[];

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
        {prompt}
      </p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => resolve(opt.value)}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "10px 14px",
              border: "1px solid var(--border, #262626)",
              borderRadius: 8,
              background: "var(--bg, #0a0a0a)",
              cursor: "pointer",
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent, #9ED4B8)";
              e.currentTarget.style.background = "rgba(158,212,184,0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border, #262626)";
              e.currentTarget.style.background = "var(--bg, #0a0a0a)";
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--text, #ededed)",
              }}
            >
              {opt.label}
            </span>
            {opt.description && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-muted, #888)",
                }}
              >
                {opt.description}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
