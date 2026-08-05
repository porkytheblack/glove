"use client";

import { useEffect, useRef, useState } from "react";
import type { Entry } from "@/lib/useDesk";
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
];

const KB = 1024;
const fmtBytes = (n: number) =>
  n < KB ? `${n} B` : n < KB * KB ? `${(n / KB).toFixed(1)} KB` : `${(n / KB / KB).toFixed(1)} MB`;

export function ChatPane({
  sessionId,
  entries,
  busy,
  error,
  onSend,
  onDismissError,
}: {
  sessionId: string;
  entries: Entry[];
  busy: boolean;
  error: string | null;
  onSend: (message: string, files: File[]) => void;
  onDismissError: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dropping, setDropping] = useState(false);
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

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text, files);
    setDraft("");
    setFiles([]);
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list)]);
  };

  // Group consecutive tool calls so a ten-verb turn reads as one block.
  type Group = Extract<Entry, { kind: "act" }>[] | Extract<Entry, { kind: "user" | "text" | "gift" }>;
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
                // The agent singled this file out of everything in /out, so it
                // gets a row of its own rather than another line of tool output.
                <a
                  key={group.id}
                  className="deliverable"
                  href={`/api/download?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(group.path)}`}
                  download={group.name}
                >
                  <DownloadIcon />
                  <div className="deliverable-body">
                    <b>{group.name}</b>
                    <span>{group.caption}</span>
                  </div>
                  <span className="deliverable-size">{fmtBytes(group.size)}</span>
                </a>
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
        <div
          className={`composer ${dropping ? "dropping" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          {files.length > 0 && (
            <div className="composer-files">
              {files.map((file, i) => (
                <span key={`${file.name}-${i}`} className="chip">
                  <FileIcon />
                  {file.name}
                  <button
                    onClick={() => setFiles((f) => f.filter((_, j) => j !== i))}
                    aria-label={`Remove ${file.name}`}
                  >
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
              placeholder={busy ? "Working…" : "Ask for something, or drop files here"}
              onChange={(e) => setDraft(e.target.value)}
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
            <button
              className="icon-btn send-btn"
              onClick={submit}
              disabled={busy || draft.trim() === ""}
              aria-label="Send"
            >
              <SendIcon />
            </button>
          </div>
          <input
            ref={pickerRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <p className="composer-hint">Uploads land in /inbox · deliverables appear in /out</p>
      </div>
    </section>
  );
}
