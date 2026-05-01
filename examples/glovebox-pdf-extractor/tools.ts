import { execFile } from "node:child_process";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GloveFoldArgs, ToolResultData } from "glove-core";

// ─── shell helper ─────────────────────────────────────────────────────────

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

function run(bin: string, args: string[], opts?: { timeout?: number }): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        timeout: opts?.timeout ?? 60_000,
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        // execFile callback args are typed as string|Buffer; coerce defensively.
        const out = typeof stdout === "string" ? stdout : String(stdout ?? "");
        const err = typeof stderr === "string" ? stderr : String(stderr ?? "");
        const codeRaw = (error as unknown as { code?: number | string } | null)?.code;
        const code = typeof codeRaw === "number" ? codeRaw : error ? 1 : 0;
        resolve({ stdout: out, stderr: err, code });
      },
    );
  });
}

// ─── filesystem layout ───────────────────────────────────────────────────
// At runtime inside the glovebox the developer's `fs` config decides these.
// We accept overrides so the same module is usable from `dev.ts` (where
// /input and /output may not exist) and from a real glovebox container.

export interface ToolPaths {
  input: string;
  output: string;
  work: string;
}

export const DEFAULT_PATHS: ToolPaths = {
  input: "/input",
  output: "/output",
  work: "/work",
};

function resolveInput(paths: ToolPaths, name: string): string {
  // Reject path traversal — every input must live directly under /input.
  if (name.includes("/") || name.includes("..")) {
    throw new Error(`invalid input file name: ${name}`);
  }
  return path.join(paths.input, name);
}

async function ensureExists(p: string): Promise<void> {
  try {
    await stat(p);
  } catch {
    throw new Error(`file not found: ${p}`);
  }
}

// ─── extract_text ─────────────────────────────────────────────────────────

const extractTextInput = z.object({
  file: z.string().describe("Name of the PDF file in /input (e.g. 'sample.pdf')."),
  first_page: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("First page to extract (1-indexed). Omit to start from page 1."),
  last_page: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Last page to extract (inclusive). Omit to read to the end."),
});

