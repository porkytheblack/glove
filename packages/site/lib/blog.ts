// Single source of truth for the blog index.
//
// Each post is an ordinary page under app/blog/<slug>/page.tsx — same shape
// as the docs pages — and registers its metadata here so the index, the
// nav and any future feed all read from one list.

export interface BlogPost {
  slug: string;
  title: string;
  /** One-line summary — used on the index card and as the page description. */
  summary: string;
  /** ISO date. Sorted newest-first for display. */
  date: string;
  /** Rough read time in minutes. */
  readingTime: number;
  tags: string[];
}

export const posts: BlogPost[] = [
  {
    slug: "silent-failures",
    title: "Every failure in this one was silent",
    summary:
      "Building video rendering for agents — plus a fourth way to expose a capability, a verb for handing work over, and directories an agent may read but never edit. Six bugs that reported success, and what each one changed about the design.",
    date: "2026-08-07",
    readingTime: 12,
    tags: ["working-environment", "motion", "video", "engineering"],
  },
  {
    slug: "eight-new-packages",
    title: "Eight new packages",
    summary:
      "Realtime voice and avatars, agentic image generation, a working environment that can look at what it made, and memory that knows what to withhold.",
    date: "2026-08-07",
    readingTime: 9,
    tags: ["release", "voice", "images", "working-environment", "memory"],
  },
];

export const sortedPosts = [...posts].sort((a, b) => b.date.localeCompare(a.date));

export function getPost(slug: string): BlogPost | undefined {
  return posts.find((p) => p.slug === slug);
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
