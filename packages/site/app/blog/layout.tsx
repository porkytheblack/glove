/**
 * The blog reuses the docs prose styles (`.docs-content`) but not the docs
 * chrome — no sidebar, no table of contents, no prev/next pager. A post is
 * read start to finish, so it gets a single centred column.
 *
 * No footer here: the root layout already renders one under every page.
 *
 * The back link is NOT here either: this layout also wraps the index, where
 * it would link to the current page. Posts render it via <BlogPostHeader>.
 */
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <div className="blog-shell">{children}</div>;
}
