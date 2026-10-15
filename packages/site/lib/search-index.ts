// The search index behind ⌘K. Built from the same nav trees the sidebars
// render, plus the blog index, so every page is findable the moment it is
// registered — no separate list to keep in sync.

import { posts } from "./blog";
import { docsSections } from "./docs-nav";
import { foundrySections } from "./foundry-nav";

export type SearchKind = "foundry" | "docs" | "blog" | "page";

export interface SearchEntry {
  href: string;
  title: string;
  summary: string;
  /** Section or collection shown beside the title. */
  group: string;
  kind: SearchKind;
  /** Extra terms that should match but are not displayed. */
  keywords: string;
}

// Words people type that do not appear in titles or summaries.
const synonyms: Record<string, string> = {
  "/foundry/docs/openai-compatible": "openai sdk chat completions responses compatible v1 api langchain",
  "/foundry/docs/runtime": "http rest endpoints client sdk createFoundryClient api run handle sse events",
  "/foundry/docs/approvals": "human in the loop permission approve deny confirm redirect interrupt cancel",
  "/foundry/docs/automation": "cron timer setTimeout recurring wake later webhook trigger background spawn",
  "/foundry/docs/persistence": "database postgres sqlite durable restart storage save store",
  "/foundry/docs/deploy": "production docker hosting auth security tls health",
  "/foundry/docs/capabilities": "defineSharedTool defineMcp defineMemory install installation layer subscriber",
  "/foundry/docs/applications": "telegram slack whatsapp email integration webhook defineApp defineTransmission credentials oauth",
  "/foundry/docs/composition": "defineAgent resolver lazy context configure build run",
  "/foundry/docs/project-structure": "files folders conventions routes ids eslint config",
  "/foundry/docs/observability": "inspector dashboard trace logs debug webchat chat ui events",
  "/foundry/docs/faq": "troubleshooting error problem missing tool not working",
  "/foundry/docs/nextjs": "next.js react frontend app router",
  "/foundry/docs/tutorial": "walkthrough guide example first support agent",
  "/docs/getting-started": "quickstart tutorial hello world",
  "/docs/display-stack": "ui render components generative ui pushAndWait pushAndForget",
  "/docs/mcp": "model context protocol notion gmail linear",
  "/docs/execution": "browser playwright steel docker sandbox computer use",
  "/docs/voice": "speech stt tts elevenlabs deepgram",
  "/docs/voice-architectures": "voice layered front agent worker speech tags realtime pipeline latency barge-in fast model",
  "/docs/goal-oriented-agents": "goals forms facts intake onboarding collect information questionnaire slot filling objective",
  "/docs/realtime-voice": "openai realtime gemini live livekit avatar",
  "/docs/memory": "remember recall knowledge graph rag",
  "/docs/code-execution": "repl eval javascript python lisp",
};

function build(): SearchEntry[] {
  const entries: SearchEntry[] = [
    {
      href: "/",
      title: "Glove home",
      summary: "The open-source TypeScript stack for agent systems.",
      group: "Site",
      kind: "page",
      keywords: "home landing",
    },
    {
      href: "/foundry",
      title: "Glove Foundry",
      summary: "The application framework for agent systems — what it is and what you get.",
      group: "Foundry",
      kind: "foundry",
      keywords: "framework product landing",
    },
    {
      href: "/docs",
      title: "Documentation home",
      summary: "Choose a path: Foundry, the Glove runtime, or individual capability packages.",
      group: "Docs",
      kind: "docs",
      keywords: "index start choose path",
    },
    {
      href: "/blog",
      title: "Blog",
      summary: "Design notes, release stories and benchmarks.",
      group: "Blog",
      kind: "blog",
      keywords: "posts articles",
    },
  ];

  for (const section of foundrySections) {
    for (const item of section.items) {
      entries.push({
        href: item.href,
        title: item.label,
        summary: item.summary,
        group: `Foundry · ${section.title}`,
        kind: "foundry",
        keywords: synonyms[item.href] ?? "",
      });
    }
  }

  for (const section of docsSections) {
    for (const item of section.items) {
      if (entries.some((entry) => entry.href === item.href)) continue;
      entries.push({
        href: item.href,
        title: item.label,
        summary: item.summary ?? section.blurb ?? "",
        group: `Docs · ${section.title}`,
        kind: "docs",
        keywords: [synonyms[item.href] ?? "", ...(item.packages ?? [])].join(" "),
      });
    }
  }

  for (const post of posts) {
    entries.push({
      href: `/blog/${post.slug}`,
      title: post.title,
      summary: post.summary,
      group: "Blog",
      kind: "blog",
      keywords: post.tags.join(" "),
    });
  }

  return entries;
}

export const searchIndex: SearchEntry[] = build();

/**
 * Every query token must appear somewhere in the entry; titles weigh most,
 * then keywords, then the summary. Ties keep index order (Foundry, docs, blog).
 */
export function searchEntries(query: string, limit = 12): SearchEntry[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: { entry: SearchEntry; score: number; index: number }[] = [];
  searchIndex.forEach((entry, index) => {
    const title = entry.title.toLowerCase();
    const summary = entry.summary.toLowerCase();
    const keywords = `${entry.keywords} ${entry.group} ${entry.href}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (title.startsWith(token)) score += 12;
      else if (title.includes(token)) score += 8;
      else if (keywords.includes(token)) score += 4;
      else if (summary.includes(token)) score += 2;
      else return;
    }
    scored.push({ entry, score, index });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.entry);
}
