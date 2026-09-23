import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { operatorMemory } from "../../../lib/memory.js";

export default defineMemory({
  description: "Durable scoped context, episodic recall, known items and resource notes",
  context: { adapter: context => Effect.sync(() => operatorMemory(context).context) },
  entity: { access: "curator", tools: { allow: ["find", "get", "add_node", "update_node"] }, adapter: context => Effect.sync(() => operatorMemory(context).entity) },
  episodic: { access: "curator", tools: { allow: ["find", "search", "record"] }, adapter: context => Effect.sync(() => operatorMemory(context).episodic) },
  resources: { access: "curator", tools: { allow: ["ls", "read", "grep", "write", "edit"] }, adapter: context => Effect.sync(() => operatorMemory(context).resources) },
});
