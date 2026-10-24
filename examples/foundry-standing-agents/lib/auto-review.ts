import type { GloveFoldArgs, ToolResultData } from "glove-core";
import type { Level } from "./dot.js";

/** Built-in safety: these stay with the person whatever the rules say. */
export const ALWAYS_HANDED_OFF: ReadonlySet<string> = new Set(["change_password"]);

/** The four Custom Rules levels, as the person sees them. */
export const LEVEL_LABELS: Readonly<Record<Level, string>> = {
  act: "Take action without asking",
  "on-request": "Take action when you say so",
  ask: "Ask before taking action",
  "hand-off": "Hand off to you",
};

/** An action the dot can take, before review. */
export interface Action<I = any> extends GloveFoldArgs<I> {
  /** Who the action writes to, for actions that send something. */
  readonly recipient?: (input: I) => string;
  /** What the person should do when the action is handed to them. */
  readonly handOff: (input: I) => string;
}

export interface Review {
  readonly owner: string;
  readonly rules: Readonly<Record<string, Level>>;
  /** True when the person started this run: in the app, or by messaging the dot. */
  readonly personStarted: boolean;
  /** Addresses the dot may write to without asking. */
  readonly contacts: ReadonlyArray<string>;
  /** Where to tell the person about a hand-off, from the dot's routing. */
  readonly tellPerson: string;
}

/** The level an action runs at. Built-in safety comes first; no rule lifts it. */
export function levelFor(name: string, rules: Readonly<Record<string, Level>>): Level {
  if (ALWAYS_HANDED_OFF.has(name)) return "hand-off";
  return rules[name] ?? "ask";
}

/**
 * Auto-review. Every acting tool is wrapped here before it is mounted:
 * - hand-off: it never runs; the dot is told what to hand the person.
 * - on-request: it runs only on a run the person started.
 * - ask: Foundry holds the call as an approval until the person decides.
 * - act: it runs, unless it writes to someone outside the known contacts;
 *   then it asks.
 * It cannot be turned off: the dot only ever sees the reviewed tool.
 */
export function reviewed<I>(action: Action<I>, review: Review): GloveFoldArgs<I> {
  const { recipient, handOff, ...tool } = action;
  const level = levelFor(action.name, review.rules);
  const described = { ...tool, description: `${tool.description} Rule: ${LEVEL_LABELS[level]}.` };

  if (level === "hand-off") {
    return {
      ...described,
      do: async (input) => notRun(action.name, "hand-off", `It stays with ${review.owner}. ${handOff(input)} ${review.tellPerson}`),
    };
  }
  if (level === "on-request" && !review.personStarted) {
    return {
      ...described,
      do: async () => notRun(action.name, "on-request", `It runs only when ${review.owner} asks for it. Ask them first.`),
    };
  }
  // The instruction check: writing to someone the dot doesn't know always asks.
  const unknownRecipient = (input: I) =>
    recipient !== undefined && !review.contacts.includes(recipient(input).trim().toLowerCase());
  return {
    ...described,
    requiresPermission: level === "ask" ? true : unknownRecipient,
  };
}

function notRun(name: string, review: Level, message: string): ToolResultData {
  return { status: "error", data: { ran: false, review }, message: `Auto-review: ${name} did not run. ${message}` };
}
