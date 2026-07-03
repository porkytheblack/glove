"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsSections } from "@/lib/docs-nav";

export function DocsSidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className="docs-sidebar-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle navigation"
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
        {docsSections.map((section) => (
          <div key={section.title} className="docs-sidebar-section">
            <div className="docs-sidebar-label">{section.title}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`docs-sidebar-link${pathname === item.href ? " active" : ""}`}
                onClick={() => setIsOpen(false)}
              >
                {item.label}
                {item.badge && (
                  <span className={`docs-badge ${item.badge}`}>{item.badge}</span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </aside>
    </>
  );
}
