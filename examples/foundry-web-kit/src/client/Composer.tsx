"use client";

import { useId, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { token as t } from "./theme";

export interface ComposerProps {
  /** Read by screen readers, like "Message Inbox Manager". */
  readonly label: string;
  readonly placeholder?: string;
  /** Resolve when the message is accepted; the box clears then. Throw to keep the text. */
  readonly onSend: (text: string) => Promise<void> | void;
  readonly disabled?: boolean;
  readonly sendLabel?: string;
  /** Text to start with, like a draft the page was opened with. */
  readonly defaultValue?: string;
  readonly style?: CSSProperties;
}

const hidden: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" };

/** A message box and a Send button. Enter sends; Shift+Enter adds a line. */
export function Composer({ label, placeholder, onSend, disabled = false, sendLabel = "Send", defaultValue = "", style }: ComposerProps) {
  const id = useId();
  const [text, setText] = useState(defaultValue);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = disabled || sending;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setSending(true);
    setError(null);
    try {
      await onSend(value);
      setText("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't send. Try again.");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) void submit(event);
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8, ...style }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <label htmlFor={id} style={hidden}>{label}</label>
        <textarea
          id={id}
          rows={2}
          value={text}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          style={{ flex: 1, minHeight: 48, boxSizing: "border-box", resize: "none", padding: "12px 14px", borderRadius: 12, border: `1px solid ${t("lineStrong")}`, background: t("surface"), color: t("text"), font: "inherit", fontSize: 15 }}
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          style={{ minHeight: 48, padding: "0 18px", borderRadius: 12, border: `1px solid ${t("accent")}`, background: t("accent"), color: t("onAccent"), font: "inherit", fontWeight: 600, fontSize: 15, cursor: busy ? "progress" : "pointer", opacity: busy ? 0.7 : 1 }}
        >
          {sendLabel}
        </button>
      </div>
      {error ? <span role="alert" style={{ fontSize: 13, color: t("ask") }}>{error}</span> : null}
    </form>
  );
}
