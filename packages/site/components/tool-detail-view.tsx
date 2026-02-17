"use client";

import Link from "next/link";
import { useMemo } from "react";
import { getToolBySlug } from "@/registry/_meta";
import { ToolPreview } from "./tool-preview";
import { CodeBlock } from "./code-block";

interface ToolDetailViewProps {
  slug: string;
}

export function ToolDetailView({ slug }: ToolDetailViewProps) {
  const tool = useMemo(() => getToolBySlug(slug), [slug]);

  if (!tool) {
    return (
      <div className="tool-detail">
        <Link href="/tools" className="tool-detail-back">
          ← Back to Registry
        </Link>
        <h1 className="tool-detail-name">Tool not found</h1>
        <p className="tool-detail-desc">
          No tool with slug &quot;{slug}&quot; exists in the registry.
        </p>
      </div>
    );
  }

  const usageSnippet = `const tools: ToolConfig[] = [
  ${tool.name},
  // ...other tools
];`;

  return (
    <div className="tool-detail">
      <Link href="/tools" className="tool-detail-back">
        ← Back to Registry
      </Link>

      <h1 className="tool-detail-name">{tool.name}</h1>
      <p className="tool-detail-desc">{tool.description}</p>

      <div className="tool-detail-meta">
        <span className="tool-detail-badge">{tool.category}</span>
        <span className="tool-detail-badge">{tool.pattern}</span>
      </div>

      {/* Preview */}
      <div className="tool-detail-section">
        <p className="tool-detail-section-label">Preview</p>
        <ToolPreview render={tool.render} previewData={tool.preview.data} />
      </div>

      {/* Source */}
      <div className="tool-detail-section">
        <p className="tool-detail-section-label">Source</p>
        <CodeBlock
          code={tool.source}
          filename={`${tool.slug}.tsx`}
          language="TypeScript"
        />
      </div>

      {/* Usage */}
      <div className="tool-detail-section">
        <p className="tool-detail-section-label">Usage</p>
        <CodeBlock code={usageSnippet} filename="tools.ts" language="TypeScript" />
      </div>
    </div>
  );
}
