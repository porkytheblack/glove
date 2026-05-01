import { Glove, Displaymanager, createAdapter } from "glove-core";
import { SqliteStore } from "glove-sqlite";
import { extractTextTool, extractMetadataTool, splitPagesTool, type ToolPaths } from "./tools";

const SYSTEM_PROMPT = `You are a PDF extraction assistant running inside a Glovebox sandbox.

You have access to native tools (poppler-utils, qpdf, pdftk) for working with PDF files.
The user uploads a PDF as an input file (visible at /input/<name>.pdf) and you extract
text, structural metadata, or specific page ranges as requested.

## Tools
- extract_text: pdftotext-based plain text extraction. Writes <basename>.txt to /output.
- extract_metadata: qpdf --json structural inspection. Writes <basename>.metadata.json to /output.
- split_pages: pdftk page-range extraction. Writes to /work; the user must invoke
  the \`output\` hook (or you can mention it) to exfiltrate the split PDF.

## Workflow
1. Use the \`workspace\` skill to discover what files are in /input.
2. For each request, pick the smallest set of tools that answers it. Don't run
   metadata extraction if the user only asked for text.
3. Outputs written to /output are returned to the client automatically.
4. Files written to /work persist for the session but are NOT exfiltrated unless
   the user explicitly tags them with \`/output <path>\`.
5. When you finish, summarize what you produced and where it landed.

Be terse. The user is watching tool calls stream by — they don't need narration.`;

export interface BuildAgentOptions {
  /** Path to the SQLite database file. Defaults to /work/glove.db inside the box. */
  dbPath?: string;
  /** Session id. Defaults to a stable single-session id. */
  sessionId?: string;
  /** Filesystem layout — defaults to /input, /output, /work as declared in glovebox.ts. */
  paths?: ToolPaths;
}

export function buildAgent(opts: BuildAgentOptions = {}) {
  const store = new SqliteStore({
    dbPath: opts.dbPath ?? "/work/glove.db",
    sessionId: opts.sessionId ?? "default",
  });

  const model = createAdapter({ provider: "anthropic", stream: true });

  const builder = new Glove({
    store,
    model,
    displayManager: new Displaymanager(),
    systemPrompt: SYSTEM_PROMPT,
    serverMode: true,
    compaction_config: {
      compaction_instructions:
        "Summarize the conversation. Preserve: input file names, output file names, page ranges extracted, errors encountered.",
    },
  });

  builder.fold(extractTextTool(opts.paths));
  builder.fold(extractMetadataTool(opts.paths));
  builder.fold(splitPagesTool(opts.paths));

  return builder.build();
}

// The wrap module exports this as the runnable.
export const agent = buildAgent();
