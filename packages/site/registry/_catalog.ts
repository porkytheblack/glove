// Server-safe tool catalog — no React dependencies
// Used by server components for metadata, source code, and preview data

export type ToolCategory = "input" | "confirmation" | "display" | "navigation";
export type ToolPattern = "pushAndWait" | "pushAndForget";

export interface CatalogEntry {
  slug: string;
  name: string;
  category: ToolCategory;
  pattern: ToolPattern;
  description: string;
  source: string;
  previewData: Record<string, unknown>;
}

const catalog: CatalogEntry[] = [
  // ── ask-preference ──────────────────────────────────────────────────────────
  {
    slug: "ask-preference",
    name: "ask_preference",
    category: "input",
    pattern: "pushAndWait",
    description: "Present a set of options and collect the user's selection.",
    source: `import { z } from "zod";
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
};`,
    previewData: {
      question: "Where should we go?",
      options: [
        { label: "Tokyo", value: "tokyo" },
        { label: "Paris", value: "paris" },
        { label: "New York", value: "new_york" },
      ],
    },
  },

  // ── text-input ──────────────────────────────────────────────────────────────
  {
    slug: "text-input",
    name: "text_input",
    category: "input",
    pattern: "pushAndWait",
    description: "Prompt the user for free-text input with an optional label.",
    source: `import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "@glove/react";
import { useState } from "react";

export const textInput: ToolConfig = {
  name: "text_input",
  description:
    "Prompt the user for free-text input with an optional label. " +
    "Blocks until they submit.",
  inputSchema: z.object({
    label: z.string().describe("The label / question to display"),
    placeholder: z
      .string()
      .optional()
      .describe("Placeholder text for the input field"),
  }),
  async do(input, display) {
    const value = await display.pushAndWait({ input });
    return \`User entered: \${value}\`;
  },
  render({ data, resolve }: SlotRenderProps) {
    const { label, placeholder } = data as {
      label: string;
      placeholder?: string;
    };
    const [value, setValue] = useState("");
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
        <label
          style={{
            display: "block",
            fontSize: 14,
            fontWeight: 500,
            marginBottom: 10,
            color: "var(--text, #ededed)",
          }}
        >
          {label}
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder ?? ""}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) resolve(value.trim());
            }}
            style={{
              flex: 1,
              padding: "8px 12px",
              border: "1px solid var(--border, #262626)",
              borderRadius: 6,
              background: "var(--bg, #0a0a0a)",
              color: "var(--text, #ededed)",
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            onClick={() => {
              if (value.trim()) resolve(value.trim());
            }}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 6,
              background: "var(--accent, #9ED4B8)",
              color: "#0a0a0a",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Submit
          </button>
        </div>
      </div>
    );
  },
};`,
    previewData: {
      label: "What's your budget range?",
      placeholder: "e.g. $2000-3000",
    },
  },

  // ── collect-form ────────────────────────────────────────────────────────────
  {
    slug: "collect-form",
    name: "collect_form",
    category: "input",
    pattern: "pushAndWait",
    description:
      "Render a dynamic form with multiple fields and collect validated input.",
    source: `import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "@glove/react";
import { useState, useCallback } from "react";

export const collectForm: ToolConfig = {
  name: "collect_form",
  description:
    "Render a dynamic form with multiple fields and collect " +
    "validated input. Blocks until the user submits.",
  inputSchema: z.object({
    title: z.string().describe("Form title"),
    fields: z
      .array(
        z.object({
          name: z.string().describe("Field key"),
          label: z.string().describe("Display label"),
          type: z
            .enum(["text", "number", "email"])
            .describe("HTML input type"),
          required: z.boolean().optional().describe("Whether the field is required"),
        }),
      )
      .describe("List of form fields to render"),
  }),
  async do(input, display) {
    const result = await display.pushAndWait({ input });
    return JSON.stringify(result);
  },
  render({ data, resolve }: SlotRenderProps) {
    const { title, fields } = data as {
      title: string;
      fields: {
        name: string;
        label: string;
        type: "text" | "number" | "email";
        required?: boolean;
      }[];
    };
    const [values, setValues] = useState<Record<string, string>>({});
    const update = useCallback(
      (name: string, val: string) =>
        setValues((prev) => ({ ...prev, [name]: val })),
      [],
    );
    const canSubmit = fields
      .filter((f) => f.required)
      .every((f) => (values[f.name] ?? "").trim() !== "");

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
            fontWeight: 600,
            marginBottom: 14,
            color: "var(--text, #ededed)",
          }}
        >
          {title}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {fields.map((field) => (
            <div key={field.name}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "var(--text-muted, #888)",
                  marginBottom: 4,
                }}
              >
                {field.label}
                {field.required && (
                  <span style={{ color: "var(--error, #ef4444)", marginLeft: 2 }}>
                    *
                  </span>
                )}
              </label>
              <input
                type={field.type}
                value={values[field.name] ?? ""}
                onChange={(e) => update(field.name, e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--border, #262626)",
                  borderRadius: 6,
                  background: "var(--bg, #0a0a0a)",
                  color: "var(--text, #ededed)",
                  fontSize: 13,
                  outline: "none",
                }}
              />
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            if (canSubmit) resolve(values);
          }}
          disabled={!canSubmit}
          style={{
            marginTop: 14,
            padding: "8px 20px",
            border: "none",
            borderRadius: 6,
            background: "var(--accent, #9ED4B8)",
            color: "#0a0a0a",
            fontSize: 13,
            fontWeight: 500,
            cursor: canSubmit ? "pointer" : "not-allowed",
            opacity: canSubmit ? 1 : 0.5,
          }}
        >
          Submit
        </button>
      </div>
    );
  },
};`,
    previewData: {
      title: "Contact Details",
      fields: [
        { name: "name", label: "Full Name", type: "text", required: true },
        { name: "email", label: "Email", type: "email", required: true },
        { name: "phone", label: "Phone", type: "text" },
      ],
    },
  },

  // ── confirm-action ──────────────────────────────────────────────────────────
  {
    slug: "confirm-action",
    name: "confirm_action",
    category: "confirmation",
    pattern: "pushAndWait",
    description:
      "Present a yes/no confirmation before proceeding with an action.",
    source: `import { z } from "zod";
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
};`,
    previewData: {
      title: "Confirm purchase",
      message:
        "You're about to buy 3 items totaling $247.00. Continue?",
    },
  },

  // ── approve-plan ────────────────────────────────────────────────────────────
  {
    slug: "approve-plan",
    name: "approve_plan",
    category: "confirmation",
    pattern: "pushAndWait",
    description:
      "Show a multi-step plan and ask the user to approve before execution.",
    source: `import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "@glove/react";

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
};`,
    previewData: {
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
  },

  // ── show-info-card ──────────────────────────────────────────────────────────
  {
    slug: "show-info-card",
    name: "show_info_card",
    category: "display",
    pattern: "pushAndForget",
    description: "Display a persistent information card with title and content.",
    source: `import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "@glove/react";

const variantBorderColor: Record<string, string> = {
  info: "var(--accent, #9ED4B8)",
  success: "var(--success, #22c55e)",
  warning: "var(--warning, #f59e0b)",
};

export const showInfoCard: ToolConfig = {
  name: "show_info_card",
  description:
    "Display a persistent information card with title and content. " +
    "Does not block — the card stays visible in the conversation.",
  inputSchema: z.object({
    title: z.string().describe("Card title"),
    content: z
      .string()
      .describe("Card body text (supports line breaks with \\\\n)"),
    variant: z
      .enum(["info", "success", "warning"])
      .optional()
      .describe("Visual style: info (default), success, or warning"),
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
    return \`Displayed card: \${(input as { title: string }).title}\`;
  },
  render({ data }: SlotRenderProps) {
    const { title, content, variant = "info" } = data as {
      title: string;
      content: string;
      variant?: string;
    };
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          borderLeft: \`3px solid \${variantBorderColor[variant] ?? variantBorderColor.info}\`,
          border: "1px solid var(--border, #262626)",
          borderLeftWidth: 3,
          borderLeftColor:
            variantBorderColor[variant] ?? variantBorderColor.info,
          background: "var(--surface, #141414)",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <p
          style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 6,
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
            whiteSpace: "pre-wrap",
            margin: 0,
          }}
        >
          {content}
        </p>
      </div>
    );
  },
};`,
    previewData: {
      title: "Destination Highlight",
      content:
        "Tokyo is best visited in spring (March-April) for cherry blossoms, or autumn (October-November) for fall colors.",
      variant: "info",
    },
  },

  // ── suggest-options ─────────────────────────────────────────────────────────
  {
    slug: "suggest-options",
    name: "suggest_options",
    category: "navigation",
    pattern: "pushAndWait",
    description: "Present suggested next actions the user can pick from.",
    source: `import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "@glove/react";

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
};`,
    previewData: {
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
  },
];

export function getAllEntries(): CatalogEntry[] {
  return catalog;
}

export function getEntryBySlug(slug: string): CatalogEntry | undefined {
  return catalog.find((e) => e.slug === slug);
}
