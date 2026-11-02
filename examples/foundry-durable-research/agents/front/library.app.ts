import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import { defineApp } from "glove-foundry";
import { z } from "zod";
import { documents } from "../../lib/corpus.js";
import { dataPath } from "../../lib/paths.js";

export default defineApp({
  description: "Read demo source documents and save workspace notes",
  install: ({ workspaceId }) => Effect.succeed({ tools: [
    {
      name: "read_document", description: "Read one vendor brief by document ID.",
      inputSchema: z.object({ id: z.string() }),
      async do({ id }: { id: string }) {
        // Optional latency for exercising a slow external service without calling one.
        const delay = Number(process.env.RESEARCH_DOCUMENT_DELAY_MS ?? 0);
        if (!Number.isFinite(delay) || delay < 0 || delay > 10_000) throw new Error("Document delay must be 0–10000 ms.");
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        const document = documents.find((doc) => doc.id === id);
        if (!document) return { status: "error" as const, data: null, message: "Document not found. Use search_documents to obtain an exact ID." };
        return { status: "success" as const, data: document };
      },
    },
    {
      name: "write_note", description: "Save a note for this workspace. Requires approval.",
      requiresPermission: true,
      inputSchema: z.object({ text: z.string() }),
      async do({ text }: { text: string }) {
        const namespace = createHash("sha256").update(workspaceId).digest("hex");
        const directory = dataPath("notes", namespace);
        await mkdir(directory, { recursive: true });
        await writeFile(`${directory}/note.txt`, text);
        return { status: "success" as const, data: { saved: true } };
      },
    },
  ] }),
});
