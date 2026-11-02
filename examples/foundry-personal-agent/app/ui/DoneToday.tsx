"use client";

import { useEffect, useState } from "react";

const time = (at: string, local: boolean) => {
  const date = new Date(at);
  return local
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    : date.toISOString().slice(11, 16);
};

/** What it did today, in the person's own time zone once the page is open. */
export function DoneToday({ entries }: { readonly entries: ReadonlyArray<{ readonly at: string; readonly text: string }> }) {
  // The server renders the last day as it has it; the page then keeps the person's own today.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(new Date().toDateString()), []);
  const shown = today ? entries.filter((entry) => new Date(entry.at).toDateString() === today) : entries;
  return (
    <div className="card" style={{ gap: 8 }}>
      <span className="label">DONE TODAY</span>
      {shown.length === 0 ? <span className="note">Nothing yet today.</span> : (
        <ul className="list">
          {shown.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="split">
              <span>{entry.text}</span>
              <span className="time">{time(entry.at, today !== null)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
