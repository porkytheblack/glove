export function StatusBar({
  connected,
  stats,
}: {
  connected: boolean;
  stats: { turns: number; tokens_in: number; tokens_out: number };
}) {
  return (
    <div className="status-bar">
      <span className={`connection-dot ${connected ? "connected" : "disconnected"}`} />
      <span className="dim">
        {connected ? "Connected" : "Disconnected"}
      </span>
      {stats.turns > 0 && (
        <span className="dim stats">
          {stats.turns} turns &middot; {stats.tokens_in.toLocaleString()} in &middot;{" "}
          {stats.tokens_out.toLocaleString()} out
        </span>
      )}
    </div>
  );
}
