import type { GloveFoldArgs, ToolResultData } from "glove-core";
import type { Level } from "./dot.js";

/** Built-in safety: these stay with the person whatever the Custom Rules say. */
export const ALWAYS_YOURS: ReadonlySet<string> = new Set(["change_password"]);

/** The Custom Rules settings, as the person sees them. */
export const LEVEL_LABELS: Readonly<Record<Level, string>> = {
  allow: "Take action on its own",
  ask: "Ask for approval first",
  block: "Don't take it; hand it to you",
};

/** An action the dot can take, before review. */
export interface Action<I = any> extends GloveFoldArgs<I> {
  /** The Custom Rule it runs under, when that is not its tool name. */
  readonly rule?: string;
  /** Who the action writes to, for actions that send something. */
  readonly recipient?: (input: I) => string;
  /** What the person should do when the action is handed to them. */
  readonly handOff: (input: I) => string;
}

export interface Review {
  readonly owner: string;
  readonly rules: Readonly<Record<string, Level>>;
  /** Addresses the dot may write to without asking. */
  readonly contacts: ReadonlyArray<string>;
  /** Where to tell the person about a hand-off, from the dot's routing. */
  readonly tellPerson: string;
}

/** The rule an action runs under. Built-in safety comes first; no Custom Rule lifts it. */
export function levelFor(name: string, rules: Readonly<Record<string, Level>>): Level {
  if (ALWAYS_YOURS.has(name)) return "block";
  return rules[name] ?? "ask";
}

/** How the rule reads in the prompt, naming built-in safety where it applies. */
export function ruleLabel(name: string, rules: Readonly<Record<string, Level>>): string {
  return ALWAYS_YOURS.has(name) ? "Always yours (built-in safety)" : LEVEL_LABELS[levelFor(name, rules)];
}

/**
 * Auto-review. Every acting tool is wrapped here before it is mounted:
 * - block, and built-in safety: it never runs; the dot is told what to hand
 *   the person and where to tell them.
 * - ask: Foundry holds the call as an approval until the person decides.
 * - allow: it runs, unless it would share something with someone outside the
 *   known contacts; then it asks, whatever the rule says.
 * It cannot be turned off: the dot only ever sees the reviewed tool.
 */
export function reviewed<I>(action: Action<I>, review: Review): GloveFoldArgs<I> {
  const { recipient, handOff, rule = action.name, ...tool } = action;
  const level = levelFor(rule, review.rules);
  const described = { ...tool, description: `${tool.description} Rule: ${ruleLabel(rule, review.rules)}.` };

  if (level === "block") {
    return {
      ...described,
      do: async (input) => notRun(rule, `It stays with ${review.owner}. ${handOff(input)} ${review.tellPerson}`),
    };
  }
  // The instruction check: writing to someone the person never heard from always asks.
  const unknownRecipient = (input: I) =>
    recipient !== undefined && !review.contacts.includes(recipient(input).trim().toLowerCase());
  return {
    ...described,
    requiresPermission: level === "ask" ? true : unknownRecipient,
  };
}

function notRun(name: string, message: string): ToolResultData {
  return { status: "error", data: { ran: false, review: "block" }, message: `Auto-review: ${name} did not run. ${message}` };
}
