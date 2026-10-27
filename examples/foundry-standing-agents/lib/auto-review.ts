import type { GloveFoldArgs, ToolResultData } from "glove-core";
import type { Level } from "./dot.js";

// Built-in safety, in two tiers, whatever the Custom Rules say. The sets state
// the policy for any action registered under these names; of the actions here,
// only change_password is one.

/** Always handed to the person. */
export const ALWAYS_YOURS: ReadonlySet<string> = new Set(["change_password", "transfer_money"]);
/** Never below "ask first". */
export const ALWAYS_ASKS: ReadonlySet<string> = new Set(["delete_permanently", "install_software", "buy_with_saved_card"]);

/** The Custom Rules settings, as the person sees them. */
export const LEVEL_LABELS: Readonly<Record<Level, string>> = {
  allow: "Act without asking",
  when_asked: "Act when asked",
  ask: "Ask first",
  block: "Hand off to you",
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
  /** Whether the person started this run. "Act when asked" acts without asking only then. */
  readonly askedByPerson: boolean;
  /** Addresses the dot may write to without asking. */
  readonly contacts: ReadonlyArray<string>;
  /** Where to tell the person about a hand-off, from the dot's routing. */
  readonly tellPerson: string;
  /** Keeps a record of each hand-off the person can list (lib/handoffs.ts). */
  readonly handedOff?: (action: string, todo: string) => Promise<unknown>;
}

/** The rule an action runs under. Built-in safety comes first; no Custom Rule lifts it. */
export function levelFor(name: string, rules: Readonly<Record<string, Level>>): Level {
  if (ALWAYS_YOURS.has(name)) return "block";
  const level = rules[name] ?? "ask";
  return ALWAYS_ASKS.has(name) && (level === "allow" || level === "when_asked") ? "ask" : level;
}

/** How the rule reads in the prompt, naming built-in safety where it applies. */
export function ruleLabel(name: string, rules: Readonly<Record<string, Level>>): string {
  const label = LEVEL_LABELS[levelFor(name, rules)];
  return ALWAYS_YOURS.has(name) || ALWAYS_ASKS.has(name) ? `${label} (built-in safety)` : label;
}

/**
 * Auto-review. Every acting tool is wrapped here before it is mounted:
 * - block, and "always yours": it never runs; the dot is told what to hand
 *   the person and where to tell them.
 * - ask: Foundry holds the call as an approval until the person decides.
 * - when_asked: it runs on a run the person started, and asks on any other.
 * - allow: it runs.
 * On both, writing to someone outside the known contacts asks first.
 * It cannot be turned off: the dot only ever sees the reviewed tool.
 */
export function reviewed<I>(action: Action<I>, review: Review): GloveFoldArgs<I> {
  const { recipient, handOff, rule = action.name, ...tool } = action;
  const level = levelFor(rule, review.rules);
  const described = { ...tool, description: `${tool.description} Rule: ${ruleLabel(rule, review.rules)}.` };

  if (level === "block") {
    return {
      ...described,
      do: async (input) => {
        const todo = handOff(input);
        // A failed record never turns a hand-off into something else.
        await review.handedOff?.(rule, todo).catch((cause: unknown) => console.error("Couldn't record the hand-off:", cause));
        return notRun(rule, `It stays with ${review.owner}. ${todo} ${review.tellPerson}`);
      },
    };
  }
  const asks = level === "ask" || (level === "when_asked" && !review.askedByPerson);
  // The instruction check: writing to someone the person never heard from always asks.
  const unknownRecipient = (input: I) =>
    recipient !== undefined && !review.contacts.includes(recipient(input).trim().toLowerCase());
  return {
    ...described,
    requiresPermission: asks ? true : unknownRecipient,
  };
}

function notRun(name: string, message: string): ToolResultData {
  return { status: "error", data: { ran: false, review: "block" }, message: `Auto-review: ${name} did not run. ${message}` };
}
