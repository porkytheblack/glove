"use client";

import { getToolBySlug } from "@/registry/_meta";
import { ToolPreview } from "./tool-preview";

export function ToolPreviewLoader({
  slug,
  previewData,
}: {
  slug: string;
  previewData: Record<string, unknown>;
}) {
  const tool = getToolBySlug(slug);
  if (!tool) return null;
  return <ToolPreview render={tool.render} previewData={previewData} />;
}
