import Link from "next/link";
import { sortedPosts, formatDate } from "@/lib/blog";

export const metadata = {
  title: "Blog",
  description:
    "Release notes and writing from the Glove project — what shipped, why it exists, and what it is for.",
};

export default function BlogIndexPage() {
  return (
    <div className="docs-content">
      <h1>Blog</h1>

      <p>
        Release notes and writing from the Glove project — what shipped, why it
        exists, and what it is actually for. For the change-by-change record,
        see the{" "}
        <a href="https://github.com/porkytheblack/glove/blob/main/CHANGELOG.md">
          changelog
        </a>
        .
      </p>

      <div className="blog-list">
        {sortedPosts.map((post) => (
          <Link key={post.slug} href={`/blog/${post.slug}`} className="blog-card">
            <div className="blog-card-meta">
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span className="blog-dot" />
              <span>{post.readingTime} min read</span>
            </div>
            <h2>{post.title}</h2>
            <p>{post.summary}</p>
            <div className="blog-tags">
              {post.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
