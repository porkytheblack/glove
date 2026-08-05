"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

function slugify(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "section"
  );
}

/**
 * The right rail. Reads the headings the page actually rendered rather than a
 * hand-maintained list, so a page only has to write <h2>/<h3> to appear here.
 * Headings without an id get a slug assigned, which also makes them linkable.
 */
export function DocsToc() {
  const pathname = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const content = document.querySelector(".docs-content");
    if (!content) {
      setHeadings([]);
      return;
    }

    const seen = new Set<string>();
    const found: Heading[] = [];

    content.querySelectorAll("h2, h3").forEach((el) => {
      const text = (el.textContent ?? "").trim();
      if (!text) return;
      let id = el.id;
      if (!id) {
        id = slugify(text);
        let n = 2;
        while (seen.has(id)) id = `${slugify(text)}-${n++}`;
        el.id = id;
      }
      seen.add(id);
      found.push({ id, text, level: el.tagName === "H3" ? 3 : 2 });
    });

    setHeadings(found);
    setActive(found[0]?.id ?? "");

    if (found.length === 0) return;

    // A deep link may target a heading whose id we only just assigned — the
    // browser already gave up scrolling to it, so do it here.
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash && window.scrollY === 0) {
      document.getElementById(hash)?.scrollIntoView();
    }

    // Highlight the last heading that has scrolled past the top of the viewport.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );

    found.forEach((h) => {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [pathname]);

  if (headings.length < 2) return null;

  return (
    <aside className="docs-toc" aria-label="On this page">
      <div className="docs-toc-inner">
        <div className="docs-toc-label">On this page</div>
        <nav>
          {headings.map((h) => (
            <a
              key={h.id}
              href={`#${h.id}`}
              className={`docs-toc-link level-${h.level}${
                active === h.id ? " active" : ""
              }`}
            >
              {h.text}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
}
