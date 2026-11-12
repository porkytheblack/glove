import { getProductById, formatPrice } from "./catalog.js";

// A conversation's bag and its placed orders live in the shop's workspace,
// in one entry, so a run (a fresh process every message) and the web app read
// the same thing, and placing an order and emptying the bag is one write.

export interface BagLine {
  readonly productId: string;
  readonly qty: number;
  /** Who it is for, when several people are ordering together. */
  readonly for?: string;
}

export interface Bag {
  readonly lines: readonly BagLine[];
}

export interface Order {
  readonly id: string;
  readonly lines: readonly BagLine[];
  readonly subtotal: number;
  readonly shipping: number;
  readonly total: number;
  readonly grind: string;
  readonly name?: string;
  readonly email?: string;
  readonly placedAt: string;
}

/** Everything the shop keeps for one customer conversation. */
export interface Visit {
  readonly bag: Bag;
  readonly orders: readonly Order[];
}

export const EMPTY_BAG: Bag = { lines: [] };
export const EMPTY_VISIT: Visit = { bag: EMPTY_BAG, orders: [] };
export const visitKey = (conversationId: string): string => `visit:${conversationId}`;

const sameLine = (line: BagLine, productId: string, who?: string): boolean =>
  line.productId === productId && (line.for ?? "") === (who ?? "");

export function addLine(bag: Bag, productId: string, qty: number, who?: string): Bag {
  const found = bag.lines.some((line) => sameLine(line, productId, who));
  const lines = found
    ? bag.lines.map((line) => (sameLine(line, productId, who) ? { ...line, qty: line.qty + qty } : line))
    : [...bag.lines, { productId, qty, ...(who ? { for: who } : {}) }];
  return { lines };
}

/** Remove `qty` of a product (all of it when `qty` is left out). With no `who`, any line of that product. */
export function removeLine(bag: Bag, productId: string, qty?: number, who?: string): Bag {
  let left = qty ?? Number.POSITIVE_INFINITY;
  const lines: BagLine[] = [];
  for (const line of bag.lines) {
    const match = line.productId === productId && (who === undefined || (line.for ?? "") === who);
    if (!match || left <= 0) {
      lines.push(line);
      continue;
    }
    const take = Math.min(line.qty, left);
    left -= take;
    if (line.qty > take) lines.push({ ...line, qty: line.qty - take });
  }
  return { lines };
}

/**
 * The same coffees, in the same quantities, for the same people. Totals are
 * not enough to tell bags apart: two different pairs of coffees can cost the
 * same.
 */
export function sameBag(a: Bag, b: Bag): boolean {
  const key = (bag: Bag) =>
    bag.lines
      .map((line) => JSON.stringify([line.productId, line.qty, line.for ?? ""]))
      .sort()
      .join("|");
  return key(a) === key(b);
}

export function totals(bag: Bag): { count: number; subtotal: number; shipping: number; total: number } {
  let count = 0;
  let subtotal = 0;
  for (const line of bag.lines) {
    count += line.qty;
    subtotal += (getProductById(line.productId)?.price ?? 0) * line.qty;
  }
  // Free shipping over $40, as in the original coffee example.
  const shipping = subtotal === 0 || subtotal > 4000 ? 0 : 500;
  return { count, subtotal, shipping, total: subtotal + shipping };
}

/** The bag as the model reads it. */
export function describeBag(bag: Bag): string {
  if (bag.lines.length === 0) return "The bag is empty.";
  const { subtotal, shipping, total } = totals(bag);
  const lines = bag.lines.map((line) => {
    const product = getProductById(line.productId);
    const who = line.for ? ` (for ${line.for})` : "";
    return `- ${line.qty} x ${product?.name ?? line.productId}${who}: ${formatPrice((product?.price ?? 0) * line.qty)}`;
  });
  return [
    ...lines,
    `Subtotal ${formatPrice(subtotal)}, shipping ${shipping === 0 ? "free" : formatPrice(shipping)}, total ${formatPrice(total)}.`,
  ].join("\n");
}
