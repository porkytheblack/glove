import { totals, type Bag, type BagLine } from "../../lib/bag";
import { getProductById } from "../../lib/catalog";

export interface BagView extends Bag {
  count: number;
  subtotal: number;
  shipping: number;
  total: number;
}

export function viewBag(bag: Bag): BagView {
  return { ...bag, ...totals(bag) };
}

export interface LineView {
  key: string;
  name: string;
  meta: string;
  qty: number;
  price: number;
  for?: string;
}

export function describeLines(lines: readonly BagLine[]): LineView[] {
  return lines.map((line) => {
    const product = getProductById(line.productId);
    return {
      key: `${line.productId}:${line.for ?? ""}`,
      name: product?.name ?? line.productId,
      meta: product ? `${product.origin} · ${product.weight}` : "",
      qty: line.qty,
      price: (product?.price ?? 0) * line.qty,
      ...(line.for ? { for: line.for } : {}),
    };
  });
}
