import type { CSSProperties } from "react";

/**
 * The kit's components read these CSS variables. A product sets them once on
 * a wrapper (or :root) with its own colours; the fallbacks are a plain light
 * theme.
 */
export interface KitTheme {
  /** Body text font. */
  readonly font?: string;
  /** Labels, tool lines and section headings. */
  readonly mono?: string;
  /** The page's ground. */
  readonly bg?: string;
  /** Cards and the composer. */
  readonly surface?: string;
  /** Bubbles and cards inside cards. */
  readonly raised?: string;
  /** Hairlines between areas. */
  readonly line?: string;
  /** Borders on buttons and inner cards. */
  readonly lineStrong?: string;
  readonly text?: string;
  readonly muted?: string;
  readonly accent?: string;
  /** Text on an accent button. */
  readonly onAccent?: string;
  /** The person's own bubble. */
  readonly mine?: string;
  /** Approvals and outbound transmissions. */
  readonly ask?: string;
  /** Connected accounts. */
  readonly ok?: string;
}

const NAMES: Record<keyof KitTheme, string> = {
  font: "--kit-font",
  mono: "--kit-mono",
  bg: "--kit-bg",
  surface: "--kit-surface",
  raised: "--kit-raised",
  line: "--kit-line",
  lineStrong: "--kit-line-strong",
  text: "--kit-text",
  muted: "--kit-muted",
  accent: "--kit-accent",
  onAccent: "--kit-on-accent",
  mine: "--kit-mine",
  ask: "--kit-ask",
  ok: "--kit-ok",
};

const FALLBACK: Required<KitTheme> = {
  font: "system-ui, sans-serif",
  mono: "ui-monospace, monospace",
  bg: "#F5F7FA",
  surface: "#FFFFFF",
  raised: "#F5F7FA",
  line: "#DDE3EA",
  lineStrong: "#C9D1DA",
  text: "#10161C",
  muted: "#4D5A66",
  accent: "#2C5F8F",
  onAccent: "#FFFFFF",
  mine: "#E6EEF6",
  ask: "#9A6B12",
  ok: "#2E7D4F",
};

/** A style object that sets the kit's variables, for a wrapper element. */
export function themeStyle(theme: KitTheme): CSSProperties {
  return Object.fromEntries(
    Object.entries(theme).filter(([, value]) => value).map(([key, value]) => [NAMES[key as keyof KitTheme], value]),
  ) as CSSProperties;
}

/** `var(--kit-…, fallback)` for one token. */
export const token = (key: keyof KitTheme): string => `var(${NAMES[key]}, ${FALLBACK[key]})`;
