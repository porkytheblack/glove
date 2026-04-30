import type { DisplayManagerAdapter, Slot } from "glove-core"

import type { WsSubscriber } from "./ws-subscriber"

/**
 * Bridges the in-process Displaymanager to the WebSocket.
 *
 * - When a slot is pushed, send `display_push` to the client.
 * - When a slot is removed (resolved/rejected/cleared), send `display_clear`.
 * - The client routes `display_resolve` / `display_reject` back to the
 *   manager via `manager.resolve` / `manager.reject`.
 *
 * Tracks the current stack to derive removals between snapshots — the
 * adapter only exposes the full stack on each notify().
 */
export function attachDisplayBridge(
  manager: DisplayManagerAdapter,
  subscriber: WsSubscriber,
): () => void {
  let last = new Set<string>()

  const unsubscribe = manager.subscribe(async (stack: Array<Slot<unknown>>) => {
    const next = new Set(stack.map((s) => s.id))

    // New slots → push
    for (const slot of stack) {
      if (!last.has(slot.id)) {
        subscriber.enqueue({ type: "display_push", slot })
      }
    }

    // Removed slots → clear
    for (const id of last) {
      if (!next.has(id)) {
        subscriber.enqueue({ type: "display_clear", slot_id: id })
      }
    }

    last = next
  })

  return unsubscribe
}
