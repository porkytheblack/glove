/**
 * Keyset cursor for `listConversations`. Encodes the `(last_event_at, id)`
 * pair of the last row on the previous page so the next page can resume with
 * a stable strict-less-than comparison. Base64url so it's URL-safe without
 * percent-encoding.
 *
 * Format: `base64url(JSON.stringify({ t: lastEventAt, i: id }))`.
 */

export interface ConversationCursor {
  lastEventAt: string
  id: string
}

export function encodeCursor(c: ConversationCursor): string {
  const json = JSON.stringify({ t: c.lastEventAt, i: c.id })
  return Buffer.from(json, "utf8").toString("base64url")
}

/**
 * Returns the decoded cursor, or `null` if the input is malformed. Routes
 * should treat `null` from a non-empty input as a 400 (bad client cursor),
 * not a 500.
 */
export function decodeCursor(raw: string | null | undefined): ConversationCursor | null {
  if (!raw) return null
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8")
    const obj = JSON.parse(json) as { t?: unknown; i?: unknown }
    if (typeof obj.t !== "string" || typeof obj.i !== "string") return null
    return { lastEventAt: obj.t, id: obj.i }
  } catch {
    return null
  }
}
