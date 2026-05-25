import type { AnyAgent } from "./agent.js";

export const AGENT_BRAND = Symbol.for("glove-continuum-agent");

export function isAgent(value: unknown): value is AnyAgent {
  if (typeof value !== "object" || value === null) return false;
  return (value as Record<symbol, unknown>)[AGENT_BRAND] === true;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
