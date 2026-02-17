export interface Product {
  id: string;
  name: string;
  origin: string;
  roast: "Light" | "Medium-Light" | "Medium" | "Dark";
  price: number;
  weight: string;
  notes: string[];
  description: string;
  intensity: number;
}

export interface CartItem extends Product {
  qty: number;
}

export const PRODUCTS: Product[] = [
  {
    id: "ethiopian-yirgacheffe",
    name: "Yirgacheffe",
    origin: "Ethiopia",
    roast: "Light",
    price: 2200,
    weight: "250g",
    notes: ["Jasmine", "Bergamot", "Honey"],
    description:
      "Bright and floral with a clean, tea-like body. Grown at 1,900m in the Gedeo zone.",
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
    description:
      "Balanced sweetness with a silky mouthfeel. Washed process from smallholder farms.",
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
    description:
      "Complex and vibrant. Double-washed SL28 varietal from the slopes of Mt. Kenya.",
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
    description:
      "Earthy and full-bodied with low acidity. Wet-hulled in the Batak highlands.",
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
    description:
      "Rich and smoky with volcanic terroir. Grown in nutrient-dense pumice soil.",
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
    description:
      "Delicate and fruit-forward. Fully washed Bourbon from cooperative farms.",
    intensity: 2,
  },
];

export const GRIND_OPTIONS = [
  "Whole Bean",
  "French Press",
  "Pour Over",
  "Espresso",
  "Aeropress",
] as const;

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function getProductById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function getProductsByIds(ids: string[] | "all"): Product[] {
  if (ids === "all") return PRODUCTS;
  return PRODUCTS.filter((p) => ids.includes(p.id));
}
