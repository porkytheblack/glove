"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Composer } from "./Composer";
import { token as t } from "./theme";
import type { DeliveryHop, MockBubble } from "../shared";

// The demo connectors' screens: a mock provider's conversation (a phone on
// WhatsApp, a Slack DM), a form that delivers new mail, and the log of what
// crossed the wire. The page polls the app's demo API with useDemoState.

export interface MockChatProps {
  /** Like "WhatsApp" or "Slack · DM with Pip". */
  readonly title: string;
  readonly subtitle?: string;
  readonly bubbles: ReadonlyArray<MockBubble>;
  /** Read by screen readers, like "Message Muse on WhatsApp". */
  readonly label: string;
  readonly placeholder?: string;
  readonly onSend: (text: string) => Promise<void>;
  /** Above the conversation, like a switch between senders. */
  readonly controls?: ReactNode;
  readonly empty?: string;
  readonly style?: CSSProperties;
}

const card: CSSProperties = { display: "flex", flexDirection: "column", flex: "none", border: `1px solid ${t("line")}`, borderRadius: 16, background: t("surface"), overflow: "hidden" };
const time = (at: string) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** A mock provider's conversation, with a box to send as `me`. */
export function MockChat({ title, subtitle, bubbles, label, placeholder, onSend, controls, empty = "Nothing yet.", style }: MockChatProps) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll the conversation itself, not the page, so a reply never moves the rest of the screen.
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [bubbles.length]);
  return (
    <section style={{ ...card, ...style }} aria-label={title}>
      <header style={{ padding: "12px 16px", borderBottom: `1px solid ${t("line")}` }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        {subtitle ? <div style={{ color: t("muted"), fontSize: 13 }}>{subtitle}</div> : null}
      </header>
      {controls ? <div style={{ padding: "10px 16px", borderBottom: `1px solid ${t("line")}` }}>{controls}</div> : null}
      <div ref={list} style={{ flex: 1, minHeight: 220, maxHeight: 420, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10, background: t("bg") }}>
        {bubbles.length === 0 ? <p style={{ color: t("muted"), margin: "auto", fontSize: 14 }}>{empty}</p> : null}
        {bubbles.map((bubble) => (
          <div key={bubble.id} style={{ alignSelf: bubble.side === "me" ? "flex-end" : "flex-start", maxWidth: "80%" }}>
            <div style={{ padding: "8px 12px", borderRadius: 14, whiteSpace: "pre-wrap", ...(bubble.side === "me" ? { background: t("accent"), color: t("onAccent") } : { background: t("surface"), border: `1px solid ${t("line")}` }) }}>{bubble.text}</div>
            <div style={{ color: t("muted"), fontSize: 12, marginTop: 3, textAlign: bubble.side === "me" ? "right" : "left" }}>
              {time(bubble.at)}{bubble.note ? ` · ${bubble.note}` : ""}
            </div>
          </div>
        ))}
      </div>
      <Composer label={label} placeholder={placeholder} onSend={onSend} style={{ padding: 12, borderTop: `1px solid ${t("line")}` }} />
    </section>
  );
}

export interface MockMailInput {
  readonly from: string;
  readonly subject: string;
  readonly body: string;
}

export interface MockMailProps {
  /** The mailbox it lands in, like "rosa@example.com". */
  readonly to: string;
  readonly title?: string;
  readonly defaults?: Partial<MockMailInput>;
  readonly onSend: (mail: MockMailInput) => Promise<void>;
  readonly style?: CSSProperties;
}

const field: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 10, border: `1px solid ${t("lineStrong")}`, background: t("surface"), color: t("text"), font: "inherit", fontSize: 14 };

