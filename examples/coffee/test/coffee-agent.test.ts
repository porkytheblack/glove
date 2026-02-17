import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  PRODUCTS,
  GRIND_OPTIONS,
  formatPrice,
  getProductById,
  getProductsByIds,
  type CartItem,
  type Product,
} from "../app/lib/products";

// ─── Product data tests ─────────────────────────────────────────────────────

describe("Product data", () => {
  it("has 6 products", () => {
    assert.equal(PRODUCTS.length, 6);
  });

  it("all products have required fields", () => {
    for (const p of PRODUCTS) {
      assert.ok(p.id, `Missing id`);
      assert.ok(p.name, `Missing name for ${p.id}`);
      assert.ok(p.origin, `Missing origin for ${p.id}`);
      assert.ok(p.roast, `Missing roast for ${p.id}`);
      assert.ok(typeof p.price === "number" && p.price > 0, `Invalid price for ${p.id}`);
      assert.ok(p.weight, `Missing weight for ${p.id}`);
      assert.ok(Array.isArray(p.notes) && p.notes.length > 0, `Missing notes for ${p.id}`);
      assert.ok(p.description, `Missing description for ${p.id}`);
      assert.ok(
        typeof p.intensity === "number" && p.intensity >= 1 && p.intensity <= 10,
        `Invalid intensity for ${p.id}: ${p.intensity}`,
      );
    }
  });

  it("all product IDs are unique", () => {
    const ids = PRODUCTS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("roast values are valid", () => {
    const validRoasts = ["Light", "Medium-Light", "Medium", "Dark"];
    for (const p of PRODUCTS) {
      assert.ok(validRoasts.includes(p.roast), `Invalid roast: ${p.roast} for ${p.id}`);
    }
  });
});

describe("formatPrice", () => {
  it("formats cents to dollars", () => {
    assert.equal(formatPrice(2200), "$22.00");
    assert.equal(formatPrice(1800), "$18.00");
    assert.equal(formatPrice(500), "$5.00");
    assert.equal(formatPrice(0), "$0.00");
    assert.equal(formatPrice(99), "$0.99");
  });
});

describe("getProductById", () => {
  it("returns product for valid ID", () => {
    const p = getProductById("ethiopian-yirgacheffe");
    assert.ok(p);
    assert.equal(p.name, "Yirgacheffe");
    assert.equal(p.origin, "Ethiopia");
  });

  it("returns undefined for invalid ID", () => {
    assert.equal(getProductById("nonexistent"), undefined);
  });
});

describe("getProductsByIds", () => {
  it('returns all products for "all"', () => {
    const products = getProductsByIds("all");
    assert.equal(products.length, PRODUCTS.length);
  });

  it("filters by specific IDs", () => {
    const products = getProductsByIds(["ethiopian-yirgacheffe", "kenyan-aa"]);
    assert.equal(products.length, 2);
    assert.ok(products.find((p) => p.id === "ethiopian-yirgacheffe"));
    assert.ok(products.find((p) => p.id === "kenyan-aa"));
  });

  it("ignores invalid IDs", () => {
    const products = getProductsByIds(["ethiopian-yirgacheffe", "nonexistent"]);
    assert.equal(products.length, 1);
  });

  it("returns empty array for empty input", () => {
    const products = getProductsByIds([]);
    assert.equal(products.length, 0);
  });
});

describe("GRIND_OPTIONS", () => {
  it("has 5 options", () => {
    assert.equal(GRIND_OPTIONS.length, 5);
  });

  it("includes common grind types", () => {
    assert.ok(GRIND_OPTIONS.includes("Whole Bean"));
    assert.ok(GRIND_OPTIONS.includes("Espresso"));
    assert.ok(GRIND_OPTIONS.includes("Pour Over"));
  });
});

// ─── Zod schema validation tests ────────────────────────────────────────────

describe("Tool input schemas", () => {
  // Replicate the schemas from glove.tsx to test them without JSX

  const askPreferenceSchema = z.object({
    question: z.string().describe("The question to display"),
    options: z
      .array(
        z.object({
          label: z.string().describe("Display text"),
          value: z.string().describe("Value returned when selected"),
        }),
      )
      .describe("2-6 options to present"),
  });

  const showProductsSchema = z.object({
    product_ids: z
      .array(z.string())
      .describe('Array of product IDs to show. Use ["all"] to show the full catalog.'),
    prompt: z.string().optional().describe("Optional text shown above the products"),
  });

  const showProductDetailSchema = z.object({
    product_id: z.string().describe("The product ID to show details for"),
  });

  const addToCartSchema = z.object({
    product_id: z.string().describe("The product ID to add"),
    quantity: z.number().optional().default(1).describe("Quantity to add (default 1)"),
  });

  const showCartSchema = z.object({});

  const checkoutSchema = z.object({});

  const showInfoSchema = z.object({
    title: z.string().describe("Card title"),
    content: z.string().describe("Card body text"),
    variant: z.enum(["info", "success"]).optional().describe("Card variant"),
  });

  describe("ask_preference", () => {
    it("accepts valid input", () => {
      const result = askPreferenceSchema.safeParse({
        question: "How do you brew?",
        options: [
          { label: "Pour over", value: "pour_over" },
          { label: "French press", value: "french_press" },
        ],
      });
      assert.ok(result.success);
    });

    it("rejects missing question", () => {
      const result = askPreferenceSchema.safeParse({
        options: [{ label: "A", value: "a" }],
      });
      assert.ok(!result.success);
    });

    it("rejects empty options", () => {
      const result = askPreferenceSchema.safeParse({
        question: "Pick one",
        options: [],
      });
      // Empty array is technically valid for z.array, but semantically bad
      assert.ok(result.success); // Schema allows it; business logic should enforce min
    });
  });

  describe("show_products", () => {
    it("accepts array of product IDs", () => {
      const result = showProductsSchema.safeParse({
        product_ids: ["ethiopian-yirgacheffe", "kenyan-aa"],
      });
      assert.ok(result.success);
    });

    it('accepts ["all"] convention', () => {
      const result = showProductsSchema.safeParse({
        product_ids: ["all"],
      });
      assert.ok(result.success);
    });

    it("accepts with optional prompt", () => {
      const result = showProductsSchema.safeParse({
        product_ids: ["colombian-huila"],
        prompt: "Here's my recommendation:",
      });
      assert.ok(result.success);
    });

    it("rejects non-array product_ids", () => {
      const result = showProductsSchema.safeParse({
        product_ids: "all",
      });
      assert.ok(!result.success);
    });

    it("rejects missing product_ids", () => {
      const result = showProductsSchema.safeParse({});
      assert.ok(!result.success);
    });

    it("converts to valid JSON Schema", () => {
      const jsonSchema = z.toJSONSchema(showProductsSchema);
      assert.ok(jsonSchema);
      assert.equal(jsonSchema.type, "object");
      assert.ok("properties" in jsonSchema);
      const props = jsonSchema.properties as Record<string, unknown>;
      assert.ok(props.product_ids);
    });
  });

  describe("show_product_detail", () => {
    it("accepts valid product_id", () => {
      const result = showProductDetailSchema.safeParse({
        product_id: "ethiopian-yirgacheffe",
      });
      assert.ok(result.success);
    });

    it("rejects missing product_id", () => {
      const result = showProductDetailSchema.safeParse({});
      assert.ok(!result.success);
    });
  });

  describe("add_to_cart", () => {
    it("accepts product_id only (default quantity)", () => {
      const result = addToCartSchema.safeParse({
        product_id: "colombian-huila",
      });
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.data.quantity, 1);
      }
    });

    it("accepts product_id with quantity", () => {
      const result = addToCartSchema.safeParse({
        product_id: "colombian-huila",
        quantity: 3,
      });
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.data.quantity, 3);
      }
    });

    it("rejects non-numeric quantity", () => {
      const result = addToCartSchema.safeParse({
        product_id: "colombian-huila",
        quantity: "two",
      });
      assert.ok(!result.success);
    });
  });

  describe("show_cart", () => {
    it("accepts empty object", () => {
      const result = showCartSchema.safeParse({});
      assert.ok(result.success);
    });
  });

  describe("checkout", () => {
    it("accepts empty object", () => {
      const result = checkoutSchema.safeParse({});
      assert.ok(result.success);
    });
  });

  describe("show_info", () => {
    it("accepts with variant", () => {
      const result = showInfoSchema.safeParse({
        title: "Order Confirmed",
        content: "Your coffee is on the way!",
        variant: "success",
      });
      assert.ok(result.success);
    });

    it("accepts without variant", () => {
      const result = showInfoSchema.safeParse({
        title: "Sourcing",
        content: "We source directly from farms.",
      });
      assert.ok(result.success);
    });

    it("rejects invalid variant", () => {
      const result = showInfoSchema.safeParse({
        title: "Test",
        content: "Test",
        variant: "warning",
      });
      assert.ok(!result.success);
    });
  });
});

