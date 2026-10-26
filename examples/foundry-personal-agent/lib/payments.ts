import { randomInt } from "node:crypto";
import type { Browsers } from "@kuiper-sh/sdk";
import { chromium } from "playwright-core";
import { identify } from "./kuiper.js";
import { record } from "./ledger.js";

// Paying for things. Muse never holds the person's card, and its model never
// sees a card number. buy asks a card issuer for a one-time card for exactly
// this merchant and amount. Then this code, not Muse, types it into the
// checkout open in Muse's browser, in a tab Muse never sees, and submits it.
// Meta uses Link by Stripe for this; any issuer of single-use virtual cards
// fits (Stripe Issuing, Lithic, ...).
//
// This example ships only a stand-in issuer, for `pnpm verify`. Put yours in
// `issuer()`; until then buy says there is no way to pay.

export interface Purchase {
  readonly merchant: string;
  /** The checkout's host, like fresh-market.example. */
  readonly site: string;
  readonly items: ReadonlyArray<string>;
  readonly amountCents: number;
}

/** A card valid for one charge, at one merchant, up to one amount. */
export interface OneTimeCard {
  readonly number: string;
  /** MM/YY */
  readonly expiry: string;
  readonly cvc: string;
}

export interface CardIssuer {
  issue(person: string, purchase: Purchase): Promise<OneTimeCard>;
}

/** Made-up digits, for the sample checkout only. */
const standIn: CardIssuer = {
  async issue() {
    const digits = Array.from({ length: 12 }, () => randomInt(10)).join("");
    return { number: `4000${digits}`, expiry: "12/29", cvc: String(randomInt(100, 1000)) };
  },
};

export function issuer(): CardIssuer | undefined {
  // your code: return your issuer here.
  return process.env.MUSE_DEMO === "1" ? standIn : undefined;
}

/**
 * Types the card into the checkout open in the browser and submits it, in a
 * new tab that closes afterwards, so no page Muse can look at, now or by
 * going back, holds the number. The Sentinel still guards the tab's requests.
 * Card fields are found by their standard autocomplete names; a checkout that
 * keeps them in its payment provider's frame needs that frame's locator here.
 */
export async function payAtCheckout(browsers: Pick<Browsers, "get">, sessionId: string, purchase: Purchase, card: OneTimeCard): Promise<{ readonly url: string; readonly page: string }> {
  const session = await browsers.get(sessionId);
  const browser = await chromium.connectOverCDP(session.websocketUrl, { timeout: 60_000 });
  try {
    const name = await identify(browser);
    const context = browser.contexts()[0];
    const checkout = context?.pages().at(-1)?.url();
    if (!context || !checkout || new URL(checkout).host !== purchase.site) {
      throw new Error(`Open ${purchase.site}'s checkout in the browser first.`);
    }
    const tab = await context.newPage();
    try {
      await name(tab);
      await tab.goto(checkout, { waitUntil: "domcontentloaded" });
      const field = (name: string) => tab.locator(`input[autocomplete="${name}"]`).first();
      await field("cc-number").fill(card.number);
      await field("cc-exp").fill(card.expiry);
      await field("cc-csc").fill(card.cvc);
      await field("cc-number").press("Enter");
      await tab.waitForURL((url) => url.href !== checkout, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return { url: tab.url(), page: (await tab.locator("body").innerText()).slice(0, 2000) };
    } finally {
      await tab.close();
    }
  } finally {
    // Disconnects; the browser stays Muse's.
    await browser.close();
  }
}

export async function recordPurchase(person: string, purchase: Purchase, card: OneTimeCard): Promise<string> {
  const cardLast4 = card.number.slice(-4);
  await record({ kind: "purchase", person, ...purchase, cardLast4 });
  return cardLast4;
}
