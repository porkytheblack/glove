import { useEffect, useState, useCallback } from "react";

interface DirEntry {
  name: string;
  path: string;
}

interface BrowseResult {
  current: string;
  parent: string | null;
  entries: DirEntry[];
  error?: string;
}

export function DirectoryPicker({
  serverHttpUrl,
  onSelect,
}: {
  serverHttpUrl: string;
  onSelect: (path: string) => void;
}) {
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualPath, setManualPath] = useState("");

  const fetchDir = useCallback(
    (path?: string) => {
      setLoading(true);
      const params = path ? `?path=${encodeURIComponent(path)}` : "";
      fetch(`${serverHttpUrl}/browse${params}`)
        .then((r) => r.json())
        .then((data: BrowseResult) => {
          setBrowse(data);
          setManualPath(data.current);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    },
    [serverHttpUrl],
  );

  useEffect(() => {
    fetchDir();
  }, [fetchDir]);

  const handleManualGo = () => {
    const trimmed = manualPath.trim();
    if (trimmed) fetchDir(trimmed);
  };

  return (
    <div className="dir-picker">
      <div className="dir-picker-path-row">
        <input
          className="dir-picker-input"
          type="text"
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleManualGo();
          }}
          placeholder="/path/to/directory"
          autoFocus
        />
        <button className="btn" onClick={handleManualGo}>
          Go
        </button>
      </div>

      {browse && (
        <div className="dir-picker-browser">
          <div className="dir-picker-current">
            <span className="dim">{browse.current}</span>
          </div>

          <div className="dir-picker-entries">
            {browse.parent && (
              <button
                className="dir-picker-entry"
                onClick={() => fetchDir(browse.parent!)}
              >
                <span className="dir-picker-icon">..</span>
                <span className="dim">parent directory</span>
              </button>
            )}

            {loading && !browse.entries.length && (
              <div className="dir-picker-loading dim">
                <span className="spinner small" /> Loading...
              </div>
            )}

            {browse.entries.map((entry) => (
              <button
                key={entry.path}
                className="dir-picker-entry"
                onClick={() => fetchDir(entry.path)}
              >
                <span className="dir-picker-icon">&#x1F4C1;</span>
                <span>{entry.name}</span>
              </button>
            ))}

            {!loading && browse.entries.length === 0 && !browse.error && (
              <div className="dir-picker-empty dim">No subdirectories</div>
            )}

            {browse.error && (
              <div className="dir-picker-empty" style={{ color: "var(--red)" }}>
                {browse.error}
              </div>
            )}
          </div>

          <div className="dir-picker-actions">
            <button
              className="btn btn-allow"
              onClick={() => onSelect(browse.current)}
            >
              Select this folder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
