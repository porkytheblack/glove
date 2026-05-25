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
 * Loose target type — anything exposing `fold` for tool registration and a
 * readonly `store` for inbox writes. `IGloveRunnable` satisfies this, and
 * minimal stubs in tests do too without depending on the full runnable.
 */
export type MeshMountTarget = {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
  readonly store: StoreAdapter;
};

export interface MountMeshConfig {
  /** Per-agent adapter. Implements registration, transport, and inbound subscription. */
  adapter: MeshAdapter;
  /** This agent's identity, announced to the network on mount. */
  identity: AgentIdentity;
}

/**
 * Wire a Glove agent onto a mesh network.
 *
 * On call:
 *   1. Validates the glove's store supports inbox methods (throws otherwise).
 *   2. Registers this agent's identity with the adapter.
 *   3. Subscribes a single inbound handler. Incoming messages land in this
 *      agent's inbox as resolved items; the existing inbox-injection path
 *      surfaces them on the next ask() turn.
 *   4. Folds four mesh tools onto the glove: glove_mesh_send_message,
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
  const store = glove.store;

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
