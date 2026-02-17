import { useState, useRef, useEffect, useCallback } from "react";

const SAGE = {
  50: "#f0f4f0",
  100: "#dce5dc",
  200: "#b8cab8",
  300: "#8fa88f",
  400: "#6b8a6b",
  500: "#4a6b4a",
  600: "#3d5a3d",
  700: "#2d422d",
  800: "#1e2e1e",
  900: "#111a11",
  950: "#0a100a",
};

const CREAM = {
  50: "#fefdfb",
  100: "#faf7f2",
  200: "#f2ebe0",
  300: "#e8dcc8",
};

const PRODUCTS = [
  {
    id: "ethiopian-yirgacheffe",
    name: "Yirgacheffe",
    origin: "Ethiopia",
    roast: "Light",
    price: 2200,
    weight: "250g",
    notes: ["Jasmine", "Bergamot", "Honey"],
    description: "Bright and floral with a clean, tea-like body. Grown at 1,900m in the Gedeo zone.",
    intensity: 3,
  },
  {
    id: "colombian-huila",
    name: "Huila Reserve",
    origin: "Colombia",
    roast: "Medium",
    price: 1800,
    weight: "250g",
    notes: ["Caramel", "Red Apple", "Chocolate"],
    description: "Balanced sweetness with a silky mouthfeel. Washed process from smallholder farms.",
    intensity: 5,
  },
  {
    id: "kenyan-aa",
    name: "Nyeri AA",
    origin: "Kenya",
    roast: "Medium-Light",
    price: 2600,
    weight: "250g",
    notes: ["Blackcurrant", "Grapefruit", "Brown Sugar"],
    description: "Complex and vibrant. Double-washed SL28 varietal from the slopes of Mt. Kenya.",
    intensity: 4,
  },
  {
    id: "sumatra-mandheling",
    name: "Mandheling",
    origin: "Sumatra",
    roast: "Dark",
    price: 1900,
    weight: "250g",
    notes: ["Dark Chocolate", "Cedar", "Tobacco"],
    description: "Earthy and full-bodied with low acidity. Wet-hulled in the Batak highlands.",
    intensity: 8,
  },
  {
    id: "guatemala-antigua",
    name: "Antigua",
    origin: "Guatemala",
    roast: "Medium",
    price: 2000,
    weight: "250g",
    notes: ["Cocoa", "Spice", "Orange Peel"],
    description: "Rich and smoky with volcanic terroir. Grown in nutrient-dense pumice soil.",
    intensity: 6,
  },
  {
    id: "rwanda-kivu",
    name: "Lake Kivu",
    origin: "Rwanda",
    roast: "Light",
    price: 2400,
    weight: "250g",
    notes: ["Peach", "Vanilla", "Lime"],
    description: "Delicate and fruit-forward. Fully washed Bourbon from cooperative farms.",
    intensity: 2,
  },
];

const GRIND_OPTIONS = ["Whole Bean", "French Press", "Pour Over", "Espresso", "Aeropress"];

const formatPrice = (cents) => `$${(cents / 100).toFixed(2)}`;

