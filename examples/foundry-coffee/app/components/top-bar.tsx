import React from "react";
import type { ShopStatus } from "../lib/use-shop";
import { CoffeeIcon } from "./icons";

function Pill({ ok, children, title }: { ok: boolean; children: React.ReactNode; title?: string }) {
  return (
    <span className={`status-pill ${ok ? "status-pill--ok" : "status-pill--off"}`} title={title}>
      <span className="status-dot" />
      {children}
    </span>
  );
}

export function TopBar({ status, onNew }: { status: ShopStatus | null; onNew: () => void }) {
  return (
    <header className="top-bar">
      <div className="top-bar-brand">
        <div className="top-bar-logo"><CoffeeIcon color="#faf7f2" size={14} /></div>
        <span className="top-bar-name">{status?.shop ?? "Glove Coffee"}</span>
      </div>
      <div className="top-bar-center top-bar-status">
        {status ? (
          <>
            <Pill ok={status.foundry.ok} title={status.foundry.url}>
              {status.foundry.ok ? "Foundry" : "Foundry is not running"}
            </Pill>
            <Pill ok={!status.model.demo} title={status.model.demo ? "Set a model key in .env for a real barista" : status.model.model}>
              {status.model.demo ? "Scripted barista (no model key)" : `${status.model.provider} · ${status.model.model}`}
            </Pill>
            <Pill ok={status.elevenlabs} title="ELEVENLABS_API_KEY">
              {status.elevenlabs ? "Voice ready" : "Voice off (no ElevenLabs key)"}
            </Pill>
          </>
        ) : (
          <span className="top-bar-session-name">Checking the shop...</span>
        )}
      </div>
      <div className="top-bar-right top-bar-actions">
        {status?.foundry.ok && (
          <a className="top-bar-link" href={status.foundry.url} target="_blank" rel="noreferrer">Inspector</a>
        )}
        <button type="button" className="top-bar-link" onClick={onNew}>New conversation</button>
      </div>
    </header>
  );
}