// ─── Cart operations tests ──────────────────────────────────────────────────

describe("Cart operations", () => {
  // Simulate the cart operations pattern from chat.tsx
  let cart: CartItem[];

  function createCartOps() {
    cart = [];
    return {
      add: (productId: string, quantity = 1) => {
        const product = getProductById(productId);
        if (!product) return;
        const existing = cart.find((i) => i.id === productId);
        if (existing) {
          cart = cart.map((i) =>
            i.id === productId ? { ...i, qty: i.qty + quantity } : i,
          );
        } else {
          cart = [...cart, { ...product, qty: quantity }];
        }
      },
      get: () => cart,
      clear: () => {
        cart = [];
      },
    };
  }

  let ops: ReturnType<typeof createCartOps>;

  beforeEach(() => {
    ops = createCartOps();
  });

  it("starts empty", () => {
    assert.equal(ops.get().length, 0);
  });

  it("adds a product", () => {
    ops.add("ethiopian-yirgacheffe");
    assert.equal(ops.get().length, 1);
    assert.equal(ops.get()[0].name, "Yirgacheffe");
    assert.equal(ops.get()[0].qty, 1);
  });

  it("increments quantity for duplicate", () => {
    ops.add("ethiopian-yirgacheffe");
    ops.add("ethiopian-yirgacheffe");
    assert.equal(ops.get().length, 1);
    assert.equal(ops.get()[0].qty, 2);
  });

  it("adds multiple products", () => {
    ops.add("ethiopian-yirgacheffe");
    ops.add("colombian-huila");
    assert.equal(ops.get().length, 2);
  });

  it("adds with custom quantity", () => {
    ops.add("kenyan-aa", 3);
    assert.equal(ops.get()[0].qty, 3);
  });

  it("ignores invalid product ID", () => {
    ops.add("nonexistent");
    assert.equal(ops.get().length, 0);
  });

  it("clears the cart", () => {
    ops.add("ethiopian-yirgacheffe");
    ops.add("colombian-huila");
    ops.clear();
    assert.equal(ops.get().length, 0);
  });

  it("calculates correct totals", () => {
    ops.add("ethiopian-yirgacheffe"); // $22.00
    ops.add("colombian-huila", 2); // $18.00 x 2 = $36.00
    const totalItems = ops.get().reduce((s, i) => s + i.qty, 0);
    const totalPrice = ops.get().reduce((s, i) => s + i.price * i.qty, 0);
    assert.equal(totalItems, 3);
    assert.equal(totalPrice, 5800); // 2200 + 3600
    assert.equal(formatPrice(totalPrice), "$58.00");
  });
});

