"use client";

import { useEffect, useState } from "react";

/**
 * The whole window is the drop target.
 *
 * It used to be the composer alone — a 50px strip at the bottom — while the
 * empty state invited you to "drop in documents". A file dropped anywhere else
 * hit the browser's default handler, which *navigates away from the app to
 * open the file*. For an image that is especially convincing: the picture
 * fills the tab, so the drop looks like it was rejected when in truth it was
 * never offered.
 *
 * Listening on the window fixes both halves — the drop is accepted wherever it
 * lands, and `preventDefault` on dragover stops the navigation that made it
 * look broken.
 */
export function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);

  useEffect(() => {
    // Drag events fire per element as the pointer crosses children, so a plain
    // enter/leave pair flickers. Counting them is the usual remedy.
    let depth = 0;

    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // without this the browser opens the file instead
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [onFiles]);

  if (!over) return null;
  return (
    <div className="dropzone" aria-hidden>
      <div className="dropzone-card">Drop anywhere — it lands in /inbox</div>
    </div>
  );
}