/** New mail for one mailbox: who it's from, a subject and a body. */
export function MockMail({ to, title = "New mail", defaults = {}, onSend, style }: MockMailProps) {
  const [mail, setMail] = useState<MockMailInput>({ from: defaults.from ?? "", subject: defaults.subject ?? "", body: defaults.body ?? "" });
  const [state, setState] = useState<{ readonly busy: boolean; readonly error?: string; readonly sent?: boolean }>({ busy: false });
  const ready = mail.from.includes("@") && mail.subject.trim() && mail.body.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || state.busy) return;
    setState({ busy: true });
    try {
      await onSend({ from: mail.from.trim(), subject: mail.subject.trim(), body: mail.body.trim() });
      setState({ busy: false, sent: true });
      setMail((current) => ({ ...current, subject: "", body: "" }));
    } catch (cause) {
      setState({ busy: false, error: cause instanceof Error ? cause.message : "That didn't send." });
    }
  }

  const set = (key: keyof MockMailInput) => (event: { target: { value: string } }) => {
    setMail((current) => ({ ...current, [key]: event.target.value }));
    setState({ busy: false });
  };

  return (
    <form onSubmit={submit} style={{ ...card, padding: 16, gap: 10, ...style }} aria-label={title}>
      <div>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ color: t("muted"), fontSize: 13 }}>To {to}</div>
      </div>
      <label style={{ display: "grid", gap: 4, fontSize: 13, color: t("muted") }}>From
        <input value={mail.from} onChange={set("from")} placeholder="leo@example.com" style={field} />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 13, color: t("muted") }}>Subject
        <input value={mail.subject} onChange={set("subject")} style={field} />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 13, color: t("muted") }}>Message
        <textarea value={mail.body} onChange={set("body")} rows={4} style={{ ...field, resize: "vertical" }} />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="submit" disabled={!ready || state.busy} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: t("accent"), color: t("onAccent"), fontWeight: 600, cursor: ready && !state.busy ? "pointer" : "default", opacity: ready && !state.busy ? 1 : 0.6 }}>
          {state.busy ? "Sending…" : "Deliver"}
        </button>
        {state.sent ? <span style={{ color: t("ok"), fontSize: 13 }}>Delivered. Watch the log.</span> : null}
        {state.error ? <span role="alert" style={{ color: t("ask"), fontSize: 13 }}>{state.error}</span> : null}
      </div>
    </form>
  );
}

const ARROW = { in: "→ webhook", hop: "→ Foundry", out: "← send" } as const;

/** What crossed the wire, newest last and kept in view: each webhook, what Foundry did with it, and each send back. */
export function DeliveryLog({ hops, style }: { readonly hops: ReadonlyArray<DeliveryHop>; readonly style?: CSSProperties }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // Scroll the list itself, not the page, so a new hop never moves what the person is typing in.
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [hops.length]);
  return (
    <section style={{ ...card, ...style }} aria-label="Delivery log">
      <header style={{ padding: "12px 16px", borderBottom: `1px solid ${t("line")}`, fontWeight: 600 }}>Delivery log</header>
      <ol ref={list} style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 420, overflowY: "auto" }}>
        {hops.length === 0 ? <li style={{ padding: 16, color: t("muted"), fontSize: 14 }}>Send something to see each hop.</li> : null}
        {hops.map((hop) => (
          <li key={hop.id} style={{ padding: "10px 16px", borderBottom: `1px solid ${t("line")}`, display: "grid", gap: 2 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontFamily: t("mono"), fontSize: 12 }}>
              <span style={{ color: hop.ok ? t("ok") : t("ask"), minWidth: 82 }}>{ARROW[hop.direction]}</span>
              <span style={{ color: t("muted") }}>{time(hop.at)}</span>
            </div>
            <div style={{ fontSize: 14 }}>{hop.title}</div>
            {hop.detail ? <div style={{ color: t("muted"), fontSize: 12, fontFamily: t("mono"), wordBreak: "break-all" }}>{hop.detail}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** GET `url` now and every `everyMs` while the page is open. `refresh` fetches at once, after a send. */
export function useDemoState<T>(url: string, everyMs = 2000): { readonly data: T | undefined; readonly refresh: () => void } {
  const [data, setData] = useState<T>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => fetch(url, { cache: "no-store" }).then((response) => (response.ok ? response.json() : undefined)).then((value) => {
      if (live && value !== undefined) setData(value as T);
    }).catch(() => undefined);
    void load();
    const timer = setInterval(load, everyMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [url, everyMs, tick]);
  return { data, refresh: () => setTick((value) => value + 1) };
}
