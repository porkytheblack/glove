import { useEffect, useState } from "react";

interface SessionInfo {
  sessionId: string;
  createdAt: string;
}

export function SessionPicker({
  serverHttpUrl,
  onSelect,
}: {
  serverHttpUrl: string;
  onSelect: (sessionId: string | undefined) => void;
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${serverHttpUrl}/sessions`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: SessionInfo[]) => {
        setSessions(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [serverHttpUrl]);

  function formatDate(iso: string) {
    const d = new Date(iso + "Z");
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className="session-picker">
      <div className="session-picker-header">
        <h2>Sessions</h2>
        <span className="dim">Choose a session or start a new one</span>
      </div>

      <button
        className="session-card session-new"
        onClick={() => onSelect(undefined)}
      >
        <span className="session-new-icon">+</span>
        <span>New session</span>
      </button>

      {loading && (
        <div className="session-loading">
          <span className="spinner small" /> Loading sessions...
        </div>
      )}

      {error && (
        <div className="session-error">
          Cannot reach server: {error}
        </div>
      )}

      {sessions.map((s) => (
        <button
          key={s.sessionId}
          className="session-card"
          onClick={() => onSelect(s.sessionId)}
        >
          <span className="session-id">{s.sessionId.slice(0, 8)}</span>
          <span className="session-date dim">{formatDate(s.createdAt)}</span>
        </button>
      ))}
    </div>
  );
}
