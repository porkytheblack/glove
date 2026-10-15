import type { MetadataRoute } from "next";
import { posts } from "@/lib/blog";
import { docsSections } from "@/lib/docs-nav";
import { foundrySections } from "@/lib/foundry-nav";
import { SITE_URL } from "@/lib/llms";

export const dynamic = "force-static";

/** Every page registered in a nav tree or the blog index, deduplicated. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = new Set<string>(["/", "/foundry", "/docs", "/docs/showcase", "/blog"]);
  for (const section of foundrySections) for (const item of section.items) paths.add(item.href);
  for (const section of docsSections) for (const item of section.items) paths.add(item.href);
  for (const post of posts) paths.add(`/blog/${post.slug}`);

  const dated = new Map(posts.map((post) => [`/blog/${post.slug}`, new Date(post.date)]));
  return [...paths].map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    ...(dated.has(path) ? { lastModified: dated.get(path) } : {}),
    changeFrequency: path.startsWith("/blog/") ? "yearly" : "weekly",
    priority: path === "/" || path === "/foundry" ? 1 : path.startsWith("/blog/") ? 0.5 : 0.8,
  }));
}
