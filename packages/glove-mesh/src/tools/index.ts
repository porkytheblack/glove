import type { GloveFoldArgs, StoreAdapter } from "glove-core";
import type { MeshAdapter } from "../core/adapter";
import type { AgentIdentity, IncomingMeshMessage } from "../core/types";
import {
  assertInboxCapable,
  buildInboxItemFromIncoming,
  peerNameOrId,
  resolvePendingFor,
  type PendingMap,
  type ToolContext,
} from "./common";
import { buildMeshSendTool } from "./send";
import { buildMeshBroadcastTool } from "./broadcast";
import { buildMeshListAgentsTool } from "./list";
import { buildMeshAcknowledgeTool } from "./acknowledge";

export { buildMeshSendTool } from "./send";
export { buildMeshBroadcastTool } from "./broadcast";
export { buildMeshListAgentsTool } from "./list";
export { buildMeshAcknowledgeTool } from "./acknowledge";

/**
 * Anything that exposes `glove-core`'s `fold`. Matches the loose target type
 * used by glove-memory's `useMemoryReader` so callers can pass either a
 * still-building Glove or a runnable Glove and keep their concrete type.
 */
export type FoldTarget = {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
};

export interface MountMeshConfig {
  /** Per-agent adapter. Implements registration, transport, and inbound subscription. */
  adapter: MeshAdapter;
  /** This agent's identity, announced to the network on mount. */
  identity: AgentIdentity;
  /**
   * The same StoreAdapter passed to `new Glove({ store })`. Required because
   * `IGloveRunnable` does not expose the store and tools' third argument is
   * the glove itself, not the store — so mesh has no other path to write
   * resolved inbox items into the recipient's history.
   *
   * Must implement all four inbox methods: getInboxItems, addInboxItem,
   * updateInboxItem, getResolvedInboxItems. Throws MeshStoreUnsupportedError
   * otherwise.
   */
  store: StoreAdapter;
}

/**
 * Wire a Glove agent onto a mesh network.
 *
 * On call:
 *   1. Validates the store supports inbox methods (throws otherwise).
 *   2. Registers this agent's identity with the adapter.
 *   3. Subscribes a single inbound handler. Incoming messages land in this
 *      agent's inbox as resolved items; the existing inbox-injection path
 *      surfaces them on the next ask() turn.
 *   4. Folds four mesh tools onto the glove: mesh_send_message,
 *      mesh_broadcast, mesh_list_agents, mesh_acknowledge.
 *
 * Not chainable (returns Promise<void>); follows the `mountMcp` convention
 * for adapter setup that needs async work.
 */
export async function mountMesh(
  glove: FoldTarget,
  config: MountMeshConfig,
): Promise<void> {
  const { adapter, identity, store } = config;

  assertInboxCapable(store);

  const pending: PendingMap = new Map();

  const ctx: ToolContext = {
    adapter,
    identity,
    store,
    pending,
  };

  await adapter.register(identity);

  adapter.subscribe(async (msg: IncomingMeshMessage) => {
    try {
      if (msg.kind === "ack") {
        if (!msg.ack_of) return;
        await resolvePendingFor(
          msg.ack_of,
          msg.ack_note ?? "acknowledged",
          store,
          pending,
        );
        return;
      }

      // direct or broadcast — surface as resolved inbox item
      const peerName = await peerNameOrId(adapter, msg.from);
      const item = buildInboxItemFromIncoming(msg, peerName);
      await store.addInboxItem(item);

      // Reply-implies-ack: a direct message in_reply_to one of our pending
      // blocking sends also resolves that pending item.
      if (msg.kind === "direct" && msg.in_reply_to) {
        await resolvePendingFor(msg.in_reply_to, msg.content, store, pending);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[glove-mesh] inbound handler failed:", err);
    }
  });

  glove.fold(buildMeshSendTool(ctx));
  glove.fold(buildMeshBroadcastTool(ctx));
  glove.fold(buildMeshListAgentsTool(ctx));
  glove.fold(buildMeshAcknowledgeTool(ctx));
}
