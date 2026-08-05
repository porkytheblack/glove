"use client";

/**
 * The working environment, as a file browser.
 *
 * Everything here comes off `env.fs` — the same guarded handle the model's
 * verbs go through — so what you see is exactly what the agent sees, not a
 * separate copy of the outputs. That includes /scripts and /skills, which is
 * usually the interesting part: the agent's accumulated capability is a
 * directory you can read.
 */
import { useCallback, useEffect, useState } from "react";
import type { FilePreview, TreeNode } from "@/lib/types";
import { BinaryIcon, CloseIcon, DownloadIcon, FileIcon, FolderIcon, RefreshIcon } from "./icons";

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function FileExplorer({
  sessionId,
  treeVersion,
  onClose,
}: {
  sessionId: string;
  treeVersion: number;
  onClose: () => void;
}) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/fs?session=${encodeURIComponent(sessionId)}`);
      const body = (await res.json()) as { nodes: TreeNode[] };
      setNodes(body.nodes ?? []);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load, treeVersion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!selected) return setPreview(null);
    let live = true;
    void (async () => {
      const res = await fetch(`/api/fs?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(selected)}`);
      const body = (await res.json()) as FilePreview;
      if (live) setPreview(res.ok ? body : null);
    })();
    return () => {
      live = false;
    };
  }, [selected, sessionId, treeVersion]);

  const files = nodes.filter((n) => n.kind === "file");
  // Group by parent directory, so the tree reads as the layout the model was
  // told about (/inbox, /scripts, /out, …) rather than a flat path dump.
  const byDir = new Map<string, TreeNode[]>();
  for (const file of files) {
    const dir = file.path.slice(0, file.path.lastIndexOf("/")) || "/";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(file);
  }
  // Your files first. /skills and /std are twenty-odd read-only files the
  // environment materialises for the model to read; leaving them in
  // alphabetical order pushes the one deliverable you came looking for below
  // the fold.
  const RANK = ["/inbox", "/out", "/scripts", "/tmp"];
  const rank = (dir: string) => {
    const at = RANK.findIndex((r) => dir === r || dir.startsWith(`${r}/`));
    return at === -1 ? RANK.length : at;
  };
  const dirs = [...byDir.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Working environment">
        <header className="modal-head">
          <span className="modal-title">Working environment</span>
          <span className="modal-sub">
            {files.length} file{files.length === 1 ? "" : "s"} · {bytes(files.reduce((n, f) => n + f.size, 0))}
          </span>
          <span className="topbar-spacer" />
          <button className="ghost-btn" onClick={() => void load()} disabled={loading}>
            <RefreshIcon />
            Refresh
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        <div className="modal-body">
          <nav className="tree">
            {files.length === 0 ? (
              <p className="tree-empty">
                {loading ? "Loading…" : "Nothing here yet. Upload a file or ask the agent for something."}
              </p>
            ) : (
              dirs.map((dir) => (
                <div key={dir} className="tree-group">
                  <div className="tree-dir">
                    <FolderIcon />
                    {dir}
                  </div>
                  {byDir.get(dir)!.map((file) => (
                    <button
                      key={file.path}
                      className={`tree-file ${selected === file.path ? "active" : ""}`}
                      onClick={() => setSelected(file.path)}
                    >
                      <FileIcon />
                      <span className="fname">{file.name}</span>
                      <span className="fsize">{bytes(file.size)}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </nav>

          <div className="preview">
            {!selected || !preview ? (
              <div className="preview-none">Select a file to read it.</div>
            ) : (
              <>
                <div className="preview-head">
                  <span className="path">{preview.path}</span>
                  <span>{bytes(preview.size)}</span>
                  <a
                    className="dl-btn"
                    href={`/api/download?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(preview.path)}`}
                    download
                  >
                    <DownloadIcon />
                    Download
                  </a>
                </div>
                <div className="preview-body">
                  {preview.binary ? (
                    <div className="preview-binary">
                      <BinaryIcon />
                      <p>
                        {preview.path.split(".").pop()?.toUpperCase()} · {bytes(preview.size)}
                        <br />
                        Download it to open in its own application.
                      </p>
                    </div>
                  ) : (
                    <pre>{preview.text}</pre>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
