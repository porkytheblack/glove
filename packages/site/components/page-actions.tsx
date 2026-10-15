"use client";

import { usePathname } from "next/navigation";

const REPO = "https://github.com/porkytheblack/glove";

/** "Edit this page" and "Report an issue" links for the current docs page. */
export function PageActions() {
  const pathname = usePathname();
  if (!pathname) return null;
  const file = `packages/site/app${pathname === "/" ? "" : pathname}/page.tsx`;
  const issue = new URLSearchParams({
    title: `Docs: ${pathname}`,
    body: `Page: https://glove.dterminal.net${pathname}\n\nWhat is wrong or missing?\n`,
  });
  return (
    <div className="page-actions">
      <a href={`${REPO}/blob/main/${file}`} target="_blank" rel="noopener noreferrer">
        Edit this page on GitHub
      </a>
      <a href={`${REPO}/issues/new?${issue.toString()}`} target="_blank" rel="noopener noreferrer">
        Report a problem with this page
      </a>
    </div>
  );
}