const CONVERSATIONS = {
  greeting: {
    text: "Welcome to Glove Coffee. I'm here to help you find your perfect cup. What are you in the mood for today?",
    options: [
      { label: "Browse all beans", action: "browse" },
      { label: "Help me choose", action: "recommend" },
      { label: "Something light & fruity", action: "light" },
      { label: "Something bold & rich", action: "bold" },
    ],
  },
  browse: {
    text: "Here's our current selection — each sourced directly from origin. Tap any bag to learn more.",
    showProducts: "all",
    options: [
      { label: "Help me choose", action: "recommend" },
      { label: "Tell me about your sourcing", action: "sourcing" },
    ],
  },
  recommend: {
    text: "Let's narrow it down. How do you usually brew your coffee?",
    options: [
      { label: "Pour over / filter", action: "rec_pourover" },
      { label: "Espresso machine", action: "rec_espresso" },
      { label: "French press", action: "rec_french" },
      { label: "I'm not sure yet", action: "rec_any" },
    ],
  },
  rec_pourover: {
    text: "Pour over lovers tend to appreciate clarity and nuance. I'd recommend these two — the Yirgacheffe for something floral and bright, or the Nyeri AA for a more complex, fruit-forward cup.",
    showProducts: ["ethiopian-yirgacheffe", "kenyan-aa"],
    options: [
      { label: "Tell me more about Yirgacheffe", action: "detail_yirgacheffe" },
      { label: "Tell me more about Nyeri AA", action: "detail_nyeri" },
      { label: "Show me everything", action: "browse" },
    ],
  },
  rec_espresso: {
    text: "For espresso, you'll want something that holds up under pressure — good body, balanced sweetness. The Huila Reserve pulls beautiful caramel shots, and the Antigua gives you that classic chocolate-forward profile.",
    showProducts: ["colombian-huila", "guatemala-antigua"],
    options: [
      { label: "I'll try the Huila", action: "add_colombian-huila" },
      { label: "I'll try the Antigua", action: "add_guatemala-antigua" },
      { label: "Show me everything", action: "browse" },
    ],
  },
  rec_french: {
    text: "French press does well with fuller bodies and lower acidity. The Mandheling is a classic choice — earthy, thick, satisfying. The Antigua also works beautifully here with its cocoa notes.",
    showProducts: ["sumatra-mandheling", "guatemala-antigua"],
    options: [
      { label: "I'll try the Mandheling", action: "add_sumatra-mandheling" },
      { label: "I'll try the Antigua", action: "add_guatemala-antigua" },
      { label: "Show me everything", action: "browse" },
    ],
  },
  rec_any: {
    text: "No worries. If I had to pick one bag for someone who's exploring — I'd hand them the Huila Reserve. It's incredibly versatile, forgiving with any brew method, and just a beautiful cup of coffee.",
    showProducts: ["colombian-huila"],
    options: [
      { label: "Add it to my bag", action: "add_colombian-huila" },
      { label: "Show me other options", action: "browse" },
      { label: "What makes it special?", action: "detail_huila" },
    ],
  },
  light: {
    text: "Light and fruity — you've got great taste. Here are our lighter roasts, each with distinct fruit-forward profiles.",
    showProducts: ["ethiopian-yirgacheffe", "rwanda-kivu", "kenyan-aa"],
    options: [
      { label: "Which is the fruitiest?", action: "fruitiest" },
      { label: "I'll take the Yirgacheffe", action: "add_ethiopian-yirgacheffe" },
      { label: "Tell me about Rwanda", action: "detail_kivu" },
    ],
  },
  bold: {
    text: "For bold and rich, these two deliver. The Mandheling is our most full-bodied roast — deep, earthy, unapologetic. The Antigua brings similar depth but with more nuance.",
    showProducts: ["sumatra-mandheling", "guatemala-antigua"],
    options: [
      { label: "How dark is the Mandheling?", action: "detail_mandheling" },
      { label: "Add the Mandheling", action: "add_sumatra-mandheling" },
      { label: "Add the Antigua", action: "add_guatemala-antigua" },
    ],
  },
  sourcing: {
    text: "Every bean we sell is sourced directly from farms and cooperatives. No middlemen, fair prices, full traceability. We roast weekly in small batches and ship within 48 hours of roasting. Freshness isn't a feature — it's the baseline.",
    options: [
      { label: "Browse all beans", action: "browse" },
      { label: "Help me choose", action: "recommend" },
    ],
  },
  fruitiest: {
    text: "That would be the Lake Kivu from Rwanda. Peach, vanilla, lime — it drinks almost like a fruit tea. Absolutely stunning as a pour over on a quiet morning.",
    showProducts: ["rwanda-kivu"],
    options: [
      { label: "Add it to my bag", action: "add_rwanda-kivu" },
      { label: "Show me other light options", action: "light" },
    ],
  },
  detail_yirgacheffe: {
    text: "Yirgacheffe is one of the most celebrated coffee origins in the world — and for good reason. Ours comes from the Gedeo zone at 1,900 meters. The jasmine and bergamot notes come through beautifully in a pour over. It's the kind of coffee that makes you pause and pay attention.",
    showProducts: ["ethiopian-yirgacheffe"],
    options: [
      { label: "Add it to my bag", action: "add_ethiopian-yirgacheffe" },
      { label: "Compare with Nyeri AA", action: "compare_light" },
    ],
  },
  detail_nyeri: {
    text: "Our Nyeri AA is a standout Kenyan — SL28 varietal from the slopes of Mt. Kenya. The double-wash process gives it incredible clarity. You'll get waves of blackcurrant and grapefruit, resolving into a sweet brown sugar finish. It's a coffee that evolves as it cools.",
    showProducts: ["kenyan-aa"],
    options: [
      { label: "Add it to my bag", action: "add_kenyan-aa" },
      { label: "Show me other options", action: "browse" },
    ],
  },
  detail_huila: {
    text: "The Huila Reserve comes from smallholder farms in southern Colombia. Washed process, which gives it a clean, sweet profile — caramel, red apple, milk chocolate. It's one of those coffees that just works. Beautiful as espresso, delightful as filter. Hard to go wrong.",
    showProducts: ["colombian-huila"],
    options: [
      { label: "Add it to my bag", action: "add_colombian-huila" },
      { label: "Show me other options", action: "browse" },
    ],
  },
  detail_kivu: {
    text: "Lake Kivu comes from cooperative farms on Rwanda's western border. Fully washed Bourbon varietal. The peach and vanilla are unmistakable — it's almost dessert-like, but with a lime acidity that keeps it lively. One of the most elegant coffees we carry.",
    showProducts: ["rwanda-kivu"],
    options: [
      { label: "Add it to my bag", action: "add_rwanda-kivu" },
      { label: "Show me other options", action: "browse" },
    ],
  },
  detail_mandheling: {
    text: "Mandheling is our darkest roast — and it's intentional. Sumatra's wet-hulled process creates an earthy, syrupy body that's unlike anything else. Dark chocolate, cedar, a hint of tobacco. This is coffee for people who want to feel it. Best in a French press or as a long black.",
    showProducts: ["sumatra-mandheling"],
    options: [
      { label: "Add it to my bag", action: "add_sumatra-mandheling" },
      { label: "Show me other options", action: "browse" },
    ],
  },
  compare_light: {
    text: "Side by side — the Yirgacheffe is more delicate. Jasmine, tea-like, ethereal. The Nyeri AA is bolder within the light roast spectrum — more fruit punch than fruit tea. Both exceptional, just different moods.",
    showProducts: ["ethiopian-yirgacheffe", "kenyan-aa"],
    options: [
      { label: "I'll take the Yirgacheffe", action: "add_ethiopian-yirgacheffe" },
      { label: "I'll take the Nyeri AA", action: "add_kenyan-aa" },
      { label: "Why not both?", action: "add_both_light" },
    ],
  },
  added_to_cart: {
    text: "Added. Anything else, or shall we wrap up?",
    options: [
      { label: "Browse more beans", action: "browse" },
      { label: "That's all — checkout", action: "checkout" },
    ],
  },
  checkout: {
    text: "Ready when you are.",
    showCheckout: true,
    options: [],
  },
  order_placed: {
    text: "Order placed. We'll roast your beans tomorrow morning and ship within 48 hours. You'll receive a tracking link via email. Thanks for choosing Glove Coffee.",
    options: [
      { label: "Start over", action: "greeting" },
    ],
  },
};

