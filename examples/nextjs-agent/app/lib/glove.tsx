import React from "react";
import { GloveClient, defineTool } from "glove-react";
import type { ToolConfig, ToolResultData } from "glove-react";
import { z } from "zod";

// ─── Tools with display (defineTool) ────────────────────────────────────────

// ── ask_preference ──────────────────────────────────────────────────────────

const askPreferenceInputSchema = z.object({
  question: z.string().describe("The question to display"),
  options: z
    .array(
      z.object({
        label: z.string().describe("Display text"),
        value: z.string().describe("Value returned when selected"),
      }),
    )
    .describe("2-6 options to present"),
});

const askPreferenceTool = defineTool({
  name: "ask_preference",
  description:
    "Present the user with a set of options to choose from. Blocks until they pick one. Use for destination choices, budget ranges, accommodation types, activity preferences, cuisine, transport modes, etc.",
  inputSchema: askPreferenceInputSchema,
  displayPropsSchema: askPreferenceInputSchema,
  resolveSchema: z.string(),
  displayStrategy: "hide-on-complete",
  async do(input, display) {
    const selected = await display.pushAndWait(input);
    const selectedOption = input.options.find((o) => o.value === selected);
    return {
      status: "success" as const,
      data: `User selected: ${selected}`,
      renderData: {
        question: input.question,
        selected: selectedOption ?? { label: selected, value: selected },
      },
    };
  },
  render({ props, resolve }) {
    return (
      <div className="slot slot-select">
        <p className="slot-question">{props.question}</p>
        <div className="slot-options">
          {props.options.map((opt) => (
            <button
              key={opt.value}
              className="slot-option-btn"
              onClick={() => resolve(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  },
  renderResult({ data }) {
    const { question, selected } = data as {
      question: string;
      selected: { label: string; value: string };
    };
    return (
      <div className="slot slot-select" style={{ borderStyle: "solid" }}>
        <p className="slot-question">{question}</p>
        <div className="slot-options">
          <span className="slot-option-btn" style={{ borderColor: "var(--accent)", background: "rgba(59, 130, 246, 0.1)" }}>
            {selected.label}
          </span>
        </div>
      </div>
    );
  },
});

// ── confirm_booking ─────────────────────────────────────────────────────────

const confirmBookingInputSchema = z.object({
  title: z.string().describe("What you are asking confirmation for"),
  message: z
    .string()
    .describe("Details about what will be booked/finalized"),
});

const confirmBookingTool = defineTool({
  name: "confirm_booking",
  description:
    "Show a confirmation dialog before finalizing an important decision. Use before locking in flights, hotels, restaurants, or finalizing a full itinerary.",
  inputSchema: confirmBookingInputSchema,
  displayPropsSchema: confirmBookingInputSchema,
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete",
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    return {
      status: "success" as const,
      data: confirmed ? "User confirmed." : "User rejected.",
      renderData: {
        title: input.title,
        message: input.message,
        confirmed,
      },
    };
  },
  render({ props, resolve }) {
    return (
      <div className="slot slot-confirm">
        <p className="slot-title">{props.title}</p>
        <p className="slot-message">{props.message}</p>
        <div className="slot-actions">
          <button className="btn-approve" onClick={() => resolve(true)}>
            Confirm
          </button>
          <button className="btn-reject" onClick={() => resolve(false)}>
            Reject
          </button>
        </div>
      </div>
    );
  },
  renderResult({ data }) {
    const { title, message, confirmed } = data as {
      title: string;
      message: string;
      confirmed: boolean;
    };
    return (
      <div className="slot slot-confirm" style={{ borderStyle: "solid" }}>
        <p className="slot-title">{title}</p>
        <p className="slot-message">{message}</p>
        <div className="slot-actions">
          <span
            className={confirmed ? "btn-approve" : "btn-reject"}
            style={{ cursor: "default" }}
          >
            {confirmed ? "Confirmed" : "Rejected"}
          </span>
        </div>
      </div>
    );
  },
});

// ── propose_itinerary ───────────────────────────────────────────────────────

const proposeItineraryInputSchema = z.object({
  title: z.string().describe("Itinerary/plan title"),
  steps: z
    .array(
      z.object({
        title: z.string().describe("Step/day title"),
        description: z
          .string()
          .describe("Activities, timings, details for this step"),
      }),
    )
    .describe("Ordered list of itinerary steps"),
});

const proposeItineraryTool = defineTool({
  name: "propose_itinerary",
  description:
    "Present a structured itinerary or plan with numbered steps for user approval. Use for day-by-day trip plans, event timelines, or multi-step logistics.",
  inputSchema: proposeItineraryInputSchema,
  displayPropsSchema: proposeItineraryInputSchema,
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete",
  async do(input, display) {
    const approved = await display.pushAndWait(input);
    return {
      status: "success" as const,
      data: approved
        ? "Itinerary approved by user."
        : "Itinerary rejected by user.",
      renderData: {
        title: input.title,
        steps: input.steps,
        approved,
      },
    };
  },
  render({ props, resolve }) {
    return (
      <div className="slot slot-plan">
        <p className="slot-title">{props.title}</p>
        <ol className="plan-steps">
          {props.steps.map((step, i) => (
            <li key={i} className="plan-step">
              <strong>{step.title}</strong>
              <span>{step.description}</span>
            </li>
          ))}
        </ol>
        <div className="slot-actions">
          <button className="btn-approve" onClick={() => resolve(true)}>
            Approve Plan
          </button>
          <button className="btn-reject" onClick={() => resolve(false)}>
            Reject
          </button>
        </div>
      </div>
    );
  },
  renderResult({ data }) {
    const { title, steps, approved } = data as {
      title: string;
      steps: { title: string; description: string }[];
      approved: boolean;
    };
    return (
      <div className="slot slot-plan">
        <p className="slot-title">{title}</p>
        <ol className="plan-steps">
          {steps.map((step, i) => (
            <li key={i} className="plan-step">
              <strong>{step.title}</strong>
              <span>{step.description}</span>
            </li>
          ))}
        </ol>
        <div className="slot-actions">
          <span
            className={approved ? "btn-approve" : "btn-reject"}
            style={{ cursor: "default" }}
          >
            {approved ? "Approved" : "Rejected"}
          </span>
        </div>
      </div>
    );
  },
});

// ── show_info ───────────────────────────────────────────────────────────────

const showInfoInputSchema = z.object({
  title: z.string().describe("Card title"),
  content: z
    .string()
    .describe("Card body text (use \\n for line breaks)"),
  variant: z
    .enum(["info", "success", "warning"])
    .optional()
    .describe(
      "info = general info, success = confirmed/booked, warning = alert/heads-up",
    ),
});

const showInfoDisplaySchema = z.object({
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
  return (
    <div className={`slot slot-card slot-card-${variant}`}>
      <p className="slot-title">{title}</p>
      <p className="slot-content">{content}</p>
    </div>
  );
}

const showInfoTool = defineTool({
  name: "show_info",
  description:
    "Display a persistent information card. Use for destination highlights, budget breakdowns, packing lists, booking confirmations, travel tips, weather summaries, etc. Cards stay visible in the chat.",
  inputSchema: showInfoInputSchema,
  displayPropsSchema: showInfoDisplaySchema,
  displayStrategy: "stay",
  async do(input, display) {
    const variant = input.variant ?? "info";
    await display.pushAndForget({
      title: input.title,
      content: input.content,
      variant,
    });
    return {
      status: "success" as const,
      data: `Displayed card: ${input.title}`,
      renderData: { title: input.title, content: input.content, variant },
    };
  },
  render({ props }) {
    return (
      <InfoCard title={props.title} content={props.content} variant={props.variant} />
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

// ─── Tools without display (raw ToolConfig) ─────────────────────────────────

const estimateBudgetTool: ToolConfig = {
  name: "estimate_budget",
  description:
    "Calculate a trip budget estimate given a list of cost items. Returns a formatted breakdown.",
  inputSchema: z.object({
    currency: z.string().describe("Currency code, e.g. USD, EUR, JPY"),
    items: z
      .array(
        z.object({
          category: z
            .string()
            .describe("e.g. Flights, Hotel, Food, Activities, Transport"),
          description: z.string().describe("Brief description"),
          amount: z.number().describe("Estimated cost"),
        }),
      )
      .describe("List of cost items"),
  }),
  async do(input): Promise<ToolResultData> {
    const { currency, items } = input as {
      currency: string;
      items: { category: string; description: string; amount: number }[];
    };
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    const breakdown = items
      .map(
        (item) =>
          `${item.category}: ${item.amount} ${currency} — ${item.description}`,
      )
      .join("\n");
    return {
      status: "success",
      data: `Budget Estimate (${currency}):\n${breakdown}\n\nTotal: ${total} ${currency}`,
    };
  },
};

const getDateTool: ToolConfig = {
  name: "get_date",
  description: "Get today's date and day of week for date-aware planning",
  inputSchema: z.object({}),
  async do(): Promise<ToolResultData> {
    const now = new Date();
    return {
      status: "success",
      data: `Today is ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`,
    };
  },
};

// ─── All tools ──────────────────────────────────────────────────────────────

const tools: ToolConfig[] = [
  askPreferenceTool,
  confirmBookingTool,
  proposeItineraryTool,
  showInfoTool,
  estimateBudgetTool,
  getDateTool,
];

// ─── System prompt ──────────────────────────────────────────────────────────

const systemPrompt = `You are an expert trip and event planner. You help users plan trips, vacations, events, and outings by gathering their preferences interactively and building detailed itineraries.

Your workflow:
1. Start by understanding what the user wants to plan (trip, event, outing, etc.)
2. Use ask_preference to gather key decisions: destination, dates, budget range, accommodation style, activity types, dietary preferences, group size, etc. Don't ask everything at once — gather info progressively.
3. Once you have enough context, use propose_itinerary to present a structured day-by-day plan or event timeline.
4. Use show_info to display useful cards: destination highlights, budget breakdowns (use estimate_budget first), packing lists, travel tips, booking summaries, weather notes.
5. Use confirm_booking before finalizing major decisions like flight choices, hotel selections, or the final itinerary.

Guidelines:
- Be enthusiastic and knowledgeable about destinations and experiences
- Always use your interactive tools — never just dump a wall of text when a choice, card, or plan would be clearer
- Present budget estimates as info cards so they stay visible
- After an itinerary is approved, show a success card with a summary
- If the user rejects a plan, ask what they'd change and propose a revision
- Use get_date to be aware of the current date for scheduling`;

// ─── Client ─────────────────────────────────────────────────────────────────

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt,
  tools,
});
