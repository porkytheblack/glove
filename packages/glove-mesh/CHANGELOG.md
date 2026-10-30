# glove-mesh

## 0.2.2

### Patch Changes

- Updated dependencies [[`ca88985`](https://github.com/porkytheblack/glove/commit/ca8898526d5baeabe0469921658977451dab921c), [`ca88985`](https://github.com/porkytheblack/glove/commit/ca8898526d5baeabe0469921658977451dab921c)]:
  - glove-core@4.6.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`6f04d7e`](https://github.com/porkytheblack/glove/commit/6f04d7e1db19b30676254753c6a2a68c04d427cb)]:
  - glove-core@4.5.0

## 0.2.0

### Minor Changes

- [#214](https://github.com/porkytheblack/glove/pull/214) [`8f23ff0`](https://github.com/porkytheblack/glove/commit/8f23ff02cae75d1cbf447e8b601349ba70154a08) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Mesh messages can arrive as Glove events instead of inbox items.

  - `mountMesh` takes `delivery: "inbox" | "events"`. The default stays `"inbox"`, so existing integrations are unchanged; `"events"` needs a runnable with `emitEvent` and `addContextProvider` (glove-core 4.4).
  - With events, an incoming message or broadcast is emitted as a Glove event (`source: "mesh:<from>"`, `kind: "direct" | "broadcast" | "reply"`). It joins a running loop at the next tool step. An idle agent wakes for it, or it waits for the user's next message, per the Glove's event policy and the new `whenIdle` option. The model sees it as escaped XML marked as outside information, and re-deliveries of a message id are dropped. Blocking sends wait in memory and show as `<mesh_waiting>` runtime context until the ack or reply, which arrives as an event. No inbox methods are needed on the store.
  - Agents can now react to each other without a person prompting them. Use a Glove `events.policy` (by `source`) or `whenIdle: "defer"` to keep them from waking each other in a loop.
  - `ToolContext` has `waits` (a `PendingWaits`) instead of `store` and `pending`. `inboxWaits` and `EventWaits` are exported for custom tool composition.
  - Foundry mounts mesh with `delivery: "inbox"`: it builds a runnable per run, so messages that arrive between runs must wait in the conversation store.

### Patch Changes

- Updated dependencies [[`d1d9508`](https://github.com/porkytheblack/glove/commit/d1d95086ce5738619e3eddaa66dfbd1abfe4d2e1), [`c6f6cb4`](https://github.com/porkytheblack/glove/commit/c6f6cb4bb1c81357ca16f9fa043890cc0a9ff325)]:
  - glove-core@4.4.0

## 0.1.7

### Patch Changes

- Updated dependencies [[`109e40d`](https://github.com/porkytheblack/glove/commit/109e40dddafe3bfe1ac2dd113ca325f440613ad8)]:
  - glove-core@4.3.0

## 0.1.6

### Patch Changes

- Updated dependencies [[`0fb8e0b`](https://github.com/porkytheblack/glove/commit/0fb8e0b8725cbf09e283c00438f2b35dc5faab5b)]:
  - glove-core@4.2.0

## 0.1.5

### Patch Changes

- Updated dependencies [[`8c36feb`](https://github.com/porkytheblack/glove/commit/8c36feb1139966bcdac8525e79db1714c13c5b6b)]:
  - glove-core@4.1.0

## 0.1.4

### Patch Changes

- Updated dependencies []:
  - glove-core@4.0.0

## 0.1.3

### Patch Changes

- Updated dependencies [e6210d0]
  - glove-core@3.7.1

## 0.1.2

### Patch Changes

- Updated dependencies [[`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8), [`ee591da`](https://github.com/porkytheblack/glove/commit/ee591da42305661339913bca8f967a9f8c0fecbf)]:
  - glove-core@3.7.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a), [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb), [`ef623ec`](https://github.com/porkytheblack/glove/commit/ef623ec744118723a6b45f6166274316e86a9109), [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad)]:
  - glove-core@3.6.0
