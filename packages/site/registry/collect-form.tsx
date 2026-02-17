import { useState, useCallback } from "react";
import type { ToolMeta } from "./_meta";

// ─── Meta ────────────────────────────────────────────────────────────────────

export const meta: ToolMeta = {
  slug: "collect-form",
  name: "collect_form",
  category: "input",
  pattern: "pushAndWait",
  description:
    "Render a dynamic form with multiple fields and collect validated input.",
};

// ─── Preview data ────────────────────────────────────────────────────────────

export const preview = {
  data: {
    title: "Contact Details",
    fields: [
      { name: "name", label: "Full Name", type: "text", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "phone", label: "Phone", type: "text" },
    ],
  },
};

// ─── Source (copy-pasteable ToolConfig) ───────────────────────────────────────

export const source = `import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "glove-react";
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
  const fields = data.fields as {
    name: string;
    label: string;
    type: "text" | "number" | "email";
    required?: boolean;
  }[];

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
                <span
                  style={{ color: "var(--error, #ef4444)", marginLeft: 2 }}
                >
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
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--accent, #9ED4B8)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--border, #262626)";
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
          transition: "opacity 0.15s",
        }}
      >
        Submit
      </button>
    </div>
  );
}