// Intensity bar
function IntensityBar({ level }) {
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 12,
            height: 4,
            background: i < level ? SAGE[700] : SAGE[100],
            transition: "background 0.3s ease",
          }}
        />
      ))}
    </div>
  );
}

// Product card
function ProductCard({ product, onAdd, compact = false }) {
  const [expanded, setExpanded] = useState(false);

  if (compact) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 0",
          borderBottom: `1px solid ${SAGE[100]}`,
        }}
      >
        <div>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 500, color: SAGE[900] }}>
            {product.name}
          </span>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: SAGE[400], marginLeft: 8 }}>
            {product.weight}
          </span>
        </div>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: SAGE[700] }}>
          {formatPrice(product.price)}
        </span>
      </div>
    );
  }

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        background: CREAM[50],
        border: `1px solid ${SAGE[100]}`,
        padding: 0,
        cursor: "pointer",
        transition: "all 0.25s ease",
        overflow: "hidden",
        flex: "0 0 auto",
        width: 220,
        minWidth: 220,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = SAGE[300];
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = SAGE[100];
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Top color band based on roast */}
      <div
        style={{
          height: 80,
          background:
            product.roast === "Dark"
              ? `linear-gradient(135deg, ${SAGE[800]}, ${SAGE[950]})`
              : product.roast === "Medium"
              ? `linear-gradient(135deg, ${SAGE[500]}, ${SAGE[700]})`
              : `linear-gradient(135deg, ${SAGE[200]}, ${SAGE[400]})`,
          display: "flex",
          alignItems: "flex-end",
          padding: "0 16px 10px",
        }}
      >
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: product.roast === "Dark" || product.roast === "Medium" ? CREAM[100] : SAGE[800],
            opacity: 0.8,
          }}
        >
          {product.origin}
        </span>
      </div>

      <div style={{ padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h3
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 20,
              fontWeight: 400,
              color: SAGE[900],
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {product.name}
          </h3>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 13,
              color: SAGE[600],
              flexShrink: 0,
              marginLeft: 8,
            }}
          >
            {formatPrice(product.price)}
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {product.notes.map((note) => (
            <span
              key={note}
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 10,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: SAGE[500],
                background: SAGE[50],
                padding: "3px 8px",
                border: `1px solid ${SAGE[100]}`,
              }}
            >
              {note}
            </span>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, color: SAGE[400], textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Intensity
            </span>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, color: SAGE[400] }}>
              {product.roast}
            </span>
          </div>
          <IntensityBar level={product.intensity} />
        </div>

        {expanded && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: `1px solid ${SAGE[100]}`,
              animation: "fadeIn 0.2s ease",
            }}
          >
            <p
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                lineHeight: 1.6,
                color: SAGE[600],
                margin: 0,
              }}
            >
              {product.description}
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAdd(product);
              }}
              style={{
                marginTop: 14,
                width: "100%",
                padding: "10px",
                background: SAGE[900],
                color: CREAM[50],
                border: "none",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                cursor: "pointer",
                transition: "background 0.2s ease",
              }}
              onMouseEnter={(e) => (e.target.style.background = SAGE[700])}
              onMouseLeave={(e) => (e.target.style.background = SAGE[900])}
            >
              Add to bag — {formatPrice(product.price)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Product carousel
function ProductCarousel({ productIds, onAdd }) {
  const products = productIds === "all" ? PRODUCTS : PRODUCTS.filter((p) => productIds.includes(p.id));

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        overflowX: "auto",
        paddingBottom: 8,
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        marginTop: 12,
      }}
    >
      {products.map((p) => (
        <ProductCard key={p.id} product={p} onAdd={onAdd} />
      ))}
    </div>
  );
}

