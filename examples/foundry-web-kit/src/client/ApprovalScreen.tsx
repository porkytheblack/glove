"use client";

import { useState, type CSSProperties } from "react";
import { ApprovalCard } from "./ApprovalCard";
import type { ApprovalDecision, ApprovalPageView } from "../shared";
import { token as t } from "./theme";

export interface ApprovalScreenProps {
  readonly view: ApprovalPageView;
  /** Where the decision is POSTed as `{ decision }`, such as `/api/approvals/<id>`. */
  readonly decideUrl: string;
  /** Who asked, for the outcome line ("Pip carried on"). */
  readonly agentName: string;
  /** Back to where the work happens: the chat, the bot, the activity page. */
  readonly back: { readonly href: string; readonly label: string };
  readonly labels?: { readonly approve?: string; readonly always?: string; readonly deny?: string };
  readonly style?: CSSProperties;
}

const OUTCOME: Record<Exclude<ApprovalPageView["status"], "pending">, (name: string) => string> = {
  approved: (name) => `Approved. ${name} carries on with it.`,
  denied: (name) => `Denied. ${name} won't do it.`,
  expired: () => "Nobody decided in time, so it expired. Ask again if it's still needed.",
  cancelled: () => "The work this was part of stopped, so there's nothing to decide.",
};

/**
 * The page an approval's link opens. Pending: the card, decided here. Decided:
 * what happened, and the way back. A decision on a paused run resumes it.
 */
export function ApprovalScreen({ view, decideUrl, agentName, back, labels, style }: ApprovalScreenProps) {
  const [decided, setDecided] = useState<ApprovalPageView["status"] | null>(null);
  const status = decided ?? view.status;

  async function decide(decision: ApprovalDecision) {
    const response = await fetch(decideUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "That didn't go through. Try again.");
    }
    setDecided(decision === "deny" ? "denied" : "approved");
  }

  return (
    <section aria-label="Approval" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 600, ...style }}>
      {status === "pending" ? (
        <ApprovalCard approval={view.approval} onDecide={decide} {...(labels ? { labels } : {})} />
      ) : (
        <div role="status" data-approval-status={status} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 18, borderRadius: 14, background: t("surface"), border: `1px solid ${t("line")}`, color: t("text") }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{view.approval.title}</span>
          <span style={{ fontSize: 14, color: t("muted") }}>{OUTCOME[status](agentName)}</span>
        </div>
      )}
      <a href={back.href} style={{ fontSize: 14, color: t("accent") }}>{back.label}</a>
    </section>
  );
}
