import { CodeBlock } from "@/components/code-block";

export default async function EcommerceStorePage() {
  return (
    <div className="docs-content">
      <h1>Build a Shopping Assistant</h1>

      <p>
        In this tutorial you will build an AI-powered shopping assistant where
        users describe what they need and the AI guides them through browsing,
        selecting variants, and checking out — all through interactive UI, not
        a wall of text.
      </p>

      <p>
        Ecommerce is inherently visual. Users browse product grids, pick sizes
        from dropdowns, and review their cart. A traditional chatbot forces all
        of this into plain text — &ldquo;We have 3 options: 1) Nike $129, 2)
        Adidas $189, 3) New Balance $134. Type a number.&rdquo; The display
        stack lets the AI show real product cards, real selectors, and real
        checkout forms.
      </p>

      <p>
        <strong>Prerequisites:</strong> You should have completed{" "}
        <a href="/docs/getting-started">Getting Started</a> and read{" "}
        <a href="/docs/display-stack">The Display Stack</a>.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>What you will build</h2>

      <p>
        A shopping assistant where a user can say &ldquo;I need running
        shoes&rdquo; and the app will:
      </p>

      <ol>
        <li>
          Fetch products from a server API and show them as clickable product
          cards (<code>pushAndWait</code>)
        </li>
        <li>
          Let the user pick size, color, and quantity through an interactive
          selector (<code>pushAndWait</code>)
        </li>
        <li>
          Show the running cart as a persistent card that updates as items are
          added (<code>pushAndForget</code>)
        </li>
        <li>
          Collect shipping information through a dynamic form
          (<code>pushAndWait</code>)
        </li>
        <li>
          Show a full order review and wait for confirmation before placing the
          order (<code>pushAndWait</code> + server call)
        </li>
      </ol>

      <p>
        Five tools, two server routes. The AI figures out the shopping flow at
        runtime — if a user says &ldquo;I need size 10 Nike running shoes,&rdquo;
        the AI can skip the browse step and go straight to the variant picker
        with the right product pre-selected.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Understanding the architecture</h2>

      <p>
        This app sits between the{" "}
        <a href="/docs/showcase/travel-planner">travel planner</a> (all
        client-side) and the{" "}
        <a href="/docs/showcase/coding-agent">coding agent</a> (heavy server
        use). The shopping assistant needs a server for two things: product data
        and order processing. Everything else — variant selection, cart display,
        checkout forms — runs in the browser.
      </p>

      <ul>
        <li>
          <strong><code>/api/products</code></strong> — returns product data by
          category. Called by the <code>browse_products</code> tool.
        </li>
        <li>
          <strong><code>/api/orders</code></strong> — places an order. Called by
          the <code>confirm_order</code> tool after the user confirms.
        </li>
        <li>
          <strong>Everything else</strong> — variant pickers, cart cards,
          shipping forms — is pure display stack running in the browser.
        </li>
      </ul>

      <p>
        The <code>do</code> function bridges both worlds. It runs in the browser,
        so it can call <code>display.pushAndWait()</code> for UI and{" "}
        <code>fetch()</code> for server data in the same function.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>1. Project setup</h2>

      <p>
        Start from a Next.js project with Glove installed:
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-core glove-react glove-next zod`}
      />

      <CodeBlock
        filename="app/api/chat/route.ts"
        language="typescript"
        code={`import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "openai",
  model: "gpt-4o-mini",
});`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>2. Server API routes</h2>

      <p>
        Two routes: one for product data, one for order processing.
      </p>

      <CodeBlock
        filename="app/api/products/route.ts"
        language="typescript"
        code={`import { NextResponse } from "next/server";

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  category: string;
  sizes: string[];
  colors: string[];
}

