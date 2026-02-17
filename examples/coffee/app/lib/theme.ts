import type { CartItem } from "./products";

// ─── Color palettes (sage/cream design system) ──────────────────────────────

export const SAGE = {
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

export const CREAM = {
  50: "#fefdfb",
  100: "#faf7f2",
  200: "#f2ebe0",
  300: "#e8dcc8",
};

// ─── Cart operations interface ──────────────────────────────────────────────

export interface CartOps {
  add: (productId: string, quantity?: number) => void;
  get: () => CartItem[];
  clear: () => void;
}
