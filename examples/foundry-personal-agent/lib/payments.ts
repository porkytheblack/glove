import { randomInt } from "node:crypto";
import { record } from "./ledger.js";

// Paying for things. Muse never holds the person's card: the buy tool asks
// your payment provider for a one-time card for exactly this merchant and
// amount, pays with it, and keeps only its last four digits. Meta uses Link by
// Stripe for this; any provider that issues single-use virtual cards fits.
// Offline, the card is made up and the purchase goes to the ledger.

export interface Purchase {
  readonly merchant: string;
  readonly items: ReadonlyArray<string>;
  readonly amountCents: number;
}

export interface Receipt {
  readonly orderId: string;
  readonly cardLast4: string;
}

/** A card valid for one charge, at one merchant, up to one amount. */
async function oneTimeCard(_person: string, purchase: Purchase): Promise<{ readonly number: string; readonly limitCents: number }> {
  const digits = Array.from({ length: 12 }, () => randomInt(10)).join("");
  return { number: `4000${digits}`, limitCents: purchase.amountCents };
}

export async function pay(person: string, purchase: Purchase): Promise<Receipt> {
  const card = await oneTimeCard(person, purchase);
  // your code: the merchant's checkout, with card.number. It never leaves this function.
  const orderId = `order-${Date.now().toString(36)}`;
  const cardLast4 = card.number.slice(-4);
  await record({ kind: "purchase", person, ...purchase, orderId, cardLast4 });
  return { orderId, cardLast4 };
}
