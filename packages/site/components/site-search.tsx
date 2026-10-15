"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { searchEntries, type SearchEntry } from "@/lib/search-index";

const suggestions: { label: string; href: string }[] = [
  { label: "Foundry tutorial", href: "/foundry/docs/tutorial" },
  { label: "OpenAI-compatible API", href: "/foundry/docs/openai-compatible" },
  { label: "Glove quickstart", href: "/docs/getting-started" },
  { label: "All packages", href: "/docs/packages" },
  { label: "Foundry API reference", href: "/foundry/docs/reference" },
];

const kindLabel: Record<SearchEntry["kind"], string> = {
  foundry: "Foundry",
  docs: "Docs",
  blog: "Blog",
  page: "Page",
};

/**
 * ⌘K / Ctrl-K / "/" search over every docs page, Foundry handbook page and
 * blog post. The index is the nav itself (lib/search-index.ts), so it runs
 * entirely in the browser with no service behind it.
 */
export function SiteSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const results = useMemo(() => searchEntries(query), [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "/" && !typing && !open) {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      go(results[active].href);
    }
  }

  return (
    <>
      <button
        type="button"
        className="search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search the docs"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span className="search-trigger-label">Search</span>
        <kbd className="search-kbd">⌘K</kbd>
      </button>

      {/* Portal to <body>: the nav's backdrop-filter would otherwise become the
          containing block for this fixed overlay and clip it to the nav bar. */}
      {open && createPortal(
        <div className="search-overlay" onMouseDown={close}>
          <div
            className="search-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Search documentation"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="search-input-row">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                ref={inputRef}
                className="search-input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search Glove and Foundry docs…"
                aria-label="Search query"
                aria-controls={listId}
                aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
                role="combobox"
                aria-expanded={results.length > 0}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="search-esc" onClick={close}>
                Esc
              </button>
            </div>

            {query.trim() === "" ? (
              <div className="search-empty">
                <span className="search-empty-label">Popular</span>
                <div className="search-suggestions">
                  {suggestions.map((item) => (
                    <button key={item.href} type="button" onClick={() => go(item.href)}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : results.length === 0 ? (
              <div className="search-empty">
                <p>
                  No page matches &ldquo;{query}&rdquo;. Try a package name, an API such as{" "}
                  <code>defineAgent</code>, or a task such as &ldquo;schedule&rdquo;.
                </p>
              </div>
            ) : (
              <ul id={listId} ref={listRef} className="search-results" role="listbox">
                {results.map((entry, index) => (
                  <li
                    key={entry.href}
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === active}
                    className={`search-result${index === active ? " active" : ""}`}
                    onMouseMove={() => setActive(index)}
                    onClick={() => go(entry.href)}
                  >
                    <span className={`search-result-kind ${entry.kind}`}>{kindLabel[entry.kind]}</span>
                    <span className="search-result-body">
                      <span className="search-result-title">{entry.title}</span>
                      <span className="search-result-summary">{entry.summary}</span>
                      <span className="search-result-group">{entry.group}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="search-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
              <span><kbd>↵</kbd> open</span>
              <span><kbd>esc</kbd> close</span>
              <a href="/llms.txt">llms.txt</a>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
