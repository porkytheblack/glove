import type { AgentEvent, GloveFoldArgs, RuntimeContextOptions, RuntimeContextProvider, StoreAdapter } from "glove-core";
import type { MeshAdapter } from "../core/adapter";
import type { AgentIdentity, IncomingMeshMessage } from "../core/types";
import {
  assertInboxCapable,
  buildInboxItemFromIncoming,
  inboxWaits,
  peerNameOrId,
  type PendingMap,
  type PendingWaits,
  type ToolContext,
} from "./common";
import { EventWaits, eventFromAck, eventFromIncoming } from "./events";
import { buildMeshSendTool } from "./send";
import { buildMeshBroadcastTool } from "./broadcast";
import { buildMeshListAgentsTool } from "./list";
import { buildMeshAcknowledgeTool } from "./acknowledge";

export { buildMeshSendTool } from "./send";
export { buildMeshBroadcastTool } from "./broadcast";
export { buildMeshListAgentsTool } from "./list";
export { buildMeshAcknowledgeTool } from "./acknowledge";
export { inboxWaits, type PendingWaits } from "./common";
export { EventWaits } from "./events";

/**
 * Loose target type — anything exposing `fold` for tool registration and a
 * readonly `store` for inbox writes. `IGloveRunnable` satisfies this, and
 * minimal stubs in tests do too without depending on the full runnable.
 * Event delivery also needs `emitEvent` and `addContextProvider`
 * (glove-core >=4.4).
 */
export type MeshMountTarget = {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
  readonly store: StoreAdapter;
  emitEvent?: (event: AgentEvent) => Promise<unknown>;
  addContextProvider?: (provider: RuntimeContextProvider, options?: RuntimeContextOptions) => () => void;
};

export interface MountMeshConfig {
  /** Per-agent adapter. Implements registration, transport, and inbound subscription. */
  adapter: MeshAdapter;
  /** This agent's identity, announced to the network on mount. */
  identity: AgentIdentity;
  /**
   * How incoming messages reach the agent.
   *
   * - `"inbox"` (default): each message is a resolved inbox item in the
   *   store, injected on the agent's next turn (or next tool step); blocking
   *   sends are pending inbox items. Requires the store's inbox methods.
   * - `"events"` (glove-core >=4.4): each message is a Glove event. It joins a running loop at the next tool step; an idle
   *   agent wakes for it, or it waits for the user's next message (see
   *   `whenIdle`). Peer content arrives as escaped `<event source="mesh:…">`
   *   XML, de-duplicated by message id. Blocking sends wait in memory and
   *   show as `<mesh_waiting>` runtime context until their ack or reply.
   *   Keep inbox delivery when the store must carry messages between
   *   short-lived runnables (Foundry builds one per run), or when your code
   *   reads mesh traffic from the inbox.
   */
  delivery?: "events" | "inbox";
  /** Event mode: what an idle agent does with a message. Default `"auto"` (the Glove's event policy decides). */
  whenIdle?: AgentEvent["whenIdle"];
}

/**
 * Wire a Glove agent onto a mesh network.
 *
 * On call:
 *   1. Picks the delivery mode and checks the runnable supports it.
 *   2. Subscribes a single inbound handler, then registers this agent's
 *      identity with the adapter.
 *   3. Folds four mesh tools onto the glove: glove_mesh_send_message,
 *      glove_mesh_broadcast, glove_mesh_list_agents, glove_mesh_acknowledge.
 *
 * Not chainable (returns Promise<void>); follows the `mountMcp` convention
 * for adapter setup that needs async work.
 */
export async function mountMesh(
  glove: MeshMountTarget,
  config: MountMeshConfig,
): Promise<void> {
  const { adapter, identity } = config;
  const supportsEvents = typeof glove.emitEvent === "function" && typeof glove.addContextProvider === "function";
  const delivery = config.delivery ?? "inbox";
  if (delivery === "events" && !supportsEvents) {
    throw new Error("glove-mesh event delivery needs a runnable with emitEvent and addContextProvider (glove-core >=4.4). Use delivery: \"inbox\" otherwise.");
  }

  let waits: PendingWaits;
  let deliver: (msg: IncomingMeshMessage) => Promise<void>;

  if (delivery === "events") {
    const eventWaits = new EventWaits();
    waits = eventWaits;
    // The reminder is read on every model call so it disappears the moment
    // the ack or reply arrives, mid-loop included.
    glove.addContextProvider!(() => eventWaits.render(), { delivery: "iteration" });
    deliver = async (msg) => {
      const peerName = await peerNameOrId(adapter, msg.from);
      if (msg.kind === "ack") {
        // An ack is only news when it ends one of our blocking sends.
        if (!msg.ack_of || !(await eventWaits.resolve(msg.ack_of))) return;
        await glove.emitEvent!(eventFromAck(msg, peerName, config.whenIdle));
        return;
      }
      // Reply-implies-ack: a direct reply to a blocking send ends the wait.
      if (msg.kind === "direct" && msg.in_reply_to) await eventWaits.resolve(msg.in_reply_to);
      await glove.emitEvent!(eventFromIncoming(msg, peerName, config.whenIdle));
    };
  } else {
    const store = glove.store;
    assertInboxCapable(store);
    const pending: PendingMap = new Map();
    waits = inboxWaits(store, pending);
    deliver = async (msg) => {
      if (msg.kind === "ack") {
        if (!msg.ack_of) return;
        await waits.resolve(msg.ack_of, msg.ack_note ?? "acknowledged");
        return;
      }

      // direct or broadcast — surface as resolved inbox item
      const peerName = await peerNameOrId(adapter, msg.from);
      const item = buildInboxItemFromIncoming(msg, peerName);
      await store.addInboxItem(item);

      // Reply-implies-ack: a direct message in_reply_to one of our pending
      // blocking sends also resolves that pending item.
      if (msg.kind === "direct" && msg.in_reply_to) {
        await waits.resolve(msg.in_reply_to, msg.content);
      }
    };
  }

  const ctx: ToolContext = { adapter, identity, waits };

  // Subscribe BEFORE registering. On distributed transports, peers can
  // discover and message us the instant `register` resolves; if the inbound
  // handler isn't installed yet, those messages are dropped on the floor.
  // The in-memory adapter doesn't race (single-threaded) but consistency
  // beats accidentally relying on adapter implementation details.
  adapter.subscribe(async (msg: IncomingMeshMessage) => {
    try {
      await deliver(msg);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[glove-mesh] inbound handler failed:", err);
    }
  });

  await adapter.register(identity);

  glove.fold(buildMeshSendTool(ctx));
  glove.fold(buildMeshBroadcastTool(ctx));
  glove.fold(buildMeshListAgentsTool(ctx));
  glove.fold(buildMeshAcknowledgeTool(ctx));
}
