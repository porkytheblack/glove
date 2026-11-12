import { Effect } from "effect";
import type { FoundryDataAdapter } from "glove-foundry";
import { EMPTY_BAG, bagKey, ordersKey, type Bag, type Order } from "./bag.js";

// Reads and writes of a conversation's bag and orders, from inside a run.

export async function readBag(data: FoundryDataAdapter, workspaceId: string, conversationId: string): Promise<Bag> {
  const entry = await Effect.runPromise(data.getWorkspaceEntry(workspaceId, bagKey(conversationId)));
  return (entry?.value as Bag | undefined) ?? EMPTY_BAG;
}

export async function writeBag(data: FoundryDataAdapter, workspaceId: string, conversationId: string, bag: Bag): Promise<void> {
  await Effect.runPromise(data.putWorkspaceEntry({
    workspaceId,
    key: bagKey(conversationId),
    value: bag,
    updatedAt: new Date().toISOString(),
  }));
}

export async function readOrders(data: FoundryDataAdapter, workspaceId: string, conversationId: string): Promise<Order[]> {
  const entry = await Effect.runPromise(data.getWorkspaceEntry(workspaceId, ordersKey(conversationId)));
  return (entry?.value as Order[] | undefined) ?? [];
}

export async function writeOrders(data: FoundryDataAdapter, workspaceId: string, conversationId: string, orders: Order[]): Promise<void> {
  await Effect.runPromise(data.putWorkspaceEntry({
    workspaceId,
    key: ordersKey(conversationId),
    value: orders,
    updatedAt: new Date().toISOString(),
  }));
}
