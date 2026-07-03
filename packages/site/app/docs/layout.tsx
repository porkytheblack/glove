import { DocsSidebar } from "@/components/docs-sidebar";
import { DocsBreadcrumb, DocsPager } from "@/components/docs-chrome";

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
      </div>
    </div>
  );
}
