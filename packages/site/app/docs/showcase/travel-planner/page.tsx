import { CodeBlock } from "@/components/code-block";

export default async function TravelPlannerPage() {
  return (
    <div className="docs-content">
      <h1>Build a Travel Planner</h1>

      <p>
        In this tutorial you will build a travel planning app where users
        describe a trip and the AI gathers their preferences, proposes an
        itinerary, and asks for confirmation — all through real UI, not walls
        of text.
      </p>

      <p>
        This is where the display stack shines. A traditional chatbot would
        dump a paragraph of destination options. Your app will show clickable
        option pickers, styled itinerary cards, and confirmation dialogs —
        the AI decides <em>when</em> to show them, and your tools decide{" "}
        <em>what</em> they look like.
      </p>

      <p>
        <strong>Prerequisites:</strong> You should have completed{" "}
        <a href="/docs/getting-started">Getting Started</a> and read{" "}
        <a href="/docs/display-stack">The Display Stack</a>. This tutorial
        builds on both.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>What you will build</h2>

      <p>
        By the end of this tutorial, a user can say &ldquo;Plan a weekend trip
        to Japan&rdquo; and the app will:
      </p>

      <ol>
        <li>
          Ask for preferences — budget, accommodation style, activity types —
          using interactive option pickers (<code>pushAndWait</code>)
        </li>
        <li>
          Show destination highlights as info cards that persist in the chat
          (<code>pushAndForget</code>)
        </li>
        <li>
          Propose a day-by-day itinerary for the user to approve or reject
          (<code>pushAndWait</code>)
        </li>
        <li>
          Collect traveler details through a dynamic form
          (<code>pushAndWait</code>)
        </li>
        <li>
          Ask for final confirmation before booking
          (<code>pushAndWait</code>)
        </li>
      </ol>

      <p>
        Five tools, three display stack patterns. The AI orchestrates the
        entire flow — you never write routing logic or state machines.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>1. Project setup</h2>

      <p>
        Start from a Next.js project with Glove installed. If you followed{" "}
        <a href="/docs/getting-started">Getting Started</a>, you already have
        this. Otherwise:
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-core glove-react glove-next zod`}
      />

      <p>
        Create the API route if you don&apos;t have one:
      </p>

      <CodeBlock
        filename="app/api/chat/route.ts"
        language="typescript"
        code={`import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "openai",    // or "anthropic"
  model: "gpt-4o-mini",  // or "claude-sonnet-4-20250514"
});`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>2. The preference picker tool</h2>

      <p>
        The first tool gathers user preferences. Instead of asking &ldquo;What
        is your budget?&rdquo; as plain text and waiting for a free-form reply,
        this tool shows a set of buttons the user can click. The AI picks up
        the result and moves on.
      </p>

      <p>
        This is <code>pushAndWait</code> — the tool pauses until the user
        clicks an option. We use <code>defineTool</code> to get full type
        safety — the <code>displayPropsSchema</code> types what the render
        function receives, and the <code>resolveSchema</code> types what{" "}
        <code>resolve()</code> accepts. No more <code>as</code> casts.
      </p>

      <CodeBlock
        filename="lib/tools/ask-preference.tsx"
        language="tsx"
        code={`import { z } from "zod";
import { defineTool } from "glove-react";

