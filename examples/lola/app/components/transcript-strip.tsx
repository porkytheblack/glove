import React, { useEffect, useRef, useState } from "react";

// ---- Transcript strip ------------------------------------------------------
//
// Shows Lola's most recent spoken/streamed line near the bottom of the screen,
// rendered in cinematic serif typography. Fades to near-invisible after 4
// seconds of silence. While streaming, a gentle pulse keeps the text alive.
//
// The strip is purely presentational — pointer-events are disabled so it never
// interferes with the orb or visual area behind it.

interface TranscriptStripProps {
  text: string;
  isStreaming: boolean;
}

const FADE_DELAY_MS = 4000;

export function TranscriptStrip({ text, isStreaming }: TranscriptStripProps) {
  const [isFading, setIsFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTextRef = useRef(text);

  useEffect(() => {
    // Reset the fade timer whenever text changes or streaming starts
    if (text !== prevTextRef.current || isStreaming) {
      prevTextRef.current = text;
      setIsFading(false);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    // Only start the fade timer when not actively streaming and text is present
    if (!isStreaming && text) {
      timerRef.current = setTimeout(() => {
        setIsFading(true);
        timerRef.current = null;
      }, FADE_DELAY_MS);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [text, isStreaming]);

  if (!text) return null;

  // Show the last ~180 characters, trimmed to a word boundary, so the strip
  // always displays the most recent portion of longer responses.
  const displayText =
    text.length > 180
      ? "\u2026" + text.slice(text.length - 180).replace(/^\S*\s/, "")
      : text;

  const className = [
    "transcript-strip__text",
    isStreaming ? "transcript-strip__text--streaming" : "",
    isFading ? "transcript-strip__text--fading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="transcript-strip" role="status" aria-live="polite">
      <p className={className}>{displayText}</p>
    </div>
  );
}
