"use client";

/**
 * Document Desk.
 *
 * Left: what you ask for. Right: what the agent writes to answer it. Behind a
 * button: the filesystem both of those are operating on.
 *
 * The unusual part is the right-hand pane. Most agent UIs hide the mechanism
 * and show only results, which works when the agent picks from a fixed set of
 * actions. This one has no fixed set — it writes code — so the code IS the
 * explanation of what it did, and hiding it would leave nothing to inspect.
 */
import { useState } from "react";
import { useDesk } from "@/lib/useDesk";
import { ChatPane } from "@/components/ChatPane";
import { CodePane } from "@/components/CodePane";
import { FileExplorer } from "@/components/FileExplorer";
import { FolderIcon, GloveMark, RefreshIcon } from "@/components/icons";

export default function Page() {
  const { sessionId, entries, cards, busy, error, treeVersion, send, reset, setError } = useDesk();
  const [explorerOpen, setExplorerOpen] = useState(false);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <GloveMark />
          <span className="brand-name">Document Desk</span>
        </div>
        <span className="brand-pill">glove-working-environment</span>
        <span className="topbar-spacer" />
        <button className="ghost-btn" onClick={() => setExplorerOpen(true)} disabled={!sessionId}>
          <FolderIcon />
          Files
        </button>
        <button className="ghost-btn" onClick={() => void reset()} disabled={busy || !sessionId}>
          <RefreshIcon />
          New desk
        </button>
      </header>

      <div className="split">
        <ChatPane
          entries={entries}
          busy={busy}
          error={error}
          onSend={send}
          onDismissError={() => setError(null)}
        />
        <CodePane cards={cards} busy={busy} />
      </div>

      {explorerOpen && sessionId && (
        <FileExplorer sessionId={sessionId} treeVersion={treeVersion} onClose={() => setExplorerOpen(false)} />
      )}
    </main>
  );
}