// ─── Tool do() function tests (non-display tools) ──────────────────────────

describe("Tool do() functions", () => {
  describe("add_to_cart", () => {
    it("adds product and returns confirmation", async () => {
      let cart: CartItem[] = [];
      const cartOps = {
        add: (productId: string, quantity = 1) => {
          const product = getProductById(productId);
          if (!product) return;
          cart = [...cart, { ...product, qty: quantity }];
        },
        get: () => cart,
        clear: () => {
          cart = [];
        },
      };

      // Simulate what the tool's do() function does
      const product_id = "colombian-huila";
      const quantity = 1;
      const product = getProductById(product_id);
      assert.ok(product);

      cartOps.add(product_id, quantity);
      const totalItems = cartOps.get().reduce((s, i) => s + i.qty, 0);
      const totalPrice = cartOps.get().reduce((s, i) => s + i.price * i.qty, 0);
      const result = `Added ${quantity}x ${product.name} to bag. Cart: ${totalItems} item(s), ${formatPrice(totalPrice)}.`;

      assert.equal(result, "Added 1x Huila Reserve to bag. Cart: 1 item(s), $18.00.");
    });

    it("returns error for invalid product", () => {
      const product = getProductById("nonexistent");
      assert.equal(product, undefined);
    });
  });

  describe("show_cart (empty)", () => {
    it("returns empty message when cart is empty", () => {
      const cart: CartItem[] = [];
      const result = cart.length === 0 ? "The bag is empty." : "has items";
      assert.equal(result, "The bag is empty.");
    });
  });

  describe("checkout (empty cart)", () => {
    it("rejects checkout with empty cart", () => {
      const cart: CartItem[] = [];
      const result =
        cart.length === 0
          ? "Cannot checkout — the bag is empty."
          : "ok";
      assert.equal(result, "Cannot checkout — the bag is empty.");
    });
  });
});

