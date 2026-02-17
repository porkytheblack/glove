import type { ToolMeta } from "./_meta";

// ─── Meta ────────────────────────────────────────────────────────────────────

export const meta: ToolMeta = {
  slug: "show-info-card",
  name: "show_info_card",
  category: "display",
  pattern: "pushAndForget",
  description: "Display a persistent information card with title and content.",
};

// ─── Preview data ────────────────────────────────────────────────────────────

export const preview = {
  data: {
    title: "Destination Highlight",
    content:
      "Tokyo is best visited in spring (March-April) for cherry blossoms, or autumn (October-November) for fall colors.",
    variant: "info",
  },
};

// ─── Variant → border color mapping ──────────────────────────────────────────

const variantBorderColor: Record<string, string> = {
  info: "var(--accent, #9ED4B8)",
  success: "var(--success, #22c55e)",
  warning: "var(--warning, #f59e0b)",
};

// ─── Source (copy-pasteable ToolConfig) ───────────────────────────────────────

export const source = `import { z } from "zod";
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
};`;

// ─── Render ──────────────────────────────────────────────────────────────────

export function render({
  data,
}: {
  data: Record<string, unknown>;
  resolve: (value: unknown) => void;
}) {
  const title = data.title as string;
  const content = data.content as string;
  const variant = (data.variant as string | undefined) ?? "info";

  const borderColor =
    variantBorderColor[variant] ?? variantBorderColor.info;

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        border: "1px solid var(--border, #262626)",
        borderLeftWidth: 3,
        borderLeftColor: borderColor,
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
}
