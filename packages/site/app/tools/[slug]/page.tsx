import type { Metadata } from "next";
import Link from "next/link";
import { getEntryBySlug, getAllEntries } from "@/registry/_catalog";
import { CodeBlock } from "@/components/code-block";
import { ToolPreviewLoader } from "@/components/tool-preview-loader";

// ─── Static params for Next.js build ─────────────────────────────────────────

export function generateStaticParams() {
  return getAllEntries().map((e) => ({ slug: e.slug }));
}

// ─── Dynamic metadata ────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  return {
    title: entry ? `${entry.name} — Glove Registry` : "Tool not found",
    description: entry?.description ?? "A Glove tool component.",
  };
}

// ─── Page (server component — handles shiki highlighting) ───────────────────

export default async function ToolDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);

  if (!entry) {
    return (
      <div className="tool-detail">
        <Link href="/tools" className="tool-detail-back">
          &larr; Back to Registry
        </Link>
        <h1 className="tool-detail-name">Tool not found</h1>
        <p className="tool-detail-desc">
          No tool with slug &quot;{slug}&quot; exists in the registry.
        </p>
      </div>
    );
  }

  const usageSnippet = `const tools: ToolConfig[] = [
  ${entry.name},
  // ...other tools
];`;

  return (
    <div className="tool-detail">
      <Link href="/tools" className="tool-detail-back">
        &larr; Back to Registry
      </Link>

      <h1 className="tool-detail-name">{entry.name}</h1>
      <p className="tool-detail-desc">{entry.description}</p>

      <div className="tool-detail-meta">
        <span className="tool-detail-badge">{entry.category}</span>
        <span className="tool-detail-badge">{entry.pattern}</span>
      </div>

      {/* Preview (client component for interactivity) */}
      <div className="tool-detail-section">
        <p className="tool-detail-section-label">Preview</p>
        <ToolPreviewLoader slug={slug} previewData={entry.previewData} />
      </div>

      {/* Source (server-rendered with shiki) */}
      <div className="tool-detail-section">
        <p className="tool-detail-section-label">Source</p>
        <CodeBlock code={entry.source} filename={`${entry.slug}.tsx`} language="tsx" />
      </div>

      {/* Usage */}
      <div className="tool-detail-section">
        <p className="tool-detail-section-label">Usage</p>
        <CodeBlock code={usageSnippet} filename="tools.ts" language="typescript" />
      </div>
    </div>
  );
}
