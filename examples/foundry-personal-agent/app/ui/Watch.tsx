"use client";

import { useEffect, useState } from "react";
import type { WatchState } from "../server/muse";
import { getJson } from "./api";

/**
 * Its browser, live: Kuiper's view-only live view, the page it is on, and,
 * when a site wants the person, "Take over to sign in". That button goes
 * through the app's server, which redirects the signed-in person to the
 * private link; the page never holds it.
 */
export function Watch({ initial }: { readonly initial: WatchState }) {
  const [state, setState] = useState(initial);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void getJson<WatchState>("/api/watch").then((next) => {
        setState((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      }).catch(() => undefined);
    }, 4_000);
    return () => clearInterval(timer);
  }, []);

  const { name, open, view, page, caption, handOff } = state;
  return (
    <>
      <header className="head">
        <h1>Watch</h1>
        <span className="sub">{name}&apos;s own browser, live. You can look; it keeps working.</span>
      </header>
      <main className="main">
        <figure className="screen" aria-label={`${name}'s browser`}>
          <div className="bar">
            <span aria-hidden="true" className={open ? "live" : "live off"} />
            {page ?? (open ? "Open" : "No browser open")}
          </div>
          {view ? (
            <iframe
              src={view}
              title={`Live view of ${name}'s browser`}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              allow=""
            />
          ) : (
            <div className="view">
              {open ? (
                <>
                  <strong>Live view of {page ?? "its browser"}</strong>
                  <span>The live view shows here when {name}&apos;s browser runs on Kuiper. View only; signing in happens in a separate, private link.</span>
                </>
              ) : (
                <>
                  <strong>Nothing open right now</strong>
                  <span>When {name} uses the web for you, you can watch it here.</span>
                </>
              )}
            </div>
          )}
          {caption ? <figcaption>{caption}</figcaption> : null}
        </figure>

        {handOff ? (
          <div role="group" aria-label="Your turn" className="turn">
            <strong>{handOff.site} wants you signed in</strong>
            <span>Take over the browser for this one step. Your login stays in your profile; {name} never sees the password.</span>
            <a href="/api/watch/take-over" target="_blank" rel="noreferrer" className="button primary big">Take over to sign in</a>
          </div>
        ) : null}
      </main>
    </>
  );
}
