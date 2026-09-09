import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import {
  InMemoryContextAdapter,
  InMemoryEntityAdapter,
  InMemoryEpisodicAdapter,
  InMemoryResourcesAdapter,
} from "glove-memory/in-memory";
import { z } from "zod";

const schema = new MemorySchema()
  .defineNodeClass({
    name: "Person",
    schema: z.object({ name: z.string(), notes: z.string().optional() }),
    identityKeys: [["name"]],
    searchableProperties: ["name", "notes"],
  })
  .defineNodeClass({
    name: "Project",
    schema: z.object({ name: z.string(), status: z.string().optional() }),
    identityKeys: [["name"]],
    searchableProperties: ["name", "status"],
  })
  .defineRelationship({ type: "worksOn", from: "Person", to: "Project" })
  .defineEpisodeKind({ name: "interaction", description: "A useful interaction or decision." })
  .defineEpisodeKind({ name: "lesson", description: "A reusable lesson learned while working." })
  .defineResourceRoot({ path: "/notes", description: "Long-lived notes and learned procedures." });

const entity = new InMemoryEntityAdapter({ schema, identifier: "hermes-entity-memory" });
const episodic = new InMemoryEpisodicAdapter({
  schema,
  identifier: "hermes-episodic-memory",
  fuzzySearch: true,
});
const resources = new InMemoryResourcesAdapter({ schema, identifier: "hermes-resource-memory" });
const context = new InMemoryContextAdapter({ schema, identifier: "hermes-context-memory" });

const personal = defineMemory({
  description: "Curated person, project, episodic, resource, and ambient context memory",
  entity: { access: "curator", adapter: () => Effect.succeed(entity) },
  episodic: { access: "curator", adapter: () => Effect.succeed(episodic) },
  resources: { access: "curator", adapter: () => Effect.succeed(resources) },
  context: { adapter: () => Effect.succeed(context) },
});

export default personal;
