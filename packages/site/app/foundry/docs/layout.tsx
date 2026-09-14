import type { Metadata } from "next";
import { DocsToc } from "@/components/docs-toc";
import { FoundryDocsSidebar } from "@/components/foundry-docs-sidebar";
import { FoundryBreadcrumb, FoundryPager } from "@/components/foundry-docs-chrome";

export const metadata: Metadata = {
  title: { default: "Foundry docs", template: "%s | Glove Foundry" },
  description: "Build, run, inspect, and deploy typed agent systems with Glove Foundry.",
};

export default function FoundryDocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs-layout foundry-docs-layout">
      <FoundryDocsSidebar />
      <div className="docs-main">
        <FoundryBreadcrumb />
        {children}
        <FoundryPager />
      </div>
      <DocsToc />
    </div>
  );
}
