import { Effect } from "effect";
import { defineApp } from "glove-foundry";
import { z } from "zod";

/** Spreadsheets. your code: Google Sheets. Here, one sample sheet of signups. */
export default defineApp({
  description: "Read rows from a spreadsheet",
  install: () => Effect.succeed({
    tools: [{
      name: "read_sheet",
      description: "Read the rows of a sheet by name.",
      inputSchema: z.object({ sheet: z.string() }),
      async do({ sheet }: { readonly sheet: string }) {
        const rows = sheet.toLowerCase().includes("signup")
          ? [
              { name: "Dana Lee", email: "dana@example.com", company: "Northwind", signedUp: "2026-10-20" },
              { name: "Ravi Patel", email: "ravi@example.com", company: "Globex", signedUp: "2026-10-22" },
            ]
          : [];
        return { status: "success" as const, data: { sheet, rows } };
      },
    }],
  }),
});
