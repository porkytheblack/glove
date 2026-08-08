"use client";

/**
 * The client half of the desk: one SSE stream in, three views out.
 *
 * The transcript, the code pane and the file explorer are all projections of
 * the same event stream, so they are derived in one place rather than each
 * component subscribing and keeping its own copy.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeskEvent } from "./desk";

/** One line of the transcript. Tool calls are inline, not a sidebar. */
export type Entry =
  | { kind: "user"; id: string; text: string; files: string[] }
  | { kind: "text"; id: string; text: string }
  | {
      kind: "act";
      id: string;
      callId: string;
      name: string;
      input: Record<string, unknown>;
      status: "running" | "ok" | "error";
      output?: string;
    }
  /**
   * A deliverable the agent handed over with `present`.
   *
   * Deliberately its own entry kind rather than another tool row: the point of
   * the verb is that the agent singled this file out of everything in /out, so
   * burying it among the other calls would throw away the signal.
   */
  | {
      kind: "gift";
      id: string;
      path: string;
      name: string;
      mediaType: string;
      size: number;
      caption: string;
    };

/**
 * One file on its way into (or already in) /inbox.
 *
 * Held separately from the transcript because an upload is not a message: it
 * has its own outcome, and it stays useful whether or not anything is ever
 * said about it.
 */
export interface Upload {
  id: string;
  /** The landed name — which may differ from the picked one on a collision. */
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  path?: string;
  error?: string;
}

/** One file the agent authored, as it currently stands, with its last run. */
export interface CodeCard {
  path: string;
  content: string;
  /** Scripts get syntax colours; a report or a CSV is shown as it is. */
  code: boolean;
  status: "idle" | "running" | "ok" | "error";
  output?: string;
  runs: number;
}

const SCRIPT = /\.(js|mjs|cjs|ts)$/i;
/**
 * A written file can be as large as the environment allows — an extracted
 * 80-page PDF is ~200KB of text. The pane shows the shape of the work, not
 * the whole of it.
 */
const MAX_SHOWN = 8000;