// Chat option button
function OptionButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        background: "transparent",
        border: `1px solid ${SAGE[200]}`,
        color: SAGE[700],
        fontFamily: "'DM Sans', sans-serif",
        fontSize: 13,
        cursor: "pointer",
        transition: "all 0.2s ease",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        e.target.style.background = SAGE[900];
        e.target.style.color = CREAM[50];
        e.target.style.borderColor = SAGE[900];
      }}
      onMouseLeave={(e) => {
        e.target.style.background = "transparent";
        e.target.style.color = SAGE[700];
        e.target.style.borderColor = SAGE[200];
      }}
    >
      {label}
    </button>
  );
}

// Grind selector for checkout
function GrindSelector({ value, onChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {GRIND_OPTIONS.map((g) => (
        <button
          key={g}
          onClick={() => onChange(g)}
          style={{
            padding: "6px 14px",
            background: value === g ? SAGE[900] : "transparent",
            color: value === g ? CREAM[50] : SAGE[600],
            border: `1px solid ${value === g ? SAGE[900] : SAGE[200]}`,
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

// Checkout panel
function CheckoutPanel({ cart, onPlaceOrder, onBack }) {
  const [grind, setGrind] = useState("Whole Bean");
  const [email, setEmail] = useState("");

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const shipping = subtotal > 4000 ? 0 : 500;
  const total = subtotal + shipping;

  return (
    <div
      style={{
        background: CREAM[50],
        border: `1px solid ${SAGE[100]}`,
        padding: 24,
        marginTop: 12,
        animation: "slideUp 0.3s ease",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h3
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 20,
            fontWeight: 400,
            color: SAGE[900],
            margin: 0,
          }}
        >
          Your Bag
        </h3>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            color: SAGE[400],
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Continue shopping
        </button>
      </div>

      {cart.map((item) => (
        <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${SAGE[50]}` }}>
          <div>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 500, color: SAGE[900] }}>
              {item.name}
            </span>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: SAGE[400], marginLeft: 8 }}>
              × {item.qty}
            </span>
          </div>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: SAGE[700] }}>
            {formatPrice(item.price * item.qty)}
          </span>
        </div>
      ))}

      <div style={{ marginTop: 20 }}>
        <label
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: SAGE[500],
            display: "block",
            marginBottom: 8,
          }}
        >
          Grind
        </label>
        <GrindSelector value={grind} onChange={setGrind} />
      </div>

      <div style={{ marginTop: 20 }}>
        <label
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: SAGE[500],
            display: "block",
            marginBottom: 8,
          }}
        >
          Email for order confirmation
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          style={{
            width: "100%",
            padding: "10px 12px",
            border: `1px solid ${SAGE[200]}`,
            background: "white",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
            color: SAGE[900],
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => (e.target.style.borderColor = SAGE[500])}
          onBlur={(e) => (e.target.style.borderColor = SAGE[200])}
        />
      </div>

      <div
        style={{
          marginTop: 20,
          paddingTop: 16,
          borderTop: `1px solid ${SAGE[100]}`,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: SAGE[500] }}>Subtotal</span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: SAGE[700] }}>{formatPrice(subtotal)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: SAGE[500] }}>Shipping</span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: shipping === 0 ? SAGE[400] : SAGE[700] }}>
            {shipping === 0 ? "Free" : formatPrice(shipping)}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: `1px solid ${SAGE[100]}` }}>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 600, color: SAGE[900] }}>Total</span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, fontWeight: 600, color: SAGE[900] }}>{formatPrice(total)}</span>
        </div>
      </div>

      <button
        onClick={onPlaceOrder}
        style={{
          marginTop: 20,
          width: "100%",
          padding: "14px",
          background: SAGE[900],
          color: CREAM[50],
          border: "none",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: "pointer",
          transition: "background 0.2s ease",
        }}
        onMouseEnter={(e) => (e.target.style.background = SAGE[700])}
        onMouseLeave={(e) => (e.target.style.background = SAGE[900])}
      >
        Place Order — {formatPrice(total)}
      </button>

      <p
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          color: SAGE[300],
          textAlign: "center",
          marginTop: 12,
          marginBottom: 0,
        }}
      >
        Roasted within 24hrs · Ships in 48hrs · Free shipping over $40
      </p>
    </div>
  );
}

// Message bubble
function Message({ message, isLast, onOptionClick, onAddProduct, cart }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  const conv = message.conversation;

  return (
    <div
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        transition: "all 0.35s ease",
      }}
    >
      {message.type === "user" ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <div
            style={{
              background: SAGE[900],
              color: CREAM[50],
              padding: "10px 16px",
              maxWidth: "75%",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            {message.text}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div
              style={{
                width: 28,
                height: 28,
                background: SAGE[100],
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={SAGE[600]} strokeWidth="2">
                <path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
                <line x1="6" y1="1" x2="6" y2="4" />
                <line x1="10" y1="1" x2="10" y2="4" />
                <line x1="14" y1="1" x2="14" y2="4" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: SAGE[800],
                  margin: 0,
                }}
              >
                {conv.text}
              </p>

              {conv.showProducts && (
                <ProductCarousel productIds={conv.showProducts} onAdd={onAddProduct} />
              )}

              {conv.showCheckout && cart.length > 0 && (
                <CheckoutPanel
                  cart={cart}
                  onPlaceOrder={() => onOptionClick("order_placed", "Place order")}
                  onBack={() => onOptionClick("browse", "Continue shopping")}
                />
              )}

              {isLast && conv.options && conv.options.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                  {conv.options.map((opt) => (
                    <OptionButton
                      key={opt.action}
                      label={opt.label}
                      onClick={() => onOptionClick(opt.action, opt.label)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Typing indicator
function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 24 }}>
      <div
        style={{
          width: 28,
          height: 28,
          background: SAGE[100],
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={SAGE[600]} strokeWidth="2">
          <path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
          <line x1="6" y1="1" x2="6" y2="4" />
          <line x1="10" y1="1" x2="10" y2="4" />
          <line x1="14" y1="1" x2="14" y2="4" />
        </svg>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "12px 0" }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 6,
              height: 6,
              background: SAGE[300],
              borderRadius: "50%",
              animation: `typingDot 1.2s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Cart badge
function CartBadge({ cart }) {
  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  const totalPrice = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

  if (totalItems === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        background: SAGE[900],
        color: CREAM[50],
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={CREAM[100]} strokeWidth="2">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 01-8 0" />
      </svg>
      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500 }}>
        {totalItems} {totalItems === 1 ? "item" : "items"}
      </span>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, marginLeft: "auto" }}>
        {formatPrice(totalPrice)}
      </span>
    </div>
  );
}

// Main app
export default function GloveCoffee() {
  const [messages, setMessages] = useState([]);
  const [cart, setCart] = useState([]);
  const [isTyping, setIsTyping] = useState(true);
  const [freeInput, setFreeInput] = useState("");
  const chatRef = useRef(null);
  const initialized = useRef(false);

  const scrollToBottom = useCallback(() => {
    if (chatRef.current) {
      setTimeout(() => {
        chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
      }, 100);
    }
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setTimeout(() => {
      setMessages([{ type: "assistant", conversation: CONVERSATIONS.greeting, id: Date.now() }]);
      setIsTyping(false);
    }, 800);
  }, []);

  useEffect(scrollToBottom, [messages, isTyping, scrollToBottom]);

  const addProduct = useCallback(
    (product) => {
      setCart((prev) => {
        const existing = prev.find((i) => i.id === product.id);
        if (existing) return prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i));
        return [...prev, { ...product, qty: 1 }];
      });

      setMessages((prev) => [
        ...prev,
        { type: "user", text: `Add ${product.name} to my bag`, id: Date.now() },
      ]);
      setIsTyping(true);

      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            type: "assistant",
            conversation: {
              text: `${product.name} added to your bag. ${product.origin} origin, ${product.weight}. Anything else catch your eye?`,
              options: [
                { label: "Browse more", action: "browse" },
                { label: "Checkout", action: "checkout" },
              ],
            },
            id: Date.now() + 1,
          },
        ]);
        setIsTyping(false);
      }, 600);
    },
    [],
  );

  const handleOption = useCallback(
    (action, label) => {
      // Handle add-to-cart actions
      if (action.startsWith("add_")) {
        if (action === "add_both_light") {
          const y = PRODUCTS.find((p) => p.id === "ethiopian-yirgacheffe");
          const n = PRODUCTS.find((p) => p.id === "kenyan-aa");
          setCart((prev) => {
            let next = [...prev];
            [y, n].forEach((product) => {
              const existing = next.find((i) => i.id === product.id);
              if (existing) next = next.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i));
              else next = [...next, { ...product, qty: 1 }];
            });
            return next;
          });
          setMessages((prev) => [...prev, { type: "user", text: label, id: Date.now() }]);
          setIsTyping(true);
          setTimeout(() => {
            setMessages((prev) => [
              ...prev,
              {
                type: "assistant",
                conversation: {
                  text: "Good call — both added. The Yirgacheffe and Nyeri AA make a beautiful pair. Ready to checkout, or still exploring?",
                  options: [
                    { label: "Checkout", action: "checkout" },
                    { label: "Keep browsing", action: "browse" },
                  ],
                },
                id: Date.now() + 1,
              },
            ]);
            setIsTyping(false);
          }, 600);
          return;
        }

        const productId = action.replace("add_", "");
        const product = PRODUCTS.find((p) => p.id === productId);
        if (product) {
          addProduct(product);
          return;
        }
      }

      if (action === "order_placed") {
        setMessages((prev) => [...prev, { type: "user", text: label, id: Date.now() }]);
        setIsTyping(true);
        setTimeout(() => {
          setCart([]);
          setMessages((prev) => [
            ...prev,
            { type: "assistant", conversation: CONVERSATIONS.order_placed, id: Date.now() + 1 },
          ]);
          setIsTyping(false);
        }, 1200);
        return;
      }

      const conv = CONVERSATIONS[action];
      if (!conv) return;

      setMessages((prev) => [...prev, { type: "user", text: label, id: Date.now() }]);
      setIsTyping(true);

      setTimeout(() => {
        setMessages((prev) => [...prev, { type: "assistant", conversation: conv, id: Date.now() + 1 }]);
        setIsTyping(false);
      }, 500 + Math.random() * 400);
    },
    [addProduct],
  );

  const handleFreeInput = useCallback(
    (e) => {
      e.preventDefault();
      if (!freeInput.trim()) return;
      const text = freeInput.trim().toLowerCase();
      setFreeInput("");

      setMessages((prev) => [...prev, { type: "user", text: freeInput.trim(), id: Date.now() }]);
      setIsTyping(true);

      let action = "browse";
      if (text.includes("light") || text.includes("fruit") || text.includes("bright")) action = "light";
      else if (text.includes("bold") || text.includes("dark") || text.includes("strong")) action = "bold";
      else if (text.includes("help") || text.includes("recommend") || text.includes("suggest")) action = "recommend";
      else if (text.includes("checkout") || text.includes("order") || text.includes("buy") || text.includes("pay")) action = "checkout";
      else if (text.includes("source") || text.includes("farm") || text.includes("origin")) action = "sourcing";

      const conv = CONVERSATIONS[action];
      setTimeout(() => {
        setMessages((prev) => [...prev, { type: "assistant", conversation: conv, id: Date.now() + 1 }]);
        setIsTyping(false);
      }, 600 + Math.random() * 400);
    },
    [freeInput],
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        background: CREAM[100],
        display: "flex",
        flexDirection: "column",
        fontFamily: "'DM Sans', sans-serif",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500;600&family=Instrument+Serif&display=swap');

        * { box-sizing: border-box; }

        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${SAGE[200]}; }

        @keyframes typingDot {
          0%, 100% { opacity: 0.3; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-3px); }
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        input::placeholder { color: ${SAGE[300]}; }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          borderBottom: `1px solid ${SAGE[100]}`,
          background: CREAM[50],
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              background: SAGE[900],
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={CREAM[50]} strokeWidth="2">
              <path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" />
              <line x1="10" y1="1" x2="10" y2="4" />
              <line x1="14" y1="1" x2="14" y2="4" />
            </svg>
          </div>
          <div>
            <h1
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: 18,
                fontWeight: 400,
                color: SAGE[900],
                margin: 0,
                lineHeight: 1,
              }}
            >
              Glove Coffee
            </h1>
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 9,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: SAGE[400],
              }}
            >
              Direct from origin
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <CartBadge cart={cart} />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              border: `1px solid ${SAGE[100]}`,
            }}
          >
            <div style={{ width: 6, height: 6, background: "#4ade80", borderRadius: "50%" }} />
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: SAGE[500] }}>Online</span>
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div
        ref={chatRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 24px 0",
          scrollBehavior: "smooth",
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {messages.map((msg, i) => (
            <Message
              key={msg.id}
              message={msg}
              isLast={i === messages.length - 1}
              onOptionClick={handleOption}
              onAddProduct={addProduct}
              cart={cart}
            />
          ))}
          {isTyping && <TypingIndicator />}
        </div>
      </div>

      {/* Input */}
      <div
        style={{
          padding: "16px 24px",
          borderTop: `1px solid ${SAGE[100]}`,
          background: CREAM[50],
          flexShrink: 0,
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={freeInput}
              onChange={(e) => setFreeInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFreeInput(e)}
              placeholder="Ask about our coffee..."
              style={{
                flex: 1,
                padding: "12px 16px",
                border: `1px solid ${SAGE[200]}`,
                background: "white",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 14,
                color: SAGE[900],
                outline: "none",
              }}
              onFocus={(e) => (e.target.style.borderColor = SAGE[500])}
              onBlur={(e) => (e.target.style.borderColor = SAGE[200])}
            />
            <button
              onClick={handleFreeInput}
              style={{
                padding: "12px 20px",
                background: SAGE[900],
                color: CREAM[50],
                border: "none",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                cursor: "pointer",
                transition: "background 0.2s ease",
                display: "flex",
                alignItems: "center",
              }}
              onMouseEnter={(e) => (e.target.style.background = SAGE[700])}
              onMouseLeave={(e) => (e.target.style.background = SAGE[900])}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 10, gap: 6, alignItems: "center" }}>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: SAGE[300], letterSpacing: "0.1em" }}>
              POWERED BY
            </span>
            <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 12, color: SAGE[500] }}>
              Glove
            </span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: SAGE[300] }}>
              ·
            </span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: SAGE[300], letterSpacing: "0.05em" }}>
              dterminal.net
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}