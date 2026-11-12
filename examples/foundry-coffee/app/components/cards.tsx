import React from "react";
import { describeLines, type BagView } from "../lib/bag-view";
import { formatPrice, getProductById, getProductsByIds, type Product } from "../../lib/catalog";
import type { Entry } from "../lib/use-shop";

// What the barista's tool calls look like on the customer's screen. The
// tools run in Foundry; these are drawn from each call's input as its run
// event arrives.

function IntensityBar({ level }: { level: number }) {
  return (
    <div className="intensity">
      {Array.from({ length: 10 }).map((_, i) => (
        <span key={i} className={i < level ? "intensity-on" : ""} />
      ))}
    </div>
  );
}

const roastClass = (product: Product) =>
  product.roast === "Dark" ? "roast-dark" : product.roast === "Medium" ? "roast-medium" : "roast-light";

export function ProductCard({ product, onAsk, onAdd, disabled }: {
  product: Product;
  onAsk: () => void;
  onAdd: () => void;
  disabled: boolean;
}) {
  const soldOut = product.stock <= 0;
  return (
    <div className="product-card">
      <div className={`product-card-top ${roastClass(product)}`}>
        <span>{product.origin}</span>
        {soldOut && <span className="product-card-soldout">Sold out</span>}
      </div>
      <div className="product-card-body">
        <div className="product-card-title">
          <h3>{product.name}</h3>
          <span>{formatPrice(product.price)}</span>
        </div>
        <div className="product-card-notes">
          {product.notes.map((note) => <span key={note}>{note}</span>)}
        </div>
        <div className="product-card-intensity">
          <div><span>Intensity</span><span>{product.roast}</span></div>
          <IntensityBar level={product.intensity} />
        </div>
        <div className="product-card-actions">
          <button type="button" onClick={onAsk} disabled={disabled}>Details</button>
          <button type="button" className="primary" onClick={onAdd} disabled={disabled || soldOut}>Add to bag</button>
        </div>
      </div>
    </div>
  );
}

function ProductDetail({ product, onAdd, disabled }: { product: Product; onAdd: () => void; disabled: boolean }) {
  return (
    <div className="product-detail">
      <div className={`product-detail-side ${roastClass(product)}`}>
        <span>{product.origin}</span>
        <strong>{product.roast}</strong>
      </div>
      <div className="product-detail-body">
        <div className="product-card-title">
          <h3>{product.name}</h3>
          <span>{formatPrice(product.price)} / {product.weight}</span>
        </div>
        <p>{product.description}</p>
        <div className="product-card-notes">
          {product.notes.map((note) => <span key={note}>{note}</span>)}
        </div>
        <div className="product-card-intensity">
          <div><span>Intensity</span><span>{product.stock > 0 ? `${product.stock} in stock` : "Sold out"}</span></div>
          <IntensityBar level={product.intensity} />
        </div>
        <div className="product-card-actions">
          <button type="button" className="primary" onClick={onAdd} disabled={disabled || product.stock <= 0}>Add to bag</button>
        </div>
      </div>
    </div>
  );
}

const input = (entry: Extract<Entry, { kind: "tool" }>) => (entry.input ?? {}) as Record<string, unknown>;

