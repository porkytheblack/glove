import type { Metadata } from "next";

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
    slug: "glove-from-a-to-z",
    title: "Glove from A to Z: Building agents from scratch",
    summary:
      "Start with a loop that calls a function, then add one piece at a time — only when something breaks. Every primitive in the framework, in the order it earns its place.",
    date: "2026-08-07",
    readingTime: 26,
    tags: ["guide", "code-execution", "memory", "realtime", "images"],
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

/**
 * Page metadata for a post, including the social card.
 *
 * The root layout sets `openGraph.title` / `twitter.title` to "Glove", and
 * those do NOT inherit the page's `title` — so a post shared to X, Slack or
 * LinkedIn would render a card headed "Glove" with no hint of what the link
 * actually is. Setting them per post is the fix, and it lives here so every
 * future post gets it by construction rather than by remembering.
 *
 * The card image stays the site's `/og.png`; only the text is per post.
 */
export function postMetadata(post: BlogPost): Metadata {
  const url = `/blog/${post.slug}`;

  return {
    title: post.title,
    description: post.summary,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      siteName: "Glove",
      title: post.title,
      description: post.summary,
      url,
      publishedTime: post.date,
      tags: post.tags,
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.summary,
      images: ["/og.png"],
    },
  };
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
