const tagOrEmojiFlag = /(?:\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F})|[\u{E0000}-\u{E007F}]/gu;

/** Strip invisible Unicode TAG code points while preserving complete emoji flag sequences. */
export function sanitizeMcpText(value: string): string {
  return value.replace(tagOrEmojiFlag, (match) => match.codePointAt(0) === 0x1f3f4 ? match : "");
}

/** Sanitize every string in a JSON-like MCP payload without mutating provider data. */
export function sanitizeMcpValue<T>(value: T, depth = 0): T {
  if (typeof value === "string") return sanitizeMcpText(value) as T;
  if (depth >= 64 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMcpValue(item, depth + 1)) as T;
  }
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const safeKey = sanitizeMcpText(key);
    if (safeKey === "_meta") {
      const metadata = sanitizeMcpMetadata(item);
      return metadata ? [[safeKey, metadata] as const] : [];
    }
    return [[safeKey, sanitizeMcpValue(item, depth + 1)] as const];
  });
  return Object.fromEntries(entries) as T;
}

/** Keep vendor metadata while dropping MCP-reserved namespace keys. */
export function sanitizeMcpMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(?:^|[./])(?:mcp|modelcontextprotocol)(?:[./]|$)/i.test(key))
    .map(([key, item]) => [sanitizeMcpText(key), sanitizeMcpValue(item)] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}
