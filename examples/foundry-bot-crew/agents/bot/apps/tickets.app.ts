import { Effect } from "effect";
import { defineApp } from "glove-foundry";
import { z } from "zod";
import { entries, record } from "../../../lib/ledger.js";

/** An issue tracker. your code: Linear, Jira or GitHub Issues. */
export default defineApp({
  description: "File tickets in the issue tracker",
  install: () => Effect.succeed({
    tools: [{
      name: "file_ticket",
      description: "File a ticket with the steps that reproduce the problem.",
      inputSchema: z.object({ title: z.string(), steps: z.array(z.string()).min(1) }),
      async do(ticket: { readonly title: string; readonly steps: ReadonlyArray<string> }) {
        const id = `T-${(await entries("ticket")).length + 1}`;
        await record({ kind: "ticket", id, ...ticket });
        return { status: "success" as const, data: { ticket: id } };
      },
    }],
  }),
});
