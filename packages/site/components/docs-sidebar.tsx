"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsSections } from "@/lib/docs-nav";

/**
 * The docs sidebar. Sections collapse so the whole tree fits on one screen;
 * the section containing the current page is always open, and the filter box
 * flattens everything into a match list while you type.
 */
export function DocsSidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const activeSection = useMemo(
    () =>
      docsSections.find((s) => s.items.some((i) => i.href === pathname))?.title,
    [pathname],
  );

  const q = query.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!q) return docsSections;
    return docsSections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            item.summary?.toLowerCase().includes(q) ||
            item.packages?.some((p) => p.toLowerCase().includes(q)),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [q]);

  function isCollapsed(title: string) {
    if (q) return false; // filtering always shows matches
    if (title === activeSection) return false; // never hide where you are
    return collapsed[title] ?? false;
  }

  return (
    <>
      <button
        className="docs-sidebar-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle navigation"
        aria-expanded={isOpen}
      >
        {isOpen ? "✕" : "☰"}
      </button>
      {isOpen && (
        <div
          className="docs-sidebar-backdrop"
          onClick={() => setIsOpen(false)}
        />
      )}
      <aside className={`docs-sidebar${isOpen ? " open" : ""}`}>
        <div className="docs-sidebar-search">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter docs…"
            aria-label="Filter documentation pages"
          />
        </div>

        {sections.length === 0 && (
          <p className="docs-sidebar-empty">No pages match “{query}”.</p>
        )}

        {sections.map((section) => {
          const hidden = isCollapsed(section.title);
          return (
            <div key={section.title} className="docs-sidebar-section">
              <button
                type="button"
                className="docs-sidebar-label"
                onClick={() =>
                  setCollapsed((c) => ({
                    ...c,
                    [section.title]: !isCollapsed(section.title),
                  }))
                }
                aria-expanded={!hidden}
              >
                <span>{section.title}</span>
                <svg
                  className={`docs-sidebar-caret${hidden ? " closed" : ""}`}
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {!hidden &&
                section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`docs-sidebar-link${pathname === item.href ? " active" : ""}`}
                    onClick={() => setIsOpen(false)}
                  >
                    <span className="docs-sidebar-link-label">{item.label}</span>
                    {item.badge && (
                      <span className={`docs-badge ${item.badge}`}>
                        {item.badge}
                      </span>
                    )}
                  </Link>
                ))}
            </div>
          );
        })}
      </aside>
    </>
  );
}
