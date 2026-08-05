// The demo Glove agent. Authored EXACTLY like a text agent — tools, prompt,
// store — and handed to RealtimeAgent unchanged. That's the point of the
// package: one tool definition serves text turns and voice turns.
//
// The tools here are chosen to be VISIBLE: ask the agent to switch the theme
// or take a note and you can see the tool call land on the page, which makes
// "the voice model really is calling my Glove tools" verifiable by eye.

import { Displaymanager, Glove, MemoryStore } from "glove-core";
import { s2sDrivenModel } from "glove-voice-s2s";
import { z } from "zod";

// ── UI bridge ────────────────────────────────────────────────────────────────
// Tool `do()` functions run outside the React tree, so the page registers its
// setters here (the same mutable-singleton bridge pattern the docs recommend).

export type Theme = "light" | "dark" | "ocean" | "sunset";

export interface UiBridge {
  setTheme(theme: Theme): void;
  addNote(text: string): string[];
  getNotes(): string[];
}

export const uiBridge: { current: UiBridge | null } = { current: null };

// ── the agent ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You are Aria, a friendly voice assistant living inside a small demo page.",
  "Keep replies short and conversational — one or two spoken sentences.",
  "You have tools: get_time tells the current time, set_theme changes the",
  "page's colour theme (light, dark, ocean, sunset), add_note pins a note to",
  "the page, and list_notes reads the pinned notes back.",
  "When a tool succeeds, confirm it out loud briefly. Never read JSON aloud.",
].join(" ");

export function buildAgent() {
  return new Glove({
    store: new MemoryStore(`s2s_demo_${Date.now()}`),
    // This demo only runs VOICE turns — the placeholder (from glove-voice-s2s)
    // fails loudly if Glove's loop is ever run; wire a real createAdapter(...)
    // to serve text turns from the same agent.
    model: s2sDrivenModel("aria-demo"),
    displayManager: new Displaymanager(),
    systemPrompt: SYSTEM_PROMPT,
    compaction_config: {
      compaction_instructions: "Summarize the conversation so far.",
    },
  })
    .fold({
      name: "get_time",
      description: "Get the user's current local date and time.",
      inputSchema: z.object({}),
      async do() {
        return { status: "success" as const, data: new Date().toString() };
      },
    })
    .fold({
      name: "set_theme",
      description:
        "Change the page's colour theme. Use when the user asks to change how the page looks.",
      inputSchema: z.object({
        theme: z
          .enum(["light", "dark", "ocean", "sunset"])
          .describe("The theme to switch the page to"),
      }),
      async do(input) {
        if (!uiBridge.current) {
          return { status: "error" as const, data: null, message: "The page is not ready yet." };
        }
        uiBridge.current.setTheme(input.theme);
        return { status: "success" as const, data: `Theme is now ${input.theme}.` };
      },
    })
    .fold({
      name: "add_note",
      description: "Pin a short note to the page for the user.",
      inputSchema: z.object({
        text: z.string().describe("The note text to pin"),
      }),
      async do(input) {
        if (!uiBridge.current) {
          return { status: "error" as const, data: null, message: "The page is not ready yet." };
        }
        const notes = uiBridge.current.addNote(input.text);
        return {
          status: "success" as const,
          data: `Note pinned. There are now ${notes.length} note(s).`,
        };
      },
    })
    .fold({
      name: "list_notes",
      description: "Read back the notes currently pinned to the page.",
      inputSchema: z.object({}),
      async do() {
        const notes = uiBridge.current?.getNotes() ?? [];
        return {
          status: "success" as const,
          data: notes.length ? notes.join(" | ") : "There are no notes yet.",
        };
      },
    })
    .build();
}
