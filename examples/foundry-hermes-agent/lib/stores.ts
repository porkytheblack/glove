import { MemoryStore } from "glove-core";

const conversations = new Map<string, MemoryStore>();

export function hermesConversationStore(scope: { readonly conversationId: string }) {
  let store = conversations.get(scope.conversationId);
  if (!store) {
    store = new MemoryStore(`foundry-hermes:${scope.conversationId}`);
    conversations.set(scope.conversationId, store);
  }
  return store;
}
