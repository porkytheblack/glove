import Link from "next/link";
import type { GroupSummary } from "../server/crew";

/** The person's group chats, with the open one marked. */
export function GroupList({ groups, current }: { readonly groups: ReadonlyArray<GroupSummary>; readonly current?: string }) {
  return (
    <aside aria-label="Group chats" className="side narrow">
      <div className="side-head">
        <h2 className="label">GROUP CHATS</h2>
        <Link href="/groups?new=1">New chat</Link>
      </div>
      {groups.map((group) => (
        <Link key={group.id} href={`/groups/${group.id}`} className="group-link" aria-current={group.id === current ? "page" : undefined}>
          {group.name}<span>{group.members.length} bots</span>
        </Link>
      ))}
      {groups.length === 0 ? <p className="muted" style={{ margin: 0, padding: "0 8px", fontSize: 14 }}>No group chats yet.</p> : null}
    </aside>
  );
}