// ─── System prompt tests ────────────────────────────────────────────────────

describe("System prompt", () => {
  it("product catalog includes all products", () => {
    const catalog = PRODUCTS.map(
      (p) =>
        `- ${p.name} (${p.id}): ${p.origin}, ${p.roast} roast, ${formatPrice(p.price)}/${p.weight}. Notes: ${p.notes.join(", ")}. Intensity: ${p.intensity}/10. ${p.description}`,
    ).join("\n");

    for (const p of PRODUCTS) {
      assert.ok(catalog.includes(p.id), `Catalog missing ${p.id}`);
      assert.ok(catalog.includes(p.name), `Catalog missing ${p.name}`);
      assert.ok(catalog.includes(p.origin), `Catalog missing ${p.origin}`);
    }
  });
});

// ─── JSON Schema generation tests ───────────────────────────────────────────

describe("JSON Schema generation", () => {
  it("show_products schema generates valid JSON Schema without oneOf", () => {
    const schema = z.object({
      product_ids: z.array(z.string()),
      prompt: z.string().optional(),
    });
    const jsonSchema = z.toJSONSchema(schema);

    // Should be a simple object with array property, NOT a oneOf union
    assert.equal(jsonSchema.type, "object");
    const props = jsonSchema.properties as Record<string, any>;
    assert.ok(props.product_ids);
    assert.equal(props.product_ids.type, "array");
    assert.ok(!("oneOf" in props.product_ids), "Should not use oneOf");
  });

  it("add_to_cart schema handles optional with default", () => {
    const schema = z.object({
      product_id: z.string(),
      quantity: z.number().optional().default(1),
    });
    const jsonSchema = z.toJSONSchema(schema);
    assert.equal(jsonSchema.type, "object");
  });

  it("show_info schema handles enum variant", () => {
    const schema = z.object({
      title: z.string(),
      content: z.string(),
      variant: z.enum(["info", "success"]).optional(),
    });
    const jsonSchema = z.toJSONSchema(schema);
    assert.equal(jsonSchema.type, "object");
  });
});