export const askPreference = defineTool({
  name: "ask_preference",
  description:
    "Present the user with a set of options to choose from. " +
    "Blocks until they pick one. Use for destination choices, " +
    "budget ranges, accommodation types, activity preferences.",
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

  displayPropsSchema: z.object({
    question: z.string(),
    options: z.array(z.object({ label: z.string(), value: z.string() })),
  }),
  resolveSchema: z.string(),
  displayStrategy: "hide-on-complete",

  async do(input, display) {
    // Tool PAUSES here — execution resumes when the user clicks
    const selected = await display.pushAndWait(input);
    return {
      status: "success" as const,
      data: \`User selected: \${selected}\`,
      renderData: { question: input.question, selected },
    };
  },

  render({ props, resolve }) {
    return (
      <div style={{ padding: 16, border: "1px dashed #9ED4B8", borderRadius: 12 }}>
        <p style={{ fontWeight: 500, marginBottom: 12 }}>{props.question}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {props.options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => resolve(opt.value)}
              style={{
                padding: "8px 16px",
                border: "1px solid #333",
                borderRadius: 8,
                background: "#141414",
                color: "#ededed",
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

  renderResult({ data }) {
    const { question, selected } = data as { question: string; selected: string };
    return (
      <div
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          background: "#0a0a0a",
          border: "1px solid #262626",
          fontSize: 13,
          color: "#9ED4B8",
        }}
      >
        {question}: <strong>{selected}</strong>
      </div>
    );
  },
});`}
      />

      <p>
        Notice the flow: the AI decides <em>what</em> to ask (the question and
        options come from the AI as tool arguments). Your tool decides{" "}
        <em>how</em> to present it (buttons in a row). The AI gets back the
        selected value and uses it to inform the next step.
      </p>

      <p>
        Because we set <code>displayStrategy: &quot;hide-on-complete&quot;</code>,
        the picker disappears once the user clicks an option. In its place, the{" "}
        <code>renderResult</code> function shows a compact summary of what they
        chose — so the conversation history stays clean.
      </p>

      <p>
        The AI might call this tool multiple times in one session — once for
        budget, once for accommodation type, once for activity preferences.
        Each time, a fresh picker appears in the UI.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>3. The info card tool</h2>

      <p>
        Once the AI knows where the user wants to go, it can show destination
        highlights, packing lists, or budget breakdowns as persistent cards.
        These stay visible in the chat — the user can scroll back to reference
        them.
      </p>

      <p>
        This is <code>pushAndForget</code> — the tool shows UI and keeps
        running. Since the card should remain visible, we use{" "}
        <code>displayStrategy: &quot;stay&quot;</code>.
      </p>

      <CodeBlock
        filename="lib/tools/show-info.tsx"
        language="tsx"
        code={`import { z } from "zod";
import { defineTool } from "glove-react";

export const showInfo = defineTool({
  name: "show_info",
  description:
    "Display a persistent info card. Use for destination highlights, " +
    "budget breakdowns, packing lists, travel tips, booking confirmations. " +
    "Cards stay visible in the chat.",
  inputSchema: z.object({
    title: z.string().describe("Card title"),
    content: z
      .string()
      .describe("Card body text (use \\\\n for line breaks)"),
    variant: z
      .enum(["info", "success", "warning"])
      .optional()
      .describe("info = general, success = confirmed, warning = alert"),
  }),

  displayPropsSchema: z.object({
    title: z.string(),
    content: z.string(),
    variant: z.enum(["info", "success", "warning"]),
  }),
  displayStrategy: "stay",

  async do(input, display) {
    // pushAndForget — card appears, tool keeps running
    await display.pushAndForget({
      title: input.title,
      content: input.content,
      variant: input.variant ?? "info",
    });
    return { status: "success" as const, data: \`Displayed card: \${input.title}\` };
  },

  render({ props }) {
    const accentColor =
      props.variant === "success" ? "#22c55e" :
      props.variant === "warning" ? "#f59e0b" : "#9ED4B8";

    return (
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          borderLeft: \`3px solid \${accentColor}\`,
          background: "#141414",
        }}
      >
        <p style={{ fontWeight: 600, marginBottom: 8 }}>{props.title}</p>
        {props.content.split("\\n").map((line, i) => (
          <p key={i} style={{ color: "#888", fontSize: 13, lineHeight: 1.6 }}>
            {line}
          </p>
        ))}
      </div>
    );
  },
});`}
      />

      <p>
        The AI uses this tool whenever it wants to show information in a
        structured way. A budget breakdown appears as a card with a colored
        accent. A booking confirmation appears as a green success card. The AI
        decides when and what — your tool decides the visual treatment.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>4. The itinerary proposal tool</h2>

      <p>
        This is the centerpiece. The AI builds a day-by-day itinerary and
        presents it for approval. The user can approve or reject — if they
        reject, the AI asks what to change and proposes a revision.
      </p>

      <p>
        This is <code>pushAndWait</code> again, but with richer UI — a
        numbered step list with Approve/Reject buttons. The{" "}
        <code>resolveSchema</code> is <code>z.boolean()</code> because the
        user either approves or rejects.
      </p>

      <CodeBlock
        filename="lib/tools/propose-itinerary.tsx"
        language="tsx"
        code={`import { z } from "zod";
import { defineTool } from "glove-react";

export const proposeItinerary = defineTool({
  name: "propose_itinerary",
  description:
    "Present a structured itinerary with numbered steps for user approval. " +
    "Use for day-by-day trip plans or event timelines. " +
    "Blocks until the user approves or rejects.",
  inputSchema: z.object({
    title: z.string().describe("Itinerary title"),
    steps: z
      .array(
        z.object({
          title: z.string().describe("Step/day title"),
          description: z.string().describe("Activities and details"),
        }),
      )
      .describe("Ordered list of itinerary steps"),
  }),

  displayPropsSchema: z.object({
    title: z.string(),
    steps: z.array(z.object({ title: z.string(), description: z.string() })),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete",

  async do(input, display) {
    const approved = await display.pushAndWait(input);

    return {
      status: "success" as const,
      data: approved
        ? "Itinerary approved by user."
        : "Itinerary rejected — ask what they would like to change.",
    };
  },

  render({ props, resolve }) {
    return (
      <div style={{ padding: 16, border: "1px solid #9ED4B8", borderRadius: 12 }}>
        <p style={{ fontWeight: 600, marginBottom: 12 }}>{props.title}</p>
        <ol style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {props.steps.map((step, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "8px 10px",
                borderRadius: 6,
                background: "#0a0a0a",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#9ED4B8" }}>
                  {i + 1}
                </span>
                <strong style={{ fontSize: 13 }}>{step.title}</strong>
              </div>
              <span style={{ fontSize: 12, color: "#888", paddingLeft: 18 }}>
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
              background: "#22c55e",
              color: "#fff",
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
              background: "#262626",
              color: "#888",
              cursor: "pointer",
            }}
          >
            Reject
          </button>
        </div>
      </div>
    );
  },
});`}
      />

      <p>
        The reject path is where the display stack really shows its strength.
        In a traditional chatbot, the user would type &ldquo;No, I don&apos;t
        like that&rdquo; and the AI might misunderstand. Here, the AI gets a
        clean boolean — it knows the plan was rejected and can ask a specific
        follow-up question.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>5. The traveler details form</h2>

      <p>
        Before finalizing a trip, you need names, emails, and dietary
        restrictions. The <code>collect_form</code> tool renders a dynamic form
        that the AI can configure at runtime — it decides which fields to
        show.
      </p>

      <CodeBlock
        filename="lib/tools/collect-form.tsx"
        language="tsx"
        code={`import { z } from "zod";
import { useState, useCallback } from "react";
import { defineTool } from "glove-react";

export const collectForm = defineTool({
  name: "collect_form",
  description:
    "Render a dynamic form with multiple fields and collect input. " +
    "Blocks until the user submits. Use for traveler details, " +
    "contact info, or any structured data collection.",
  inputSchema: z.object({
    title: z.string().describe("Form title"),
    fields: z
      .array(
        z.object({
          name: z.string().describe("Field key"),
          label: z.string().describe("Display label"),
          type: z.enum(["text", "number", "email"]).describe("Input type"),
          required: z.boolean().optional().describe("Whether required"),
        }),
      )
      .describe("List of form fields"),
  }),

  displayPropsSchema: z.object({
    title: z.string(),
    fields: z.array(
      z.object({
        name: z.string(),
        label: z.string(),
        type: z.enum(["text", "number", "email"]),
        required: z.boolean().optional(),
      }),
    ),
  }),
  resolveSchema: z.record(z.string()),
  displayStrategy: "hide-on-complete",

  async do(input, display) {
    // Tool pauses until the user fills out and submits the form
    const result = await display.pushAndWait(input);
    return { status: "success" as const, data: JSON.stringify(result) };
  },

  render({ props, resolve }) {
    // Regular React hooks — render is a React component
    const [values, setValues] = useState<Record<string, string>>({});
    const update = useCallback(
      (name: string, val: string) =>
        setValues((prev) => ({ ...prev, [name]: val })),
      [],
    );
    const canSubmit = props.fields
      .filter((f) => f.required)
      .every((f) => (values[f.name] ?? "").trim() !== "");

    return (
      <div style={{ padding: 16, border: "1px dashed #9ED4B8", borderRadius: 12 }}>
        <p style={{ fontWeight: 600, marginBottom: 14 }}>{props.title}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {props.fields.map((field) => (
            <div key={field.name}>
              <label style={{ display: "block", fontSize: 12, color: "#888", marginBottom: 4 }}>
                {field.label}
                {field.required && <span style={{ color: "#ef4444" }}> *</span>}
              </label>
              <input
                type={field.type}
                value={values[field.name] ?? ""}
                onChange={(e) => update(field.name, e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #333",
                  borderRadius: 6,
                  background: "#0a0a0a",
                  color: "#ededed",
                  fontSize: 13,
                }}
              />
            </div>
          ))}
        </div>
        <button
          onClick={() => canSubmit && resolve(values)}
          disabled={!canSubmit}
          style={{
            marginTop: 14,
            padding: "8px 20px",
            border: "none",
            borderRadius: 6,
            background: canSubmit ? "#9ED4B8" : "#333",
            color: "#0a0a0a",
            cursor: canSubmit ? "pointer" : "not-allowed",
            opacity: canSubmit ? 1 : 0.5,
          }}
        >
          Submit
        </button>
      </div>
    );
  },
});`}
      />

      <p>
        Notice that the <code>render</code> function uses{" "}
        <code>useState</code> and <code>useCallback</code> — it is a real
        React component. You can use any hook you normally use. The display
        stack handles mounting, unmounting, and passing data between the tool
        and the component.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>6. The confirmation tool</h2>

      <p>
        The last guardrail: before the AI finalizes anything, it shows a
        confirmation dialog. This is the simplest <code>pushAndWait</code>{" "}
        pattern — two buttons, boolean result.
      </p>

      <CodeBlock
        filename="lib/tools/confirm-booking.tsx"
        language="tsx"
        code={`import { z } from "zod";
import { defineTool } from "glove-react";

export const confirmBooking = defineTool({
  name: "confirm_booking",
  description:
    "Show a confirmation dialog before finalizing a booking. " +
    "Blocks until the user confirms or cancels.",
  inputSchema: z.object({
    title: z.string().describe("What you are confirming"),
    message: z.string().describe("Details about the booking"),
  }),

  displayPropsSchema: z.object({
    title: z.string(),
    message: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete",

  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    return {
      status: "success" as const,
      data: confirmed ? "User confirmed." : "User cancelled.",
      renderData: { confirmed },
    };
  },

  render({ props, resolve }) {
    return (
      <div style={{ padding: 16, border: "1px dashed #f59e0b", borderRadius: 12 }}>
        <p style={{ fontWeight: 600, marginBottom: 8 }}>{props.title}</p>
        <p style={{ color: "#888", marginBottom: 12, lineHeight: 1.5 }}>{props.message}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => resolve(true)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 6,
              background: "#22c55e",
              color: "#fff",
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
              background: "#262626",
              color: "#888",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  },

  renderResult({ data }) {
    const { confirmed } = data as { confirmed: boolean };
    return (
      <div
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          background: "#0a0a0a",
          border: \`1px solid \${confirmed ? "#22c55e" : "#ef4444"}\`,
          fontSize: 13,
          color: confirmed ? "#22c55e" : "#ef4444",
        }}
      >
        Booking {confirmed ? "confirmed" : "cancelled"}
      </div>
    );
  },
});`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>7. Wire it together</h2>

      <p>
        Register all five tools with your <code>GloveClient</code>. The system
        prompt is critical — it tells the AI <em>how</em> to use the tools
        together as a workflow.
      </p>

      <CodeBlock
        filename="lib/glove.ts"
        language="typescript"
        code={`import { GloveClient } from "glove-react";
import { askPreference } from "./tools/ask-preference";
import { showInfo } from "./tools/show-info";
import { proposeItinerary } from "./tools/propose-itinerary";
import { collectForm } from "./tools/collect-form";
import { confirmBooking } from "./tools/confirm-booking";

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",

  systemPrompt: \`You are an expert trip planner. Help users plan trips by
gathering their preferences interactively and building detailed itineraries.

Your workflow:
1. Start by understanding what the user wants to plan.
2. Use ask_preference to gather key decisions: destination, dates,
   budget range, accommodation style, activity types. Don't ask
   everything at once — gather info progressively.
3. Use show_info to display destination highlights, budget breakdowns,
   or travel tips as info cards.
4. Once you have enough context, use propose_itinerary to present a
   day-by-day plan for approval.
5. If the user rejects, ask what they'd change and propose a revision.
6. Once approved, use collect_form to gather traveler details.
7. Use confirm_booking before finalizing.

Always use your interactive tools — never dump a wall of text when
an option picker, card, or plan would be clearer.\`,

  tools: [askPreference, showInfo, proposeItinerary, collectForm, confirmBooking],
});`}
      />

      <p>
        The system prompt is where you define the agent&apos;s workflow. Notice
        that it is a description, not code — the AI interprets it and decides
        the order at runtime based on what the user asks. If a user says
        &ldquo;I already know I want Tokyo,&rdquo; the AI skips the destination
        picker and goes straight to dates and budget.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>8. Build the chat UI</h2>

      <p>
        The chat component uses the <code>&lt;Render&gt;</code> component to
        display the conversation, tool slots, and input area. Instead of
        manually mapping over timeline entries and slots,{" "}
        <code>&lt;Render&gt;</code> handles display strategy filtering,
        interleaving slots inline with messages, and rendering{" "}
        <code>renderResult</code> for completed tools — all automatically.
      </p>

      <CodeBlock
        filename="app/page.tsx"
        language="tsx"
        code={`"use client";

import { useRef } from "react";
import { useGlove, Render } from "glove-react";

export default function TravelPlanner() {
  const glove = useGlove();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ maxWidth: 600, margin: "2rem auto" }}>
      <h1>Trip Planner</h1>

      <Render
        glove={glove}
        strategy="interleaved"
        renderMessage={({ entry }) => (
          <div style={{ margin: "1rem 0" }}>
            <strong>{entry.kind === "user" ? "You" : "Planner"}:</strong>{" "}
            {entry.text}
          </div>
        )}
        renderStreaming={({ text }) => (
          <div style={{ opacity: 0.7 }}>
            <strong>Planner:</strong> {text}
          </div>
        )}
        renderInput={({ send, busy }) => (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const val = inputRef.current?.value?.trim();
              if (!val || busy) return;
              send(val);
              if (inputRef.current) inputRef.current.value = "";
            }}
            style={{ display: "flex", gap: "0.5rem" }}
          >
            <input
              ref={inputRef}
              placeholder="Where do you want to go?"
              disabled={busy}
              style={{ flex: 1, padding: "0.5rem" }}
            />
            <button type="submit" disabled={busy}>
              Send
            </button>
          </form>
        )}
      />
    </div>
  );
}`}
      />

      <p>
        That is the entire UI. The <code>&lt;Render&gt;</code> component
        handles all the heavy lifting — every tool with a{" "}
        <code>render</code> function automatically shows its UI when the AI
        calls it. Option pickers, itinerary cards, forms, and confirmation
        dialogs all appear inline within the conversation, driven by the AI.
        When a tool completes and has{" "}
        <code>displayStrategy: &quot;hide-on-complete&quot;</code>, its
        interactive UI disappears and the <code>renderResult</code> view takes
        its place — keeping the conversation history clean without losing
        context.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>9. Run it</h2>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm dev`}
      />

      <p>
        Try these conversations:
      </p>

      <ul>
        <li>
          <strong>&ldquo;Plan a weekend trip to Japan&rdquo;</strong> — the AI
          will ask about budget, accommodation, and activities using option
          pickers, then propose an itinerary
        </li>
        <li>
          <strong>&ldquo;I want a budget beach vacation&rdquo;</strong> — the
          AI adapts, skipping irrelevant preferences and focusing on
          beach-friendly destinations
        </li>
        <li>
          <strong>Reject an itinerary</strong> — click Reject, then tell the
          AI what to change. It will propose a revised plan.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>How the display stack drives this app</h2>

      <p>
        Step back and look at what the display stack is doing here. A
        traditional chatbot version of this app would be:
      </p>

      <ol>
        <li>AI: &ldquo;What&apos;s your budget? Low / Medium / High?&rdquo;</li>
        <li>User types: &ldquo;medium&rdquo;</li>
        <li>AI: &ldquo;What kind of accommodation?&rdquo;</li>
        <li>User types: &ldquo;hotel&rdquo;</li>
        <li>AI dumps a 500-word itinerary as text</li>
        <li>User types: &ldquo;ok that looks fine&rdquo;</li>
      </ol>

      <p>
        With the display stack, the same flow becomes:
      </p>

      <ol>
        <li>
          AI calls <code>ask_preference</code> — user clicks a
          &ldquo;Medium&rdquo; button
        </li>
        <li>
          AI calls <code>ask_preference</code> — user clicks
          &ldquo;Hotel&rdquo;
        </li>
        <li>
          AI calls <code>show_info</code> — a styled destination card appears
        </li>
        <li>
          AI calls <code>propose_itinerary</code> — a numbered day-by-day plan
          with Approve/Reject buttons
        </li>
        <li>
          User clicks <strong>Approve</strong> — AI calls{" "}
          <code>confirm_booking</code> — a final confirmation dialog
        </li>
      </ol>

      <p>
        The AI is still orchestrating. But the user interacts with real UI
        components instead of typing free-form text. The result is faster,
        clearer, and less error-prone.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Display patterns used</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Pattern</th>
            <th>Display Strategy</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>ask_preference</code></td>
            <td><code>pushAndWait</code></td>
            <td><code>hide-on-complete</code></td>
            <td>AI needs the user&apos;s choice before continuing</td>
          </tr>
          <tr>
            <td><code>show_info</code></td>
            <td><code>pushAndForget</code></td>
            <td><code>stay</code></td>
            <td>Shows data, AI doesn&apos;t need to wait</td>
          </tr>
          <tr>
            <td><code>propose_itinerary</code></td>
            <td><code>pushAndWait</code></td>
            <td><code>hide-on-complete</code></td>
            <td>AI needs approval before proceeding</td>
          </tr>
          <tr>
            <td><code>collect_form</code></td>
            <td><code>pushAndWait</code></td>
            <td><code>hide-on-complete</code></td>
            <td>AI needs form data to continue</td>
          </tr>
          <tr>
            <td><code>confirm_booking</code></td>
            <td><code>pushAndWait</code></td>
            <td><code>hide-on-complete</code></td>
            <td>Final gate before irreversible action</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Next steps</h2>

      <ul>
        <li>
          <a href="/docs/showcase/coding-agent">Build a Coding Agent</a> — see
          how the display stack enables human-in-the-loop code editing
        </li>
        <li>
          <a href="/docs/showcase/ecommerce-store">Build a Shopping Assistant</a>{" "}
          — product grids, variant pickers, and checkout flows
        </li>
        <li>
          <a href="/docs/showcase/terminal-agent">Build a Terminal Agent</a>{" "}
          — use <code>glove-core</code> directly without React
        </li>
        <li>
          <a href="/tools">Tool Registry</a> — browse pre-built tools you can
          drop into your app
        </li>
        <li>
          <a href="/docs/react#define-tool">
            <code>defineTool</code> Reference
          </a>{" "}
          — full API for type-safe tool definitions
        </li>
        <li>
          <a href="/docs/react#render-component">
            <code>&lt;Render&gt;</code> Reference
          </a>{" "}
          — rendering strategies and customization
        </li>
        <li>
          <a href="/docs/display-stack#display-strategies">
            Display Strategies
          </a>{" "}
          — <code>stay</code>, <code>hide-on-complete</code>, and{" "}
          <code>hide-on-new</code> explained
        </li>
      </ul>
    </div>
  );
}
