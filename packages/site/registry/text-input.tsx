import { useState } from "react";
import type { ToolMeta } from "./_meta";

// ─── Meta ────────────────────────────────────────────────────────────────────

export const meta: ToolMeta = {
  slug: "text-input",
  name: "text_input",
  category: "input",
  pattern: "pushAndWait",
  description: "Prompt the user for free-text input with an optional label.",
};

// ─── Preview data ────────────────────────────────────────────────────────────

export const preview = {
  data: {
    label: "What's your budget range?",
    placeholder: "e.g. $2000-3000",
  },
};

// ─── Source (copy-pasteable ToolConfig) ───────────────────────────────────────

export const source = `import { z } from "zod";
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
};`;

// ─── Render ──────────────────────────────────────────────────────────────────

export function render({
  data,
  resolve,
}: {
  data: Record<string, unknown>;
  resolve: (value: unknown) => void;
}) {
  const label = data.label as string;
  const placeholder = (data.placeholder as string | undefined) ?? "";
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
          placeholder={placeholder}
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
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--accent, #9ED4B8)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border, #262626)";
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
            opacity: value.trim() ? 1 : 0.5,
            transition: "opacity 0.15s",
          }}
        >
          Submit
        </button>
      </div>
    </div>
  );
}
