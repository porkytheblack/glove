const UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Parse a simple interval string like "5m", "30s", "1h", "2d", "100ms", "1w".
 * The "every" prefix is optional for backwards compatibility (e.g. "every 5m"
 * also works). Returns milliseconds.
 */
export function parseInterval(interval: string): number {
  const match = interval.match(/^(?:every\s+)?(\d+)\s*(ms|s|m|h|d|w)$/i);
  if (!match) {
    throw new Error(
      `Invalid interval "${interval}". Expected format: "<number><ms|s|m|h|d|w>" (e.g. "5m", "30s", "1h", "100ms", "1w")`,
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms = UNITS[unit];
  if (!ms || value <= 0) {
    throw new Error(
      `Invalid interval "${interval}". Value must be a positive integer (e.g. "5m", not "0m").`,
    );
  }
  return value * ms;
}
