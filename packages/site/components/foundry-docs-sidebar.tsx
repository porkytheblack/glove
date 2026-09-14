"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { foundrySections } from "@/lib/foundry-nav";

export function FoundryDocsSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="docs-sidebar-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-label="Toggle Foundry navigation"
        aria-expanded={open}
      >
        {open ? "✕" : "☰"}
      </button>
      {open && <div className="docs-sidebar-backdrop" onClick={() => setOpen(false)} />}
      <aside className={`docs-sidebar foundry-sidebar${open ? " open" : ""}`}>
        <Link href="/foundry" className="foundry-sidebar-brand" onClick={() => setOpen(false)}>
          <span className="foundry-mark" aria-hidden="true">F</span>
          <span>
            <strong>Glove Foundry</strong>
            <small>Framework handbook</small>
          </span>
        </Link>
        {foundrySections.map((section) => (
          <div key={section.title} className="docs-sidebar-section">
            <div className="docs-sidebar-label foundry-sidebar-label">{section.title}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`docs-sidebar-link${pathname === item.href ? " active" : ""}`}
                onClick={() => setOpen(false)}
              >
                <span className="docs-sidebar-link-label">{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
        <div className="foundry-sidebar-machine">
          <span>Agent-readable</span>
          <a href="/foundry/llms.txt">llms.txt</a>
          <a href="/foundry/llms-full.txt">llms-full.txt</a>
        </div>
      </aside>
    </>
  );
}