/** One tool call. Calls that show something get a card; the rest get a line. */
export function ToolCard({ entry, onSay, disabled }: {
  entry: Extract<Entry, { kind: "tool" }>;
  onSay: (text: string) => void;
  disabled: boolean;
}) {
  const args = input(entry);

  if (entry.name === "show_products" && entry.status !== "error") {
    const ids = Array.isArray(args.product_ids) ? (args.product_ids as string[]) : [];
    const products = getProductsByIds(ids.includes("all") ? "all" : ids);
    return (
      <div className="card-block">
        {typeof args.note === "string" && args.note && <p className="card-note">{args.note}</p>}
        <div className="product-row">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              disabled={disabled}
              onAsk={() => onSay(`Tell me about the ${product.name}`)}
              onAdd={() => onSay(`Add the ${product.name} to my bag`)}
            />
          ))}
        </div>
      </div>
    );
  }

  if (entry.name === "show_product_detail" && entry.status !== "error") {
    const product = getProductById(String(args.product_id ?? ""));
    if (product) {
      return (
        <div className="card-block">
          <ProductDetail product={product} disabled={disabled} onAdd={() => onSay(`Add the ${product.name} to my bag`)} />
        </div>
      );
    }
  }

  if (entry.name === "show_info" && entry.status !== "error") {
    const variant = typeof args.variant === "string" ? args.variant : "info";
    return (
      <div className="card-block">
        <div className={`info-card info-card--${variant}`}>
          <span className="info-card-kind">{variant === "success" ? "Confirmed" : variant === "tip" ? "Brewing tip" : "Good to know"}</span>
          <h3>{String(args.title ?? "")}</h3>
          <p>{String(args.body ?? "")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tool-entry">
      <div className={`tool-badge ${entry.status === "done" ? "success" : entry.status}`}>
        {entry.status === "running" ? "..." : entry.status === "done" ? "ok" : "err"}
      </div>
      <span className="tool-name">{entry.name}</span>
      <span className="tool-output">{entry.message ?? toolSummary(entry.name, args)}</span>
    </div>
  );
}

function toolSummary(name: string, args: Record<string, unknown>): string {
  const product = getProductById(String(args.product_id ?? ""));
  const who = typeof args.for === "string" && args.for ? ` for ${args.for}` : "";
  if (name === "add_to_cart") return `${args.quantity ?? 1} x ${product?.name ?? args.product_id}${who}`;
  if (name === "remove_from_cart") return `${product?.name ?? args.product_id}${who}`;
  if (name === "name_speaker") return `${args.speaker} is ${args.name}`;
  if (name === "checkout") return `${args.grind ?? ""}`;
  return "";
}

const SETTLED: Record<string, string> = {
  // Their answer, not the outcome: the checkout tool's result says whether the order was placed.
  approved: "You confirmed",
  denied: "Not placed: you said not yet",
  cancelled: "Not placed: the checkout was cancelled",
  expired: "Not placed: the checkout timed out",
};

/** A checkout waiting for the customer. Foundry holds the run until they answer. */
export function ApprovalCard({ entry, bag, onDecide }: {
  entry: Extract<Entry, { kind: "approval" }>;
  bag: BagView;
  onDecide: (decision: "approve" | "deny") => void;
}) {
  const args = (entry.input ?? {}) as Record<string, unknown>;
  const pending = entry.status === "pending";
  return (
    <div className="card-block">
      <div className={`approval-card ${pending ? "" : "approval-card--settled"}`}>
        <span className="info-card-kind">{pending ? "Confirm your order" : SETTLED[entry.status] ?? `Checkout ${entry.status}`}</span>
        {pending && (
          <>
            <div className="approval-lines">
              {describeLines(bag.lines).map((line) => (
                <div key={line.key} className="approval-line">
                  <span>{line.qty} x {line.name}{line.for ? <em> for {line.for}</em> : null}</span>
                  <span>{formatPrice(line.price)}</span>
                </div>
              ))}
            </div>
            <div className="approval-line approval-total">
              <span>Total{bag.shipping === 0 ? " (free shipping)" : ` (incl. ${formatPrice(bag.shipping)} shipping)`}</span>
              <span>{formatPrice(bag.total)}</span>
            </div>
            <p className="approval-meta">
              {String(args.grind ?? "")} grind{args.name ? ` · for ${String(args.name)}` : ""}{args.email ? ` · ${String(args.email)}` : ""}
            </p>
            <div className="product-card-actions">
              <button type="button" onClick={() => onDecide("deny")}>Not yet</button>
              <button type="button" className="primary" onClick={() => onDecide("approve")}>Place order</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