const clamp = (text: string) =>
  text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}\n\n… ${text.length - MAX_SHOWN} more characters` : text;

export function useDesk() {
  const [sessionId, setSessionId] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cards, setCards] = useState<CodeCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Files put in /inbox but not yet mentioned in a message. */
  const [uploads, setUploads] = useState<Upload[]>([]);
  /** Bumped whenever the agent touched the tree, so the explorer can refetch. */
  const [treeVersion, setTreeVersion] = useState(0);

  const seq = useRef(0);
  const nextId = () => `e${seq.current++}`;

  // A session survives a page refresh: the desk lives server-side, keyed by
  // this id, so reloading the tab rejoins the same filesystem.
  useEffect(() => {
    const stored = sessionStorage.getItem("desk.session");
    if (stored) {
      setSessionId(stored);
      setTreeVersion((v) => v + 1);
      return;
    }
    const fresh = crypto.randomUUID();
    sessionStorage.setItem("desk.session", fresh);
    setSessionId(fresh);
  }, []);

  /**
   * A script the agent runs but did not write this session — from an earlier
   * turn, or restored. Pull its source so the pane is not a blank card.
   */
  const hydrate = useCallback(
    async (session: string, path: string) => {
      try {
        const res = await fetch(`/api/fs?session=${encodeURIComponent(session)}&path=${encodeURIComponent(path)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { text?: string };
        const text = body.text;
        if (typeof text !== "string") return;
        setCards((cs) => cs.map((c) => (c.path === path && c.content === "" ? { ...c, content: clamp(text) } : c)));
      } catch {
        /* the card just stays empty */
      }
    },
    [],
  );

  const apply = useCallback(
    (event: DeskEvent, session: string) => {
      switch (event.type) {
        case "text":
          setEntries((es) => {
            const last = es[es.length - 1];
            if (last?.kind === "text") {
              return [...es.slice(0, -1), { ...last, text: last.text + event.text }];
            }
            return [...es, { kind: "text", id: nextId(), text: event.text }];
          });
          break;

        case "tool": {
          const input = (event.input ?? {}) as Record<string, unknown>;
          setEntries((es) => [
            ...es,
            { kind: "act", id: nextId(), callId: event.id, name: event.name, input, status: "running" },
          ]);
          updateCards(event.name, input, session);
          break;
        }

        case "tool_result":
          setEntries((es) =>
            es.map((e) =>
              e.kind === "act" && e.callId === event.id
                ? { ...e, status: event.status === "error" ? "error" : "ok", output: event.output }
                : e,
            ),
          );
          setCards((cs) =>
            cs.map((c) =>
              c.status === "running"
                ? { ...c, status: event.status === "error" ? "error" : "ok", output: event.output }
                : c,
            ),
          );
          break;

        case "tree_changed":
          setTreeVersion((v) => v + 1);
          break;

        case "presented":
          setEntries((es) => [
            ...es,
            {
              kind: "gift",
              id: nextId(),
              path: event.path,
              name: event.name,
              mediaType: event.mediaType,
              size: event.size,
              caption: event.caption,
            },
          ]);
          break;

        case "error":
          setError(event.message);
          break;

        case "done":
          break;
      }
    },
    [hydrate],
  );

  /**
   * Keep the pane in step with the filesystem.
   *
   * Every authored file gets a card, not only scripts. An agent that answers
   * by writing /out/report.md straight from a read_file has still done the
   * work in front of you, and a pane that only tracked /scripts would sit
   * empty through the whole turn.
   *
   * `edit_file` is replayed rather than refetched — the tool's contract is an
   * exactly-once replacement, so applying it locally gives the same bytes the
   * environment holds without a round-trip.
   */
  function updateCards(name: string, input: Record<string, unknown>, session: string) {
    const path = typeof input.path === "string" ? input.path : "";
    if (!path) return;

    if (name === "write_file" && typeof input.content === "string") {
      const content = input.content;
      const append = input.append === true;
      setCards((cs) => {
        const at = cs.findIndex((c) => c.path === path);
        if (at === -1) {
          return [...cs, { path, content: clamp(content), code: SCRIPT.test(path), status: "idle", runs: 0 }];
        }
        const merged = append ? cs[at].content + content : content;
        return cs.map((c, i) =>
          i === at ? { ...c, content: clamp(merged), status: "idle", output: undefined } : c,
        );
      });
      return;
    }

    if (name === "edit_file" && typeof input.old_str === "string" && typeof input.new_str === "string") {
      const { old_str, new_str } = input as { old_str: string; new_str: string };
      setCards((cs) =>
        cs.map((c) =>
          c.path === path
            ? { ...c, content: clamp(c.content.replace(old_str, new_str)), status: "idle", output: undefined }
            : c,
        ),
      );
      return;
    }

    if (name === "run_script" || name === "run_tests") {
      setCards((cs) => {
        const at = cs.findIndex((c) => c.path === path);
        if (at === -1) {
          void hydrate(session, path);
          return [...cs, { path, content: "", code: true, status: "running", runs: 1 }];
        }
        return cs.map((c, i) =>
          i === at ? { ...c, status: "running", output: undefined, runs: c.runs + 1 } : c,
        );
      });
    }
  }

  /**
   * Put files in /inbox now, rather than when a message is sent.
   *
   * Uploading used to happen inside `send`, which coupled two unrelated things:
   * a file could not go in without a message to carry it, and a failing chat
   * turn looked like a failing upload. Attaching is its own action with its own
   * outcome — the file is in the tree the moment it lands, and the agent can be
   * asked about it later, or never.
   */
  const upload = useCallback(
    async (files: File[]) => {
      if (!sessionId || files.length === 0) return;

      const pending: Upload[] = files.map((f) => ({
        id: nextId(),
        name: f.name,
        size: f.size,
        status: "uploading",
      }));
      setUploads((u) => [...u, ...pending]);

      const form = new FormData();
      form.set("sessionId", sessionId);
      for (const file of files) form.append("files", file);

      try {
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const body = (await res.json()) as {
          files?: Array<{ path: string; name: string; original: string; bytes: number }>;
          errors?: Array<{ name: string; error: string }>;
        };

        // Matched on the name that was sent, not on the one that came back:
        // a collision rename means those differ, and reversing the rename rule
        // client-side would be a second implementation of it to keep in sync.
        const landed = new Map<string, { path: string; name: string }>();
        for (const f of body.files ?? []) landed.set(f.original, f);
        const failed = new Map((body.errors ?? []).map((e) => [e.name, e.error]));

        setUploads((u) =>
          u.map((up) => {
            if (!pending.some((p) => p.id === up.id)) return up;
            const hit = landed.get(up.name);
            if (hit) return { ...up, status: "ready", path: hit.path, name: hit.name };
            return { ...up, status: "error", error: failed.get(up.name) ?? "upload failed" };
          }),
        );
        setTreeVersion((v) => v + 1);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setUploads((u) =>
          u.map((up) => (pending.some((p) => p.id === up.id) ? { ...up, status: "error", error: message } : up)),
        );
      }
    },
    [sessionId],
  );

  const clearUpload = useCallback((id: string) => setUploads((u) => u.filter((x) => x.id !== id)), []);

  const send = useCallback(
    async (message: string, attached: string[]) => {
      if (!sessionId || busy) return;
      setError(null);
      setBusy(true);

      try {
        setEntries((es) => [...es, { kind: "user", id: nextId(), text: message, files: attached }]);
        setUploads([]);

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, message }),
        });
        if (!res.ok || !res.body) throw new Error(`chat failed (${res.status})`);

        // SSE by hand: EventSource cannot POST, and the payload here is a
        // message rather than a query string.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith("data:")) continue;
            try {
              apply(JSON.parse(line.slice(5).trim()) as DeskEvent, sessionId);
            } catch {
              /* a partial frame at the tail; the next chunk completes it */
            }
          }
        }
        setTreeVersion((v) => v + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [sessionId, busy, apply],
  );

  const reset = useCallback(async () => {
    if (!sessionId) return;
    await fetch("/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {});
    const fresh = crypto.randomUUID();
    sessionStorage.setItem("desk.session", fresh);
    setSessionId(fresh);
    setEntries([]);
    setCards([]);
    setUploads([]);
    setError(null);
    setTreeVersion((v) => v + 1);
  }, [sessionId]);

  return {
    sessionId,
    entries,
    cards,
    busy,
    error,
    treeVersion,
    uploads,
    upload,
    clearUpload,
    send,
    reset,
    setError,
  };
}
