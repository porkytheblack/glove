import { z } from "zod";
import type { ServerSpec } from "../spec";
import type { World } from "../seed";

const lc = (v: unknown) => String(v ?? "").toLowerCase();

export function filesystemServer(world: World): ServerSpec {
  const cols = [
    { name: "path", type: "text" },
    { name: "size", type: "bigint", description: "bytes" },
    { name: "modified", type: "timestamptz" },
    { name: "type", type: "text" },
    { name: "lines", type: "bigint" },
  ];
  return {
    namespace: "filesystem",
    title: "Filesystem",
    tools: [
      {
        name: "list_files",
        description: "List files, optionally under a directory prefix.",
        readOnly: true,
        input: { prefix: z.string().optional() },
        handler: (a) => world.files.filter((f) => !a.prefix || lc(f.path).startsWith(lc(a.prefix))),
      },
      {
        name: "search_files",
        description: "Find files whose path contains a substring.",
        readOnly: true,
        input: { query: z.string() },
        handler: (a) => world.files.filter((f) => lc(f.path).includes(lc(a.query))),
      },
      {
        name: "read_file",
        description: "Read a file's metadata + a synthetic preview by path.",
        readOnly: true,
        input: { path: z.string() },
        handler: (a) => {
          const f = world.files.find((x) => lc(x.path) === lc(a.path));
          return f ? { ...f, preview: `// ${f.path}\n// ${f.lines} lines` } : null;
        },
      },
    ],
    entities: [
      {
        table: "files",
        description: "Repository files. SELECT filters by path prefix/substring via WHERE.",
        volatility: "stable",
        columns: cols,
        select: { tool: "list_files", args: (b) => ({ ...(b.has("prefix") && { prefix: b.one("prefix") }) }) },
      },
    ],
  };
}
