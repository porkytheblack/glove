import Link from "next/link";
import type { BotSummary, GroupSummary } from "../server/crew";

export function Star() {
  return (
    <svg role="img" aria-label="Starred: your Primary Bot" width="14" height="14" viewBox="0 0 24 24" style={{ fill: "var(--kit-ask)", stroke: "none", flex: "none" }}>
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3 6.1 20.5l1.3-6.5L2.5 9.4l6.6-.8z" />
    </svg>
  );
}

/** The person's bots and group chats, with the open one marked. */
export function Sidebar({ bots, groups, current, max }: { readonly bots: ReadonlyArray<BotSummary>; readonly groups: ReadonlyArray<GroupSummary>; readonly current?: string; readonly max: number }) {
  return (
    <aside aria-label="Your bots" className="side">
      <div className="side-head">
        <h2 className="label">BOTS · {bots.length} OF {max}</h2>
        <Link href="/templates">New bot</Link>
      </div>
      <ul className="bot-list">
        {bots.map((bot) => (
          <li key={bot.id}>
            <Link href={`/bots/${bot.id}`} className="bot-link" aria-current={bot.id === current ? "page" : undefined}>
              <span aria-hidden="true" className={bot.job ? "avatar" : "avatar empty"}>{bot.initials}</span>
              <span className="bot-meta">
                <span className="bot-name">{bot.name}{bot.starred ? <Star /> : null}</span>
                <span className={bot.status.ask ? "bot-status ask" : bot.status.busy ? "bot-status busy" : "bot-status"}>
                  {bot.status.busy ? <span aria-hidden="true" className="dot" /> : null}
                  {bot.status.text}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {bots.length === 0 ? <p className="muted" style={{ margin: 0, padding: "0 8px", fontSize: 14 }}>No bots yet. <Link href="/templates">Make your first one</Link>.</p> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 className="label" style={{ padding: "0 8px" }}>GROUP CHATS</h2>
        {groups.map((group) => (
          <Link key={group.id} href={`/groups/${group.id}`} className="group-link">
            {group.name}<span>{group.members.length} bots</span>
          </Link>
        ))}
        {groups.length === 0 ? <Link href="/groups" className="group-link">Start a group chat</Link> : null}
      </div>
    </aside>
  );
}
