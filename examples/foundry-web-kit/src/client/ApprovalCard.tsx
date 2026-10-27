"use client";

import { useState, type CSSProperties } from "react";
import type { ApprovalDecision, ApprovalView } from "../shared";
import { token as t } from "./theme";

export interface ApprovalCardProps {
  readonly approval: ApprovalView;
  /** Send the decision to the app's server. The card shows an error if it throws. */
  readonly onDecide: (decision: ApprovalDecision) => Promise<void> | void;
  readonly labels?: { readonly approve?: string; readonly always?: string; readonly deny?: string };
  readonly style?: CSSProperties;
}

const button = (primary: boolean, busy: boolean): CSSProperties => ({
  minHeight: 44,
  padding: "0 16px",
  borderRadius: 10,
  border: `1px solid ${primary ? t("accent") : t("lineStrong")}`,
  background: primary ? t("accent") : "transparent",
  color: primary ? t("onAccent") : t("text"),
  font: "inherit",
  fontSize: 14,
  fontWeight: primary ? 600 : 400,
  cursor: busy ? "progress" : "pointer",
  opacity: busy ? 0.7 : 1,
});

/** An approval, inline in a thread: what the agent wants to do, and Allow once / Always allow / Deny. */
export function ApprovalCard({ approval, onDecide, labels = {}, style }: ApprovalCardProps) {
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: ApprovalDecision) {
    if (busy) return;
    setBusy(decision);
    setError(null);
    try {
      await onDecide(decision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't go through. Try again.");
      setBusy(null);
    }
  }

  return (
    <div role="group" aria-label="Approval" data-approval={approval.id} style={{ boxSizing: "content-box", maxWidth: 560, display: "flex", flexDirection: "column", gap: 14, padding: 18, borderRadius: 14, background: t("surface"), border: `1px solid ${t("ask")}`, color: t("text"), ...style }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{approval.title}</span>
      {approval.fields.length > 0 ? (
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "72px 1fr", gap: "6px 12px", fontSize: 14, lineHeight: 1.5 }}>
          {approval.fields.map((field) => [
            <dt key={`${field.label}-dt`} style={{ color: t("muted") }}>{field.label}</dt>,
            <dd key={`${field.label}-dd`} style={{ margin: 0, overflowWrap: "anywhere" }}>{field.value}</dd>,
          ])}
        </dl>
      ) : null}
      {approval.body ? (
        <p style={{ margin: 0, padding: 12, borderRadius: 10, background: t("raised"), fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{approval.body}</p>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" disabled={busy !== null} onClick={() => decide("approve")} style={button(true, busy === "approve")}>{labels.approve ?? "Allow once"}</button>
        {approval.canAlwaysAllow ? (
          <button type="button" disabled={busy !== null} onClick={() => decide("always")} style={button(false, busy === "always")}>{labels.always ?? "Always allow"}</button>
        ) : null}
        <button type="button" disabled={busy !== null} onClick={() => decide("deny")} style={button(false, busy === "deny")}>{labels.deny ?? "Deny"}</button>
      </div>
      {error ? <span role="alert" style={{ fontSize: 13, color: t("ask") }}>{error}</span> : null}
    </div>
  );
}
