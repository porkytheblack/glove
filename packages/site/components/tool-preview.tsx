"use client";

import { useCallback, type ReactNode } from "react";

interface ToolPreviewProps {
  render: (props: {
    data: Record<string, unknown>;
    resolve: (value: unknown) => void;
  }) => ReactNode;
  previewData: Record<string, unknown>;
}

export function ToolPreview({ render, previewData }: ToolPreviewProps) {
  const resolve = useCallback((value: unknown) => {
    // eslint-disable-next-line no-console
    console.log("[Glove preview] resolve called with:", value);
  }, []);

  return (
    <div className="preview-container">
      <div className="preview-header">Display stack</div>
      <div className="preview-body">{render({ data: previewData, resolve })}</div>
    </div>
  );
}
