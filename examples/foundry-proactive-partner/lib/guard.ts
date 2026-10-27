import { jev, noul } from "glove-classifier";

/**
 * Checks everything the partner sends to someone, in two tiers.
 * - Strict: payment card numbers and government ID numbers never leave, even
 *   if the person asks. Caught in code, so the check is sure and free.
 * - Sensitive: health and personal-finance details leave only when the person
 *   explicitly asked. Judged by a classifier, so it needs TYPESAFE_API_KEY;
 *   without one only the strict tier runs.
 */

/** Digit runs of 13–19, with spaces or dashes, that pass the Luhn check. */
export function cardNumberIn(text: string): string | undefined {
  for (const match of text.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (luhn(digits)) return match[0];
  }
  return undefined;
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

/** A US Social Security number written the usual way. Add your country's IDs. */
export function governmentIdIn(text: string): string | undefined {
  return /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/.exec(text)?.[0];
}

/** The strict tier: true when the text may not leave, whoever asked. */
export function strictlyBlocked(text: string): boolean {
  return Boolean(cardNumberIn(text) || governmentIdIn(text));
}

const classifier = process.env.TYPESAFE_API_KEY ? jev() : undefined;

/**
 * Why this text must not go out, or undefined when it may. `request` is the
 * person's own message, when there is one, to tell whether they asked.
 */
export async function blockedBecause(text: string, request?: string): Promise<string | undefined> {
  if (cardNumberIn(text)) return "it contains a payment card number";
  if (governmentIdIn(text)) return "it contains a government ID number";
  if (!classifier) return undefined;
  const { answers } = await classifier.classify({
    state: { message: text, request: request ?? "" },
    questions: {
      sensitive: noul("Does the message share someone's health details or personal finances?"),
      asked: noul("Did the request explicitly ask to share those details in this message?"),
    },
  });
  return answers.sensitive.noul > 0.8 && answers.asked.noul < 0.5
    ? "it shares health or money details they did not ask to share"
    : undefined;
}
