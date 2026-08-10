"use client";

import { useEffect, useRef, useState } from "react";
import type { Entry, Upload } from "@/lib/useDesk";
import { formatInline } from "@/lib/inline";
import { Activity } from "./Activity";
import { CloseIcon, DownloadIcon, FileIcon, PaperclipIcon, SendIcon } from "./icons";

const SUGGESTIONS = [
  {
    title: "Summarise what I uploaded",
    body: "Describe every file in /inbox and give me a one-paragraph summary of each.",
  },
  {
    title: "Turn a spreadsheet into a report",
    body: "Read the workbook in /inbox, find the three largest line items per category, and write a PDF report to /out with a table and a short commentary.",
  },
  {
    title: "Build a deck from a document",
    body: "Extract the text of the PDF in /inbox and turn its main sections into a six-slide deck in /out, with a title slide and one bullet list per section.",
  },
  {
    title: "Animate a number",
    body: "Write a motion scene that counts a headline figure up from zero over two seconds on a dark background, render it to /out as a 4-second mp4, and present it.",
  },
];

const KB = 1024;
const fmtBytes = (n: number) =>
  n < KB ? `${n} B` : n < KB * KB ? `${(n / KB).toFixed(1)} KB` : `${(n / KB / KB).toFixed(1)} MB`;

