import Link from "next/link";
import { formatDate, type BlogPost } from "@/lib/blog";

/**
 * Back link + dateline + title for a post. Lives here rather than in the
 * blog layout because the layout also wraps the index, where a "← Blog"
 * link would point at the page you are already on.
 */
export function BlogPostHeader({ post }: { post: BlogPost }) {
  return (
    <>
      <Link href="/blog" className="blog-back">
        ← Blog
      </Link>
      <div className="blog-post-meta">
        <time dateTime={post.date}>{formatDate(post.date)}</time>
        <span className="blog-dot" />
        <span>{post.readingTime} min read</span>
      </div>
      <h1>{post.title}</h1>
    </>
  );
}
