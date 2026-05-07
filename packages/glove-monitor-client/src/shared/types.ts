import type { SubscriberEvent, SubscriberEventDataMap } from "glove-core"

/**
 * Shape of a single ingested event. Mirrors glove-core's `SubscriberEvent`
 * union but adds `occurred_at` so the server can reconstruct timeline order
 * even when delivery is reordered in-flight.
 */
export type IngestEvent = {
  [T in SubscriberEvent["type"]]: { type: T; occurred_at: string } & SubscriberEventDataMap[T]
}[SubscriberEvent["type"]]

export interface IngestPayload {
  app: string
  conversation_id: string
  user_id?: string
  events: IngestEvent[]
}