export function ChatPane({
  sessionId,
  entries,
  busy,
  error,
  uploads,
  onUpload,
  onClearUpload,
  onSend,
  onAnswer,
  onDismissError,
}: {
  sessionId: string;
  entries: Entry[];
  busy: boolean;
  error: string | null;
  uploads: Upload[];
  onUpload: (files: File[]) => void;
  onClearUpload: (id: string) => void;
  onSend: (message: string, attached: string[]) => void;
  onAnswer: (questionId: string, answer: string) => void;
  onDismissError: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Follow the tail. `entries.length` alone is not enough — streamed text
  // grows the last entry without adding one.
  const tail = entries[entries.length - 1];
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, tail && tail.kind === "text" ? tail.text.length : 0, busy]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const ready = uploads.filter((u) => u.status === "ready");
  const settled = uploads.every((u) => u.status !== "uploading");
  // Sending with files but no words is a real intent — "here, look at these".
  // Rather than invent a request, state what happened and let the agent read
  // the tree; the alternative was a disabled button and no explanation.
  const canSend = !busy && settled && (draft.trim() !== "" || ready.length > 0);

  const submit = () => {
    if (!canSend) return;
    const text =
      draft.trim() ||
      `I've put ${ready.map((u) => u.name).join(", ")} in /inbox — take a look.`;
    onSend(text, ready.map((u) => u.name));
    setDraft("");
  };

  // Group consecutive tool calls so a ten-verb turn reads as one block.
  type Group = Extract<Entry, { kind: "act" }>[] | Extract<Entry, { kind: "user" | "text" | "gift" | "question" }>;
  const groups: Group[] = [];
  for (const entry of entries) {
    if (entry.kind !== "act") {
      groups.push(entry);
      continue;
    }
    const last = groups[groups.length - 1];
    if (Array.isArray(last)) last.push(entry);
    else groups.push([entry]);
  }

  return (
    <section className="chat-pane">
      <div className="chat-scroll" ref={scrollRef}>
        {entries.length === 0 ? (
          <div className="empty">
            <h1>A desk, not a menu</h1>
            <p>
              Drop in documents and ask for something. The agent has a filesystem and a script runtime — it writes
              code against your files rather than picking from a fixed list of actions.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s.title} className="suggestion" onClick={() => setDraft(s.body)}>
                  <b>{s.title}</b>
                  {s.body}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-inner">
            {groups.map((group, i) =>
              Array.isArray(group) ? (
                <Activity key={`acts-${group[0].id}`} acts={group} />
              ) : group.kind === "user" ? (
                <div key={group.id} className="msg msg-user">
                  <span className="msg-role">You</span>
                  <div className="msg-body">{group.text}</div>
                  {group.files.length > 0 && (
                    <div className="attachments">
                      {group.files.map((name) => (
                        <span key={name} className="chip">
                          <FileIcon />
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : group.kind === "gift" ? (
                <Deliverable key={group.id} sessionId={sessionId} gift={group} />
              ) : group.kind === "question" ? (
                <Question key={group.id} entry={group} onAnswer={onAnswer} />
              ) : (
                <div key={group.id} className="msg msg-agent">
                  <span className="msg-role">Agent</span>
                  <div className="msg-body">{formatInline(group.text)}</div>
                </div>
              ),
            )}
            {busy && (tail?.kind !== "text" || tail.text === "") && (
              <div className="thinking" aria-label="working">
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        {error && (
          <div className="err-banner" onClick={onDismissError} role="alert">
            {error}
          </div>
        )}
        <div className="composer">
          {uploads.length > 0 && (
            <div className="composer-files">
              {uploads.map((up) => (
                <span key={up.id} className={`chip chip-${up.status}`} title={up.error ?? up.path ?? up.name}>
                  {up.status === "uploading" ? <span className="chip-spinner" /> : <FileIcon />}
                  {up.name}
                  {up.status === "error" && <em>{up.error}</em>}
                  <button onClick={() => onClearUpload(up.id)} aria-label={`Remove ${up.name}`}>
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="composer-row">
            <textarea
              ref={areaRef}
              rows={1}
              value={draft}
              placeholder={
                busy
                  ? "Working…"
                  : ready.length > 0
                    ? "Ask about it, or just send"
                    : "Ask for something, or drop a file anywhere"
              }
              onChange={(e) => setDraft(e.target.value)}
              // Pasting a screenshot is the fastest way to get an image in, and
              // the clipboard is where most of them already are.
              onPaste={(e) => {
                const pasted = Array.from(e.clipboardData.files);
                if (pasted.length > 0) {
                  e.preventDefault();
                  onUpload(pasted);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <button className="icon-btn" onClick={() => pickerRef.current?.click()} aria-label="Attach files">
              <PaperclipIcon />
            </button>
            <button className="icon-btn send-btn" onClick={submit} disabled={!canSend} aria-label="Send">
              <SendIcon />
            </button>
          </div>
          {/* No `accept` filter: the environment takes any bytes, and an
              allowlist here could only ever be wrong about a format it has
              never heard of. */}
          <input
            ref={pickerRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              onUpload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
        <p className="composer-hint">
          Drop, paste or attach anything — it lands in /inbox · deliverables appear in /out
        </p>
      </div>
    </section>
  );
}

/**
 * A file the agent singled out of everything in /out with `present`.
 *
 * It gets a row of its own rather than another line of tool output — and if
 * the browser can play it, it plays here. A rendered video the person has to
 * download to watch is a video they mostly do not watch, and for a render,
 * watching it *is* the check. The media type comes from the `present` event,
 * so the environment decides what this is, not a filename match here.
 */
function Deliverable({ sessionId, gift }: { sessionId: string; gift: Extract<Entry, { kind: "gift" }> }) {
  const href = `/api/download?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(gift.path)}`;
  const [kind] = gift.mediaType.split("/");

  // The download link is a sibling of the player, never its parent: a click on
  // the play button must not also start a download.
  const row = (
    <a className="deliverable" href={href} download={gift.name}>
      <DownloadIcon />
      <div className="deliverable-body">
        <b>{gift.name}</b>
        <span>{gift.caption}</span>
      </div>
      <span className="deliverable-size">{fmtBytes(gift.size)}</span>
    </a>
  );

  if (kind !== "video" && kind !== "image" && kind !== "audio") return row;

  return (
    <figure className="gift">
      <div className={`gift-media ${kind}`}>
        {kind === "video" ? (
          <video src={href} controls playsInline preload="metadata" />
        ) : kind === "audio" ? (
          <audio src={href} controls preload="metadata" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- bytes out of the VFS, not a static asset
          <img src={href} alt={gift.caption || gift.name} />
        )}
      </div>
      {row}
    </figure>
  );
}

/**
 * A question the agent is waiting on.
 *
 * The turn is genuinely blocked while this is on screen — the `ask_user`
 * verb's promise is still pending on the server — so it is deliberately the
 * loudest thing in the transcript rather than another tool row. Once answered
 * it collapses to a record of what was asked and what was said, because that
 * exchange is part of how the result came out the way it did.
 */
function Question({
  entry,
  onAnswer,
}: {
  entry: Extract<Entry, { kind: "question" }>;
  onAnswer: (questionId: string, answer: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const answered = entry.answer !== undefined;

  return (
    <div className={`msg msg-ask${answered ? " msg-ask-done" : ""}`}>
      <span className="msg-role">Agent asks</span>
      <div className="msg-body">{entry.question}</div>

      {answered ? (
        <div className="ask-answer">
          <span className="msg-role">You</span>
          {entry.answer}
        </div>
      ) : (
        <div className="ask-controls">
          {entry.options && entry.options.length > 0 && (
            <div className="ask-options">
              {entry.options.map((option) => (
                <button key={option} className="ask-option" onClick={() => onAnswer(entry.questionId, option)}>
                  {option}
                </button>
              ))}
            </div>
          )}
          {/* Always available, even with options: the right answer is often
              "neither, use the one from March", and forcing a choice between
              two wrong ones is how a wrong deliverable gets built. */}
          <form
            className="ask-free"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim() === "") return;
              onAnswer(entry.questionId, draft.trim());
              setDraft("");
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={entry.options?.length ? "…or say something else" : "Your answer"}
              aria-label="Your answer"
              autoFocus
            />
            <button type="submit" disabled={draft.trim() === ""}>
              Answer
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
