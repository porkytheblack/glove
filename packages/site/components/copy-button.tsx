"use client";

import { useState, useCallback } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
}

export function CopyButton({ text, label = "Copy" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? "Copied" : label}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        fontFamily: "var(--mono)",
        fontSize: "0.65rem",
        color: copied ? "var(--success)" : "var(--text-tertiary)",
        transition: "color 0.2s",
        padding: "0.15rem 0.4rem",
        borderRadius: "4px",
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
