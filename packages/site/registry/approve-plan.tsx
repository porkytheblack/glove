import type { ToolMeta } from "./_meta";

// ─── Meta ────────────────────────────────────────────────────────────────────

export const meta: ToolMeta = {
  slug: "approve-plan",
  name: "approve_plan",
  category: "confirmation",
  pattern: "pushAndWait",
  description:
    "Show a multi-step plan and ask the user to approve before execution.",
};

// ─── Preview data ────────────────────────────────────────────────────────────

export const preview = {
  data: {
    title: "Tokyo Weekend Itinerary",
    steps: [
      {
        title: "Day 1: Arrival",
        description: "Check in at Shinjuku hotel, explore Shibuya",
      },
      {
        title: "Day 2: Culture",
        description: "Meiji Shrine, Harajuku, Akihabara",
      },
      {
        title: "Day 3: Food Tour",
        description: "Tsukiji market, ramen tasting, departure",
      },
    ],
  },
};

// ─── Source (copy-pasteable ToolConfig) ───────────────────────────────────────

export const source = `import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const approvePlan: ToolConfig = {
  name: "approve_plan",
  description:
    "Show a multi-step plan and ask the user to approve before execution. " +
    "Blocks until the user approves or rejects.",
  inputSchema: z.object({
    title: z.string().describe("Plan title"),
    steps: z
      .array(
        z.object({
          title: z.string().describe("Step title"),
          description: z.string().describe("Step details"),
        }),
      )
      .describe("Ordered list of plan steps"),
  }),
  async do(input, display) {
    const approved = await display.pushAndWait({ input });
    return approved ? "Plan approved by user." : "Plan rejected by user.";
  },
  render({ data, resolve }: SlotRenderProps) {
    const { title, steps } = data as {
      title: string;
      steps: { title: string; description: string }[];
    };
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          border: "1px solid var(--accent, #9ED4B8)",
          background: "var(--surface, #141414)",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <p
          style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 12,
            color: "var(--text, #ededed)",
          }}
        >
          {title}
        </p>
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            counterReset: "step",
          }}
        >
          {steps.map((step, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "8px 10px",
                borderRadius: 6,
                background: "var(--bg, #0a0a0a)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--accent, #9ED4B8)",
                  }}
                >
                  {i + 1}
                </span>
                <strong style={{ fontSize: 13, color: "var(--text, #ededed)" }}>
                  {step.title}
                </strong>
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-muted, #888)",
                  paddingLeft: 18,
                }}
              >
                {step.description}
              </span>
            </li>
          ))}
        </ol>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
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
            Approve Plan
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
            Reject
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
  const steps = data.steps as { title: string; description: string }[];

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        border: "1px solid var(--accent, #9ED4B8)",
        background: "var(--surface, #141414)",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <p
        style={{
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 12,
          color: "var(--text, #ededed)",
        }}
      >
        {title}
      </p>
      <ol
        style={{
          listStyle: "none",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          counterReset: "step",
        }}
      >
        {steps.map((step, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "8px 10px",
              borderRadius: 6,
              background: "var(--bg, #0a0a0a)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--accent, #9ED4B8)",
                }}
              >
                {i + 1}
              </span>
              <strong style={{ fontSize: 13, color: "var(--text, #ededed)" }}>
                {step.title}
              </strong>
            </div>
            <span
              style={{
                fontSize: 12,
                color: "var(--text-muted, #888)",
                paddingLeft: 18,
              }}
            >
              {step.description}
            </span>
          </li>
        ))}
      </ol>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
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
          Approve Plan
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
          Reject
        </button>
      </div>
    </div>
  );
}
