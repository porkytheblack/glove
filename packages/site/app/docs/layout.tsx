import { DocsSidebar } from "@/components/docs-sidebar";
import { DocsToc } from "@/components/docs-toc";
import { DocsBreadcrumb, DocsPager } from "@/components/docs-chrome";
import { PageActions } from "@/components/page-actions";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="docs-layout">
      <DocsSidebar />
      <div className="docs-main">
        <DocsBreadcrumb />
        {children}
        <DocsPager />
        <PageActions />
      </div>
      <DocsToc />
    </div>
  );
}