export function extractTextTool(paths: ToolPaths = DEFAULT_PATHS): GloveFoldArgs<z.infer<typeof extractTextInput>> {
  return {
    name: "extract_text",
    description:
      "Extract plain text from a PDF in /input using pdftotext (poppler-utils). Writes the result to /output as <basename>.txt and returns a short preview.",
    inputSchema: extractTextInput,
    async do(input): Promise<ToolResultData> {
      try {
        const src = resolveInput(paths, input.file);
        await ensureExists(src);

        const baseName = path.basename(input.file, path.extname(input.file));
        const dst = path.join(paths.output, `${baseName}.txt`);

        const args: string[] = ["-layout", "-enc", "UTF-8"];
        if (input.first_page) args.push("-f", String(input.first_page));
        if (input.last_page) args.push("-l", String(input.last_page));
        args.push(src, dst);

        const r = await run("pdftotext", args);
        if (r.code !== 0) {
          return {
            status: "error",
            data: null,
            message: `pdftotext exited ${r.code}: ${r.stderr.trim() || "(no stderr)"}`,
          };
        }

        const text = await readFile(dst, "utf8");
        const preview = text.length > 1500 ? `${text.slice(0, 1500)}\n…[truncated, full text in ${path.basename(dst)}]` : text;

        return {
          status: "success",
          data: {
            output_file: path.basename(dst),
            char_count: text.length,
            preview,
          },
        };
      } catch (err) {
        return {
          status: "error",
          data: null,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

// ─── extract_metadata ─────────────────────────────────────────────────────

const extractMetadataInput = z.object({
  file: z.string().describe("Name of the PDF file in /input."),
});

interface QpdfPage {
  // qpdf --json emits richer structure; we only consume what we need.
  object?: unknown;
}

interface QpdfJson {
  pages?: QpdfPage[];
  outlines?: unknown[];
  parameters?: Record<string, unknown>;
  qpdf?: unknown;
}

export function extractMetadataTool(
  paths: ToolPaths = DEFAULT_PATHS,
): GloveFoldArgs<z.infer<typeof extractMetadataInput>> {
  return {
    name: "extract_metadata",
    description:
      "Run `qpdf --json --no-original-object-ids` on a PDF in /input to extract structural metadata (page count, outline, encryption flags). Writes a summary JSON to /output.",
    inputSchema: extractMetadataInput,
    async do(input): Promise<ToolResultData> {
      try {
        const src = resolveInput(paths, input.file);
        await ensureExists(src);

        const r = await run("qpdf", ["--json", "--no-original-object-ids", src]);
        if (r.code !== 0) {
          return {
            status: "error",
            data: null,
            message: `qpdf exited ${r.code}: ${r.stderr.trim() || "(no stderr)"}`,
          };
        }

        let parsed: QpdfJson;
        try {
          parsed = JSON.parse(r.stdout) as QpdfJson;
        } catch (err) {
          return {
            status: "error",
            data: null,
            message: `failed to parse qpdf JSON: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        const pageCount = Array.isArray(parsed.pages) ? parsed.pages.length : 0;
        const outlineLength = Array.isArray(parsed.outlines) ? parsed.outlines.length : 0;

        const baseName = path.basename(input.file, path.extname(input.file));
        const dst = path.join(paths.output, `${baseName}.metadata.json`);

        const summary = {
          source: input.file,
          page_count: pageCount,
          outline_entries: outlineLength,
          parameters: parsed.parameters ?? {},
        };

        const { writeFile } = await import("node:fs/promises");
        await writeFile(dst, JSON.stringify(summary, null, 2), "utf8");

        return {
          status: "success",
          data: {
            output_file: path.basename(dst),
            page_count: pageCount,
            outline_entries: outlineLength,
          },
        };
      } catch (err) {
        return {
          status: "error",
          data: null,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

// ─── split_pages ──────────────────────────────────────────────────────────

const splitPagesInput = z.object({
  file: z.string().describe("Name of the PDF file in /input."),
  range: z
    .string()
    .regex(/^\d+(-\d+)?$/, "Use a single page number or a hyphenated range like '3-7'.")
    .describe("Page range to extract, e.g. '1', '3-7'."),
  out_name: z
    .string()
    .optional()
    .describe(
      "Filename for the split output. Defaults to '<basename>-pages-<range>.pdf'. Written to /work; tag with the `output` hook to exfiltrate.",
    ),
});

export function splitPagesTool(paths: ToolPaths = DEFAULT_PATHS): GloveFoldArgs<z.infer<typeof splitPagesInput>> {
  return {
    name: "split_pages",
    description:
      "Use pdftk to extract a page range from a PDF in /input. Writes the split PDF to /work by default — tell the user to invoke `/output <path>` (or pass out_to_output: true) when they want to exfiltrate it.",
    inputSchema: splitPagesInput,
    async do(input): Promise<ToolResultData> {
      try {
        const src = resolveInput(paths, input.file);
        await ensureExists(src);

        const baseName = path.basename(input.file, path.extname(input.file));
        const safeRange = input.range.replace(/[^\d-]/g, "");
        const fileName = input.out_name ?? `${baseName}-pages-${safeRange}.pdf`;
        // Default to /work (sandboxed scratch); the /output hook exfiltrates.
        const dst = path.join(paths.work, fileName);

        const r = await run("pdftk", [src, "cat", input.range, "output", dst]);
        if (r.code !== 0) {
          return {
            status: "error",
            data: null,
            message: `pdftk exited ${r.code}: ${r.stderr.trim() || "(no stderr)"}`,
          };
        }

        const s = await stat(dst);
        return {
          status: "success",
          data: {
            output_file: dst,
            size_bytes: s.size,
            note: "File written to /work. Use the `output` hook (`/output <path>`) to exfiltrate it.",
          },
        };
      } catch (err) {
        return {
          status: "error",
          data: null,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

