import type { Metadata } from "next";
import { ToolsGrid } from "@/components/tools-grid";

export const metadata: Metadata = {
  title: "Registry — Glove",
  description:
    "Copy-paste tools for Glove agents. Input, confirmation, display, and navigation components.",
};

export default function ToolsPage() {
  return (
    <>
      <div className="registry-header">
        <p className="section-label">Registry</p>
        <h1 className="section-title">
          Copy-paste tools for Glove agents.
        </h1>
        <p className="section-desc">
          Each tool is a self-contained ToolConfig with a Zod schema, a do
          function, and a colocated renderer. Pick one, paste it into your
          tools array, and you are done.
        </p>
      </div>
      <ToolsGrid />
    </>
  );
}
