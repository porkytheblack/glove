import type { StdlibAdapter } from "glove-working-environment";

export interface LoadedSkill {
  name: string;
  summary: string;
  body: string;
  source: string;
}

export interface SkillSourceAdapter {
  identifier: string;
  load(packs: readonly string[], signal?: AbortSignal): Promise<LoadedSkill[]>;
}

const ALLOWED_PACK = /^[a-z][a-z0-9-]{1,50}$/;
const RAW = "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main";
const API = "https://api.github.com/repos/anthropics/knowledge-work-plugins/git/trees/main?recursive=1";

function frontmatter(body: string, key: string): string | undefined {
  const header = /^---\s*\n([\s\S]*?)\n---/.exec(body)?.[1];
  return header?.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
}

export function knowledgeWorkSkills(options: { fetch?: typeof globalThis.fetch } = {}): SkillSourceAdapter {
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    identifier: "anthropic-knowledge-work-plugins",
    async load(packs, signal) {
      const selected = [...new Set(packs)].filter((pack) => ALLOWED_PACK.test(pack));
      if (selected.length === 0) return [];
      const treeResponse = await fetcher(API, { signal, headers: { accept: "application/vnd.github+json" } });
      if (!treeResponse.ok) throw new Error(`Knowledge skill index returned ${treeResponse.status}.`);
      const tree = (await treeResponse.json()) as { tree?: Array<{ path?: string; type?: string }> };
      const paths = (tree.tree ?? [])
        .map((entry) => entry.path ?? "")
        .filter((path) => selected.some((pack) => path.startsWith(`${pack}/skills/`)) && path.endsWith("/SKILL.md"));
      const loaded = await Promise.all(paths.map(async (path) => {
        const response = await fetcher(`${RAW}/${path}`, { signal });
        if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
        const body = await response.text();
        const fallback = path.split("/").at(-2) ?? "skill";
        return {
          name: `knowledge-${path.split("/")[0]}-${frontmatter(body, "name") ?? fallback}`,
          summary: frontmatter(body, "description") ?? `Knowledge-work guidance from ${path}.`,
          body: `> Source: anthropics/knowledge-work-plugins (${path}, Apache-2.0)\n\n${body}`,
          source: path,
        } satisfies LoadedSkill;
      }));
      return loaded;
    },
  };
}

export const braindNativeSkills: LoadedSkill[] = [
  {
    name: "braind-creative-contract",
    summary: "Turn a loose brand ask into a decision-ready creative contract.",
    source: "braind-storm/native",
    body: "# Creative contract\nName the audience tension, desired change, single promise, proof, personality, constraints, and the decision the work must unlock. Separate facts from hypotheses. Preserve dissent until the final synthesis.",
  },
  {
    name: "braind-pressure-test",
    summary: "Evaluate distinctiveness, clarity, credibility, adaptability, and execution risk.",
    source: "braind-storm/native",
    body: "# Pressure test\nScore the work on distinctiveness, clarity, credibility, memorability, channel adaptability, and execution risk. Cite the artifact being evaluated. Give one keep, one kill, and one experiment.",
  },
];

export async function loadSkillSet(
  packs: readonly string[],
  options: { source?: SkillSourceAdapter; signal?: AbortSignal; remote?: boolean } = {},
): Promise<LoadedSkill[]> {
  if (options.remote === false) return braindNativeSkills;
  try {
    const remote = await (options.source ?? knowledgeWorkSkills()).load(packs, options.signal);
    return [...braindNativeSkills, ...remote];
  } catch {
    return braindNativeSkills;
  }
}

export function skillAdapter(skills: readonly LoadedSkill[]): StdlibAdapter {
  return {
    name: "brand_knowledge",
    description: "Read-only brand, campaign, content, and go-to-market working methods.",
    types: "export {};",
    create: () => ({}),
    skills: skills.map(({ name, summary, body }) => ({ name, summary, body })),
  };
}