// In a real app this would be a database query
const PRODUCTS: Product[] = [
  {
    id: "nike-pegasus",
    name: "Nike Air Zoom Pegasus",
    price: 129,
    description: "Responsive cushioning for everyday runs",
    category: "running-shoes",
    sizes: ["8", "9", "10", "11", "12"],
    colors: ["Black", "White", "Blue"],
  },
  {
    id: "adidas-ultra",
    name: "Adidas Ultraboost",
    price: 189,
    description: "Energy-returning boost midsole",
    category: "running-shoes",
    sizes: ["8", "9", "10", "11"],
    colors: ["Black", "White", "Grey"],
  },
  {
    id: "nb-foam",
    name: "New Balance Fresh Foam X",
    price: 134,
    description: "Plush cushioning for long distances",
    category: "running-shoes",
    sizes: ["8", "9", "10", "11", "12", "13"],
    colors: ["Black", "Red", "Navy"],
  },
  {
    id: "asics-nimbus",
    name: "Asics Gel-Nimbus 26",
    price: 159,
    description: "Maximum cushion for neutral runners",
    category: "running-shoes",
    sizes: ["8", "9", "10", "11", "12"],
    colors: ["Black", "White", "Lime"],
  },
];

export async function POST(req: Request) {
  const { category } = await req.json();
  const results = PRODUCTS.filter((p) =>
    p.category.includes(category.toLowerCase().replace(/\\s+/g, "-")),
  );
  return NextResponse.json({ products: results });
}`}
      />

      <CodeBlock
        filename="app/api/orders/route.ts"
        language="typescript"
        code={`import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { items, shipping } = await req.json();

  // In a real app: validate, charge payment, create order
  const orderId = \`ORD-\${Date.now().toString(36).toUpperCase()}\`;
  const total = items.reduce(
    (sum: number, item: any) => sum + item.price * item.quantity,
    0,
  );

  return NextResponse.json({
    orderId,
    total,
    estimatedDelivery: "3-5 business days",
  });
}`}
      />

      <p>
        Simple routes with mock data. In production you would connect these to a
        database and payment processor.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>3. The product browser tool</h2>

      <p>
        This is the storefront. The AI calls it with a category, the tool
        fetches products from the server, and shows them as a grid of clickable
        cards. The user clicks one — the tool returns the full product data so
        the AI can move to variant selection.
      </p>

      <p>
        This is <code>pushAndWait</code> — the tool pauses until the user picks
        a product.
      </p>

      <CodeBlock
        filename="lib/tools/browse-products.tsx"
        language="tsx"
        code={`import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const browseProducts: ToolConfig = {
  name: "browse_products",
  description:
    "Search the product catalog by category and show results as " +
    "clickable cards. Blocks until the user selects a product. " +
    "Returns the selected product's full details (id, name, price, " +
    "sizes, colors).",
  inputSchema: z.object({
    category: z
      .string()
      .describe("Product category, e.g. 'running shoes', 'sneakers'"),
  }),

  async do(input, display) {
    // Fetch from server — product data lives server-side
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: input.category }),
    });
    const { products } = await res.json();

    if (!products.length) {
      return "No products found in that category.";
    }

    // Show product grid and wait for selection
    const selected = await display.pushAndWait({
      input: { products },
    });

    return JSON.stringify(selected);
  },

  render({ data, resolve }: SlotRenderProps) {
    const { products } = data as {
      products: {
        id: string;
        name: string;
        price: number;
        description: string;
        sizes: string[];
        colors: string[];
      }[];
    };
    return (
      <div style={{ padding: 16, border: "1px solid #262626", borderRadius: 12 }}>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
          {products.length} product{products.length !== 1 ? "s" : ""} found
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 10,
          }}
        >
          {products.map((product) => (
            <button
              key={product.id}
              onClick={() => resolve(product)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: 14,
                border: "1px solid #333",
                borderRadius: 10,
                background: "#0a0a0a",
                color: "#ededed",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div
                style={{
                  width: "100%",
                  aspectRatio: "1",
                  background: "#1a1a1a",
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                  marginBottom: 4,
                }}
              >
                👟
              </div>
              <strong style={{ fontSize: 13 }}>{product.name}</strong>
              <span style={{ fontSize: 12, color: "#888" }}>
                {product.description}
              </span>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#9ED4B8" }}>
                \${product.price}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  },
};`}
      />

      <p>
        The AI provides the category. The tool fetches products from the server,
        then shows a grid where each card is a button. When the user clicks a
        card, <code>resolve(product)</code> sends the full product object back
        to the <code>do</code> function, which returns it to the AI as JSON. The
        AI now knows the product name, price, available sizes, and colors — it
        has everything it needs to call <code>pick_variant</code> next.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>4. The variant picker tool</h2>

      <p>
        After the user picks a product, the AI calls this tool to let them
        choose size, color, and quantity. The AI passes in the available options
        based on the product data it got from <code>browse_products</code>.
      </p>

      <CodeBlock
        filename="lib/tools/pick-variant.tsx"
        language="tsx"
        code={`import { z } from "zod";
import { useState, useCallback } from "react";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const pickVariant: ToolConfig = {
  name: "pick_variant",
  description:
    "Show a size, color, and quantity selector for a product. " +
    "Blocks until the user confirms. Returns the selected variant.",
  inputSchema: z.object({
    productName: z.string().describe("Product name to display"),
    price: z.number().describe("Product price"),
    sizes: z.array(z.string()).describe("Available sizes"),
    colors: z.array(z.string()).describe("Available colors"),
  }),

  async do(input, display) {
    const variant = await display.pushAndWait({ input });
    return JSON.stringify(variant);
  },

  render({ data, resolve }: SlotRenderProps) {
    const { productName, price, sizes, colors } = data as {
      productName: string;
      price: number;
      sizes: string[];
      colors: string[];
    };

    const [size, setSize] = useState("");
    const [color, setColor] = useState("");
    const [qty, setQty] = useState(1);

    const canSubmit = size !== "" && color !== "";
    const handleSubmit = useCallback(() => {
      if (canSubmit) {
        resolve({ productName, price, size, color, quantity: qty });
      }
    }, [canSubmit, productName, price, size, color, qty, resolve]);

    return (
      <div style={{ padding: 16, border: "1px dashed #9ED4B8", borderRadius: 12 }}>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>{productName}</p>
        <p style={{ fontSize: 14, color: "#9ED4B8", marginBottom: 14 }}>
          \${price}
        </p>

        {/* Size */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, color: "#888", marginBottom: 6 }}>
            Size
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sizes.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                style={{
                  padding: "6px 14px",
                  border: size === s ? "1px solid #9ED4B8" : "1px solid #333",
                  borderRadius: 6,
                  background: size === s ? "rgba(158,212,184,0.1)" : "#0a0a0a",
                  color: size === s ? "#9ED4B8" : "#ededed",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Color */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, color: "#888", marginBottom: 6 }}>
            Color
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {colors.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  padding: "6px 14px",
                  border: color === c ? "1px solid #9ED4B8" : "1px solid #333",
                  borderRadius: 6,
                  background: color === c ? "rgba(158,212,184,0.1)" : "#0a0a0a",
                  color: color === c ? "#9ED4B8" : "#ededed",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Quantity */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, color: "#888", marginBottom: 6 }}>
            Quantity
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              style={{
                width: 32, height: 32, border: "1px solid #333",
                borderRadius: 6, background: "#0a0a0a", color: "#ededed",
                cursor: "pointer", fontSize: 16,
              }}
            >
              −
            </button>
            <span style={{ fontSize: 14, fontWeight: 600, minWidth: 24, textAlign: "center" }}>
              {qty}
            </span>
            <button
              onClick={() => setQty((q) => q + 1)}
              style={{
                width: 32, height: 32, border: "1px solid #333",
                borderRadius: 6, background: "#0a0a0a", color: "#ededed",
                cursor: "pointer", fontSize: 16,
              }}
            >
              +
            </button>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: "8px 20px",
            border: "none",
            borderRadius: 6,
            background: canSubmit ? "#9ED4B8" : "#333",
            color: "#0a0a0a",
            cursor: canSubmit ? "pointer" : "not-allowed",
            opacity: canSubmit ? 1 : 0.5,
            fontWeight: 600,
          }}
        >
          Add to Cart
        </button>
      </div>
    );
  },
};`}
      />

      <p>
        Notice the React state — <code>useState</code> for size, color, and
        quantity. The <code>render</code> function is a full React component.
        When the user clicks &ldquo;Add to Cart,&rdquo;{" "}
        <code>resolve()</code> sends the complete variant back to the{" "}
        <code>do</code> function, which returns it to the AI as JSON.
      </p>

      <p>
        This is entirely client-side — no server call needed. The AI already has
        the available sizes and colors from the previous{" "}
        <code>browse_products</code> call, so it passes them as tool arguments.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>5. The cart display tool</h2>

      <p>
        After adding an item, the AI shows the cart. This uses{" "}
        <code>pushAndForget</code> — the cart card appears and stays visible,
        but the tool does not wait. The AI can immediately ask
        &ldquo;Would you like to add anything else?&rdquo;
      </p>

      <CodeBlock
        filename="lib/tools/show-cart.tsx"
        language="tsx"
        code={`import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const showCart: ToolConfig = {
  name: "show_cart",
  description:
    "Display the current shopping cart as a persistent card. " +
    "Shows items, quantities, prices, and total. " +
    "Does not block — the AI can continue talking.",
  inputSchema: z.object({
    items: z
      .array(
        z.object({
          name: z.string(),
          size: z.string(),
          color: z.string(),
          quantity: z.number(),
          price: z.number(),
        }),
      )
      .describe("Cart items"),
  }),

  async do(input, display) {
    const subtotal = input.items.reduce(
      (sum: number, item: any) => sum + item.price * item.quantity,
      0,
    );
    await display.pushAndForget({
      input: { items: input.items, subtotal },
    });
    return \`Cart displayed. \${input.items.length} item(s), subtotal $\${subtotal}.\`;
  },

  render({ data }: SlotRenderProps) {
    const { items, subtotal } = data as {
      items: {
        name: string;
        size: string;
        color: string;
        quantity: number;
        price: number;
      }[];
      subtotal: number;
    };
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          borderLeft: "3px solid #9ED4B8",
          background: "#141414",
        }}
      >
        <p style={{ fontWeight: 600, marginBottom: 10 }}>
          🛒 Cart ({items.length} item{items.length !== 1 ? "s" : ""})
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 10px",
                borderRadius: 6,
                background: "#0a0a0a",
              }}
            >
              <div>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</span>
                <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>
                  {item.size} · {item.color} · Qty {item.quantity}
                </span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#9ED4B8" }}>
                \${item.price * item.quantity}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid #262626",
          }}
        >
          <span style={{ fontSize: 13, color: "#888" }}>Subtotal</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>\${subtotal}</span>
        </div>
      </div>
    );
  },
};`}
      />

      <p>
        The AI decides when to show the cart — typically after an item is added,
        but also whenever the user asks &ldquo;what&apos;s in my cart?&rdquo;
        Because the AI maintains the cart state in the conversation, it can
        rebuild the items array any time.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>6. The shipping form tool</h2>

      <p>
        When the user is ready to check out, the AI collects shipping info
        through a form. This is the same <code>pushAndWait</code> pattern as
        the travel planner&apos;s{" "}
        <a href="/docs/showcase/travel-planner">collect_form</a>, but with
        ecommerce-specific fields.
      </p>

      <CodeBlock
        filename="lib/tools/collect-shipping.tsx"
        language="tsx"
        code={`import { z } from "zod";
import { useState, useCallback } from "react";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const collectShipping: ToolConfig = {
  name: "collect_shipping",
  description:
    "Collect the user's shipping address. Blocks until they submit. " +
    "Returns the address data.",
  inputSchema: z.object({
    message: z
      .string()
      .optional()
      .describe("Optional message to display above the form"),
  }),

  async do(input, display) {
    const address = await display.pushAndWait({ input });
    return JSON.stringify(address);
  },

  render({ data, resolve }: SlotRenderProps) {
    const { message } = (data ?? {}) as { message?: string };

    const [form, setForm] = useState({
      name: "",
      email: "",
      address: "",
      city: "",
      zip: "",
    });

    const update = useCallback(
      (field: string, value: string) =>
        setForm((prev) => ({ ...prev, [field]: value })),
      [],
    );

    const canSubmit =
      form.name.trim() !== "" &&
      form.email.trim() !== "" &&
      form.address.trim() !== "" &&
      form.city.trim() !== "" &&
      form.zip.trim() !== "";

    const fields = [
      { key: "name", label: "Full Name", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "address", label: "Street Address", type: "text" },
      { key: "city", label: "City", type: "text" },
      { key: "zip", label: "ZIP Code", type: "text" },
    ];

    return (
      <div style={{ padding: 16, border: "1px dashed #9ED4B8", borderRadius: 12 }}>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>Shipping Address</p>
        {message && (
          <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>{message}</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {fields.map((f) => (
            <div key={f.key}>
              <label
                style={{ display: "block", fontSize: 12, color: "#888", marginBottom: 4 }}
              >
                {f.label} <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type={f.type}
                value={form[f.key as keyof typeof form]}
                onChange={(e) => update(f.key, e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #333",
                  borderRadius: 6,
                  background: "#0a0a0a",
                  color: "#ededed",
                  fontSize: 13,
                }}
              />
            </div>
          ))}
        </div>
        <button
          onClick={() => canSubmit && resolve(form)}
          disabled={!canSubmit}
          style={{
            marginTop: 14,
            padding: "8px 20px",
            border: "none",
            borderRadius: 6,
            background: canSubmit ? "#9ED4B8" : "#333",
            color: "#0a0a0a",
            cursor: canSubmit ? "pointer" : "not-allowed",
            opacity: canSubmit ? 1 : 0.5,
            fontWeight: 600,
          }}
        >
          Continue to Review
        </button>
      </div>
    );
  },
};`}
      />

      <p>
        The form is a regular React component with <code>useState</code>. All
        fields are required — the submit button stays disabled until everything
        is filled in. When the user submits, the full address object goes back
        to the AI.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>7. The order confirmation tool</h2>

      <p>
        The final gate. The AI assembles the full order — items, shipping
        address, total — and shows it for review. If the user confirms, the
        tool calls the server to place the order. This is the{" "}
        <a href="/docs/showcase/coding-agent">gate-execute-display</a> pattern:
        gate with <code>pushAndWait</code>, execute on the server, display the
        result with <code>pushAndForget</code>.
      </p>

      <CodeBlock
        filename="lib/tools/confirm-order.tsx"
        language="tsx"
        code={`import { z } from "zod";
import type { ToolConfig, SlotRenderProps } from "glove-react";

export const confirmOrder: ToolConfig = {
  name: "confirm_order",
  description:
    "Show the full order summary for review. Blocks until the user " +
    "confirms or cancels. If confirmed, places the order on the server.",
  inputSchema: z.object({
    items: z
      .array(
        z.object({
          name: z.string(),
          size: z.string(),
          color: z.string(),
          quantity: z.number(),
          price: z.number(),
        }),
      )
      .describe("Cart items"),
    shipping: z.object({
      name: z.string(),
      email: z.string(),
      address: z.string(),
      city: z.string(),
      zip: z.string(),
    }),
  }),

  async do(input, display) {
    const total = input.items.reduce(
      (sum: number, item: any) => sum + item.price * item.quantity,
      0,
    );

    // Gate: show review, wait for confirmation (browser)
    const confirmed = await display.pushAndWait({
      input: { items: input.items, shipping: input.shipping, total },
    });

    if (!confirmed) return "Order cancelled by user.";

    // Execute: place order on server
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: input.items,
        shipping: input.shipping,
      }),
    });
    const order = await res.json();

    // Display: show confirmation (browser)
    await display.pushAndForget({
      input: { ...order, phase: "confirmed" },
    });

    return \`Order placed! ID: \${order.orderId}, Total: $\${order.total}, Delivery: \${order.estimatedDelivery}\`;
  },

  render({ data, resolve }: SlotRenderProps) {
    const { phase } = data as { phase?: string };

    // Order confirmation card (pushAndForget — no resolve)
    if (phase === "confirmed") {
      const { orderId, total, estimatedDelivery } = data as {
        orderId: string;
        total: number;
        estimatedDelivery: string;
        phase: string;
      };
      return (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            borderLeft: "3px solid #22c55e",
            background: "#141414",
          }}
        >
          <p style={{ fontWeight: 600, color: "#22c55e", marginBottom: 8 }}>
            ✓ Order Confirmed
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, color: "#888" }}>
              Order ID: <span style={{ color: "#ededed" }}>{orderId}</span>
            </span>
            <span style={{ fontSize: 13, color: "#888" }}>
              Total: <span style={{ color: "#ededed" }}>\${total}</span>
            </span>
            <span style={{ fontSize: 13, color: "#888" }}>
              Delivery: <span style={{ color: "#ededed" }}>{estimatedDelivery}</span>
            </span>
          </div>
        </div>
      );
    }

    // Order review (pushAndWait — resolve is available)
    const { items, shipping, total } = data as {
      items: { name: string; size: string; color: string; quantity: number; price: number }[];
      shipping: { name: string; address: string; city: string; zip: string };
      total: number;
    };

    return (
      <div style={{ padding: 16, border: "1px dashed #f59e0b", borderRadius: 12 }}>
        <p style={{ fontWeight: 600, marginBottom: 12 }}>Review Your Order</p>

        {/* Items */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {items.map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 10px",
                borderRadius: 6,
                background: "#0a0a0a",
                fontSize: 13,
              }}
            >
              <span>
                {item.name}{" "}
                <span style={{ color: "#888" }}>
                  ({item.size}, {item.color}) × {item.quantity}
                </span>
              </span>
              <span style={{ fontWeight: 600 }}>
                \${item.price * item.quantity}
              </span>
            </div>
          ))}
        </div>

        {/* Shipping */}
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            background: "#0a0a0a",
            marginBottom: 12,
            fontSize: 12,
            color: "#888",
          }}
        >
          <p style={{ fontWeight: 500, color: "#ededed", marginBottom: 4 }}>Ship to</p>
          <p>{shipping.name}</p>
          <p>{shipping.address}</p>
          <p>{shipping.city}, {shipping.zip}</p>
        </div>

        {/* Total */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 10px",
            borderTop: "1px solid #262626",
            marginBottom: 12,
          }}
        >
          <span style={{ fontWeight: 600 }}>Total</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#9ED4B8" }}>
            \${total}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => resolve(true)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 6,
              background: "#22c55e",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Place Order
          </button>
          <button
            onClick={() => resolve(false)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 6,
              background: "#262626",
              color: "#888",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  },
};`}
      />

      <p>
        The <code>render</code> function handles two phases by checking{" "}
        <code>data.phase</code>. The order review uses <code>resolve</code> (the
        user must confirm or cancel). The confirmation card has no{" "}
        <code>resolve</code> — it is fire-and-forget. This is the same pattern
        the{" "}
        <a href="/docs/showcase/coding-agent">coding agent</a> uses for its
        command runner.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>8. Wire it together</h2>

      <CodeBlock
        filename="lib/glove.ts"
        language="typescript"
        code={`import { GloveClient } from "glove-react";
import { browseProducts } from "./tools/browse-products";
import { pickVariant } from "./tools/pick-variant";
import { showCart } from "./tools/show-cart";
import { collectShipping } from "./tools/collect-shipping";
import { confirmOrder } from "./tools/confirm-order";

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",

  systemPrompt: \`You are a helpful shopping assistant. You help users find
and purchase products through an interactive shopping experience.

Your workflow:
1. When a user describes what they want, use browse_products to show
   matching products. Let them click to select.
2. After they select a product, use pick_variant so they can choose
   size, color, and quantity.
3. After adding to cart, use show_cart to display the current cart.
   Ask if they want to add more items.
4. When the user is ready to check out, use collect_shipping to
   gather their address.
5. Finally, use confirm_order to show the full order review.
   Only place the order if they confirm.

Rules:
- Always show products visually — never list them as text.
- Keep track of all items the user has added across the conversation.
- If the user wants to change something, walk them through it.
- Be conversational but concise — the UI does the heavy lifting.\`,

  tools: [browseProducts, pickVariant, showCart, collectShipping, confirmOrder],
});`}
      />

      <p>
        The system prompt describes the workflow as a natural shopping flow. The
        AI follows this, but it adapts — if a user says &ldquo;Add size 10
        black Nike Pegasus to my cart,&rdquo; the AI can skip the browse step
        and go straight to confirming the variant.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>9. Build the chat UI</h2>

      <CodeBlock
        filename="app/page.tsx"
        language="tsx"
        code={`"use client";

import { useState } from "react";
import { useGlove } from "glove-react";

export default function ShoppingAssistant() {
  const {
    timeline,
    streamingText,
    busy,
    sendMessage,
    slots,
    renderSlot,
  } = useGlove();
  const [input, setInput] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    sendMessage(input.trim());
    setInput("");
  }

  return (
    <div style={{ maxWidth: 640, margin: "2rem auto" }}>
      <h1>Shopping Assistant</h1>

      <div>
        {timeline.map((entry, i) => {
          if (entry.kind === "user")
            return <div key={i} style={{ margin: "1rem 0" }}><strong>You:</strong> {entry.text}</div>;
          if (entry.kind === "agent_text")
            return <div key={i} style={{ margin: "1rem 0" }}><strong>Shop:</strong> {entry.text}</div>;
          if (entry.kind === "tool")
            return (
              <div key={i} style={{ margin: "0.5rem 0", fontSize: "0.85rem", color: "#888" }}>
                {entry.name} — {entry.status}
              </div>
            );
          return null;
        })}
      </div>

      {streamingText && (
        <div style={{ opacity: 0.7 }}><strong>Shop:</strong> {streamingText}</div>
      )}

      {/* Display stack — product grids, variant pickers, cart, forms, reviews */}
      {slots.length > 0 && (
        <div style={{ margin: "1rem 0", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {slots.map(renderSlot)}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What are you looking for?"
          disabled={busy}
          style={{ flex: 1, padding: "0.5rem" }}
        />
        <button type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>10. Run it</h2>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm dev`}
      />

      <p>Try these conversations:</p>

      <ul>
        <li>
          <strong>&ldquo;I need running shoes&rdquo;</strong> — a product grid
          appears, click to select, choose size and color, see the cart
        </li>
        <li>
          <strong>&ldquo;Add another pair in a different color&rdquo;</strong>{" "}
          — the AI calls <code>pick_variant</code> again with the same product,
          then updates the cart
        </li>
        <li>
          <strong>&ldquo;Let&apos;s check out&rdquo;</strong> — shipping form
          appears, then a full order review with Place Order / Cancel
        </li>
        <li>
          <strong>&ldquo;Actually, remove the second pair&rdquo;</strong> — the
          AI updates the cart and shows the revised total
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>Chatbot vs. display stack</h2>

      <p>
        Compare the same shopping flow in a traditional chatbot:
      </p>

      <ol>
        <li>AI: &ldquo;I found 4 running shoes: 1) Nike Pegasus $129, 2) Adidas
          Ultraboost $189, 3) New Balance Fresh Foam $134, 4) Asics Nimbus $159.
          Which one?&rdquo;</li>
        <li>User types: &ldquo;2&rdquo;</li>
        <li>AI: &ldquo;What size? Available: 8, 9, 10, 11&rdquo;</li>
        <li>User types: &ldquo;10&rdquo;</li>
        <li>AI: &ldquo;What color? Black, White, Grey&rdquo;</li>
        <li>User types: &ldquo;black&rdquo;</li>
        <li>AI: &ldquo;Added. Your cart: 1x Adidas Ultraboost ($189). Ready to
          check out?&rdquo;</li>
        <li>User types: &ldquo;yes&rdquo;</li>
      </ol>

      <p>With the display stack:</p>

      <ol>
        <li>
          AI calls <code>browse_products</code> — a product grid with images
          and prices. User clicks the Adidas card.
        </li>
        <li>
          AI calls <code>pick_variant</code> — size buttons, color buttons,
          quantity stepper. User picks 10/Black/1 and clicks Add to Cart.
        </li>
        <li>
          AI calls <code>show_cart</code> — a styled cart card with line items
          and a running total.
        </li>
        <li>
          AI calls <code>collect_shipping</code> — a shipping form. User fills
          in and submits.
        </li>
        <li>
          AI calls <code>confirm_order</code> — a full order review with items,
          address, and total. User clicks Place Order.
        </li>
      </ol>

      <p>
        Same flow, but every step is a real UI component instead of text
        parsing. The user never types &ldquo;2&rdquo; or &ldquo;10&rdquo; or
        &ldquo;yes.&rdquo; They click, select, fill, and confirm.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Where each piece runs</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Piece</th>
            <th>Where</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>createChatHandler</code></td>
            <td>Server</td>
            <td>LLM proxy — sends tool schemas, streams responses</td>
          </tr>
          <tr>
            <td>Tool <code>do</code> functions</td>
            <td>Browser</td>
            <td>Called by <code>useGlove</code> when AI requests a tool</td>
          </tr>
          <tr>
            <td><code>/api/products</code></td>
            <td>Server</td>
            <td>Product catalog (database query in production)</td>
          </tr>
          <tr>
            <td><code>/api/orders</code></td>
            <td>Server</td>
            <td>Order processing (payment + fulfillment)</td>
          </tr>
          <tr>
            <td>Display stack</td>
            <td>Browser</td>
            <td>Product grids, variant pickers, cart cards, forms</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Display patterns used</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Pattern</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>browse_products</code></td>
            <td><code>pushAndWait</code></td>
            <td>AI needs to know which product was selected</td>
          </tr>
          <tr>
            <td><code>pick_variant</code></td>
            <td><code>pushAndWait</code></td>
            <td>AI needs size, color, and quantity before adding to cart</td>
          </tr>
          <tr>
            <td><code>show_cart</code></td>
            <td><code>pushAndForget</code></td>
            <td>Cart is informational — AI can keep talking</td>
          </tr>
          <tr>
            <td><code>collect_shipping</code></td>
            <td><code>pushAndWait</code></td>
            <td>AI needs address data before placing order</td>
          </tr>
          <tr>
            <td><code>confirm_order</code></td>
            <td>Both</td>
            <td><code>pushAndWait</code> for review, <code>pushAndForget</code> for confirmation card</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Next steps</h2>

      <ul>
        <li>
          <a href="/docs/showcase/travel-planner">Build a Travel Planner</a>{" "}
          — see progressive preference gathering with all client-side tools
        </li>
        <li>
          <a href="/docs/showcase/coding-agent">Build a Coding Agent</a>{" "}
          — see the gate-execute-display pattern for server mutations
        </li>
        <li>
          <a href="/docs/showcase/terminal-agent">Build a Terminal Agent</a>{" "}
          — use <code>glove-core</code> directly without React or Next.js
        </li>
        <li>
          <a href="/docs/display-stack">The Display Stack</a> — deep dive into{" "}
          <code>pushAndWait</code> and <code>pushAndForget</code>
        </li>
        <li>
          <a href="/docs/react">React API Reference</a> — full API for{" "}
          <code>useGlove</code>, <code>ToolConfig</code>, and{" "}
          <code>SlotRenderProps</code>
        </li>
      </ul>
    </div>
  );
}
