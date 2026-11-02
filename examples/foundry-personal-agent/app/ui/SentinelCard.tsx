"use client";

import { useState } from "react";
import type { ApprovalDecision } from "glove-foundry-web-kit/client";
import type { MuseApproval } from "../server/muse";

/** "why" as the end of a sentence: "Book a table." reads "book a table". */
const clause = (text: string) => {
  const trimmed = text.trim().replace(/[.!?]+$/, "");
  return /^[A-Z][a-z]/.test(trimmed) ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1) : trimmed;
};

/**
 * The Sentinel stopped Muse's browser and wants the person's say. Reading a
 * site and sending to it are separate yeses; the card says which this is.
 */
export function SentinelCard({ approval, name, onDecide }: {
  readonly approval: MuseApproval & { readonly sentinel: NonNullable<MuseApproval["sentinel"]> };
  readonly name: string;
  readonly onDecide: (decision: ApprovalDecision) => Promise<void>;
}) {
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { site, access, why, readAllowed } = approval.sentinel;
  const send = access === "write";

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
    <div role="group" aria-label="The Sentinel asks" data-approval={approval.id} className="sentinel">
      <span className="who">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" style={{ fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></svg>
        The Sentinel asks
      </span>
      <span className="ask">
        {name} wants to <b>{send ? "send" : "read"}</b> {send ? "to " : ""}{site}{why ? `: ${clause(why)}` : ""}.
      </span>
      <span className="note">
        {send
          ? readAllowed ? "Reading this site is already allowed. Sending is a separate yes." : "Sending is a separate yes. It lets it read the site too."
          : "This lets it open pages there. Sending anything is a separate yes."}
        {approval.onWhatsApp ? " Asked while you were on WhatsApp." : ""}
      </span>
      <div className="actions">
        <button type="button" className="button primary" disabled={busy !== null} onClick={() => decide("approve")}>
          {send ? "Allow sending here" : "Allow reading here"}
        </button>
        <button type="button" className="button" disabled={busy !== null} onClick={() => decide("deny")}>Not now</button>
      </div>
      {error ? <span role="alert" className="status" style={{ color: "var(--muse-sentinel)" }}>{error}</span> : null}
    </div>
  );
}
