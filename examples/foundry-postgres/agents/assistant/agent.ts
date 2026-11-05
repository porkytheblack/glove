import { defineAgent } from "glove-foundry";
import { pool } from "../../lib/db.js";
import { EchoModel } from "../../lib/echo-model.js";
import { PostgresStore } from "../../src/postgres-store.js";

export default defineAgent({
  description: "An assistant whose runtime data and transcripts live in PostgreSQL",
  systemPrompt: "Answer briefly.",
  model: () => new EchoModel(),
  store: ({ conversationId }) => new PostgresStore(pool, conversationId),
});
