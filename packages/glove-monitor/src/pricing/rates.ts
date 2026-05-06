/**
 * Cost is tracked in integer micros (1e-6 USD) to avoid floating-point drift.
 * Conversion to display-formatted dollars happens at the rendering edge.
 */

export interface ModelRate {
  /** USD micros (1e-6) per 1k input tokens. */
  input_per_1k_micros: number
  /** USD micros (1e-6) per 1k output tokens. */
  output_per_1k_micros: number
}

export const DEFAULT_RATES: Record<string, ModelRate> = {
  "claude-opus-4-7":            { input_per_1k_micros: 15_000, output_per_1k_micros: 75_000 },
  "claude-sonnet-4-6":          { input_per_1k_micros:  3_000, output_per_1k_micros: 15_000 },
  "claude-haiku-4-5-20251001":  { input_per_1k_micros:  1_000, output_per_1k_micros:  5_000 },
  "claude-3-5-sonnet-20241022": { input_per_1k_micros:  3_000, output_per_1k_micros: 15_000 },
  "claude-3-5-haiku-20241022":  { input_per_1k_micros:  1_000, output_per_1k_micros:  5_000 },
  "gpt-4o":                     { input_per_1k_micros:  2_500, output_per_1k_micros: 10_000 },
  "gpt-4o-mini":                { input_per_1k_micros:    150, output_per_1k_micros:    600 },
  "gpt-4-turbo":                { input_per_1k_micros: 10_000, output_per_1k_micros: 30_000 },
}

export function computeCostMicros(
  model: string,
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
  overrides?: Record<string, ModelRate>,
): number | null {
  const rate = overrides?.[model] ?? DEFAULT_RATES[model]
  if (!rate) return null
  const inMicros = tokensIn ? Math.ceil((tokensIn * rate.input_per_1k_micros) / 1000) : 0
  const outMicros = tokensOut ? Math.ceil((tokensOut * rate.output_per_1k_micros) / 1000) : 0
  return inMicros + outMicros
}

export function microsToDollars(micros: number): number {
  return micros / 1_000_000
}

export function formatCostUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`
}
