import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ContentSkill } from "./content-skills";

/**
 * Load Claude Code-style content skills from a directory.
 *
 * Expected layout (matches Claude Code's `.claude/skills/<name>/` convention):
 *
 *   <skillsRoot>/
 *     python-debug/
 *       SKILL.md            ← main content. Optional YAML frontmatter (name, description).
 *       api-reference.md    ← becomes section "api-reference"
 *       examples.md         ← becomes section "examples"
 *     git-workflow/
 *       SKILL.md
 *
 * The directory name is the default skill name; YAML frontmatter overrides
 * it. Sibling `.md` files (other than `SKILL.md`) become sections keyed by
 * filename without the `.md` extension.
 *
 * Returns a `ContentSkill[]` ready to feed into `useReadSkill(glove, skills)`.
 * This module is Node-only — import from `glove-core/content-skills-fs`,
 * not from the main entry, so browser bundles don't pull in `node:fs`.
 */
export async function loadContentSkillsFromFs(
  skillsRoot: string,
  options: LoadContentSkillsOptions = {},
): Promise<ContentSkill[]> {
  const mainFile = options.mainFile ?? "SKILL.md";
  const sectionExtensions = options.sectionExtensions ?? [".md"];

  const entries = await readDirSafe(skillsRoot);
  const skills: ContentSkill[] = [];

  for (const name of entries) {
    const skillDir = path.join(skillsRoot, name);
    const dirStat = await statSafe(skillDir);
    if (!dirStat?.isDirectory()) continue;

    const mainPath = path.join(skillDir, mainFile);
    const mainBody = await readFileSafe(mainPath);
    if (mainBody == null) continue; // no SKILL.md → not a skill

    const { meta, body } = parseFrontmatter(mainBody);
    const skillName = meta.name?.trim() || name;
    const description = (meta.description ?? "").trim() || `Skill loaded from ${path.relative(skillsRoot, skillDir) || skillDir}.`;

    const sections: Record<string, string> = {};
    const dirChildren = await readDirSafe(skillDir);
    for (const child of dirChildren) {
      if (child === mainFile) continue;
      const ext = path.extname(child);
      if (!sectionExtensions.includes(ext)) continue;
      const childPath = path.join(skillDir, child);
      const childStat = await statSafe(childPath);
      if (!childStat?.isFile()) continue;
      const sectionName = path.basename(child, ext);
      const body = await readFileSafe(childPath);
      if (body != null) sections[sectionName] = body;
    }

    const priority = typeof meta.priority === "string" ? Number(meta.priority) : NaN;

    skills.push({
      name: skillName,
      description,
      path: skillDir,
      content: body,
      sections: Object.keys(sections).length > 0 ? sections : undefined,
      priority: Number.isNaN(priority) ? undefined : priority,
      hidden: meta.hidden === "true",
    });
  }

  return skills;
}

export interface LoadContentSkillsOptions {
  /** Filename to treat as the main body. Default: `SKILL.md`. */
  mainFile?: string;
  /** Sibling file extensions to load as sections. Default: `[".md"]`. */
  sectionExtensions?: string[];
}

// ─── Minimal YAML frontmatter parser ──────────────────────────────────────
// Only handles the subset Claude Code skills use: `key: value` pairs at the
// top of the file, delimited by `---` lines. Values are strings (whitespace-
// trimmed); no nesting, no lists, no quote unescaping. If the frontmatter is
// malformed, returns the original body and an empty meta map.

interface ParsedFrontmatter {
  meta: Record<string, string>;
  body: string;
}

function parseFrontmatter(text: string): ParsedFrontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { meta: {}, body: text };

  const meta: Record<string, string> = {};
  let cursor = 1;
  while (cursor < lines.length && lines[cursor].trim() !== "---") {
    const line = lines[cursor];
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) meta[key] = stripQuotes(value);
    }
    cursor += 1;
  }
  // If we hit EOF without seeing the closing `---`, treat as no frontmatter.
  if (cursor >= lines.length) return { meta: {}, body: text };

  const body = lines.slice(cursor + 1).join("\n").replace(/^\n+/, "");
  return { meta, body };
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

// ─── FS helpers that swallow ENOENT etc. ──────────────────────────────────

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function readFileSafe(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function statSafe(p: string): Promise<{ isDirectory(): boolean; isFile(): boolean } | null> {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}
