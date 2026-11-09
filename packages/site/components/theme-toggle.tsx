"use client";

// Light/dark switch for the whole site. The theme lives on
// <html data-theme="light|dark">; app/layout.tsx sets it before first paint
// so pages never flash the wrong theme. With no saved choice the site follows
// the OS setting (prefers-color-scheme) and tracks it live. Clicking the
// toggle saves an explicit choice; picking the theme the OS already asks for
// clears it, so the site goes back to following the system.

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "glove-theme";

/**
 * Runs inline in <head> before the body renders. Keep it tiny, dependency
 * free and in sync with THEME_STORAGE_KEY.
 */
export const themeBootScript = `(function(){var t;try{t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});}catch(e){}if(t!=="light"&&t!=="dark"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.setAttribute("data-theme",t);})();`;

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function systemTheme(): Theme {
  return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    // Matching the OS means "follow the system" again, so forget the override.
    if (theme === systemTheme()) localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the switch still works for this page.
  }
}

/** The current theme, kept live as the toggle (or another tab) changes it. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(readTheme());
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Keep other open tabs in step with a change made here.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = event.newValue === "light" || event.newValue === "dark" ? event.newValue : systemTheme();
      document.documentElement.setAttribute("data-theme", next);
    };
    window.addEventListener("storage", onStorage);

    // Follow the OS live while there is no saved override.
    const media = window.matchMedia(LIGHT_QUERY);
    const onSystemChange = () => {
      if (!savedTheme()) document.documentElement.setAttribute("data-theme", systemTheme());
    };
    media.addEventListener("change", onSystemChange);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", onStorage);
      media.removeEventListener("change", onSystemChange);
    };
  }, []);

  return theme;
}

export function ThemeToggle() {
  const theme = useTheme();
  const next: Theme = theme === "light" ? "dark" : "light";
  const label = `Switch to ${next} mode`;

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => applyTheme(next)}
    >
      {theme === "light" ? (
        // Moon: go back to dark.
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
        </svg>
      ) : (
        // Sun: turn light mode on.
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
