import { z } from "zod";
import { documents } from "../../lib/corpus.js";

export const searchDocuments = {
  name: "search_documents",
  description: "Search the demo vendor briefs. An empty query lists all documents.",
  inputSchema: z.object({ query: z.string() }),
  async do({ query }: { query: string }) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = documents.filter((doc) => !words.length || words.some((word) => `${doc.title} ${doc.text}`.toLowerCase().includes(word)));
    return { status: "success" as const, data: matches.map(({ id, title }) => ({ id, title })) };
  },
};
