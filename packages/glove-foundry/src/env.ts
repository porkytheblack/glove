import { readFile } from "node:fs/promises";

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  const comment = trimmed.indexOf(" #");
  return comment >= 0 ? trimmed.slice(0, comment).trim() : trimmed;
}

export async function loadEnvFile(path: string): Promise<void> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7) : line;
    const equals = normalized.indexOf("=");
    if (equals <= 0) continue;
    const name = normalized.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    if (process.env[name] === undefined) {
      process.env[name] = unquote(normalized.slice(equals + 1));
    }
  }
}
