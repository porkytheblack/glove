import { EMPTY_VISIT, visitKey, type Visit } from "../../../lib/bag";
import { SHOP } from "../../../lib/shop";
import { foundry } from "./foundry";

/** A conversation's bag and orders, read from the shop's workspace. */
export async function visitOf(conversationId: string): Promise<Visit> {
  const entries = await foundry().workspaceEntries(SHOP.workspaceId);
  return (entries.find((entry) => entry.key === visitKey(conversationId))?.value as Visit | undefined) ?? EMPTY_VISIT;
}
