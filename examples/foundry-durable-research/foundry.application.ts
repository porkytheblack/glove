import { defineApplication, FileFoundryDataAdapter } from "glove-foundry";
import { FileStore } from "./lib/file-store.js";
import { dataPath } from "./lib/paths.js";

export default defineApplication({
  name: "durable-research",
  data: new FileFoundryDataAdapter({ file: dataPath("foundry.json") }),
  conversationStore: ({ conversationId }) => FileStore.open(conversationId),
});
