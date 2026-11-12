"use client";

import React, { useRef, useState } from "react";
import type { SpeakerInfo } from "glove-voice";
import { formatPrice } from "../../lib/catalog";
import type { Order } from "../../lib/bag";
import { describeLines, type BagView } from "../lib/bag-view";
import type { ScribeMonitor } from "../lib/use-scribe-monitor";
import { BagIcon } from "./icons";

export function RightPanel({ bag, orders, speakers, dominantId, onName, monitor, voiceOn, voiceAvailable, onVoicemail }: {
  bag: BagView;
  orders: Order[];
  speakers: SpeakerInfo[];
  dominantId: string | null;
  onName: (speaker: SpeakerInfo, name: string) => void;
  monitor: ScribeMonitor;
  voiceOn: boolean;
  voiceAvailable: boolean;
  onVoicemail: (file: File) => Promise<void>;
}) {
  return (
    <aside className="right-panel">
      <BagSection bag={bag} />
      {orders.length > 0 && <OrdersSection orders={orders} />}
      {(voiceOn || speakers.length > 0) && <SpeakersSection speakers={speakers} dominantId={dominantId} onName={onName} />}
      {(voiceOn || monitor.lines.length > 0) && <ScribeSection monitor={monitor} />}
      <VoicemailSection available={voiceAvailable} onVoicemail={onVoicemail} />
    </aside>
  );
}

function BagSection({ bag }: { bag: BagView }) {
  return (
    <div className="rp-section">
      <div className="rp-section-header">
        <BagIcon color="#3d5a3d" />
        <span className="rp-section-title">Your Bag</span>
        {bag.count > 0 && <span className="rp-badge">{bag.count}</span>}
      </div>
      {bag.lines.length === 0 ? (
        <div className="rp-empty">
          <p>Your bag is empty</p>
          <p className="rp-empty-hint">Ask the barista to help you find the perfect beans</p>
        </div>
      ) : (
        <>
          <div className="rp-items">
            {describeLines(bag.lines).map((line) => (
              <div key={line.key} className="rp-item">
                <div className="rp-item-info">
                  <span className="rp-item-name">{line.name}</span>
                  <span className="rp-item-meta">{line.meta}</span>
                  {line.for && <span className="rp-item-for">for {line.for}</span>}
                </div>
                <div className="rp-item-right">
                  <span className="rp-item-qty">x{line.qty}</span>
                  <span className="rp-item-price">{formatPrice(line.price)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="rp-totals">
            <div className="rp-total-row"><span>Subtotal</span><span>{formatPrice(bag.subtotal)}</span></div>
            <div className="rp-total-row">
              <span>Shipping</span>
              <span className={bag.shipping === 0 ? "rp-free" : ""}>{bag.shipping === 0 ? "Free" : formatPrice(bag.shipping)}</span>
            </div>
            <div className="rp-total-row rp-total-final"><span>Total</span><span>{formatPrice(bag.total)}</span></div>
          </div>
        </>
      )}
    </div>
  );
}

function OrdersSection({ orders }: { orders: Order[] }) {
  return (
    <div className="rp-section">
      <div className="rp-section-header">
        <span className="rp-section-title">Orders</span>
        <span className="rp-badge">{orders.length}</span>
      </div>
      <div className="rp-orders">
        {[...orders].reverse().map((order, i) => (
          <div key={order.id} className="rp-order">
            <div className="rp-order-header">
              <span className="rp-order-label">Order #{orders.length - i}</span>
              <span className="rp-order-total">{formatPrice(order.total)}</span>
            </div>
            <div className="rp-order-items">
              {describeLines(order.lines).map((line) => (
                <span key={line.key} className="rp-order-item">{line.name} x{line.qty}{line.for ? ` (${line.for})` : ""}</span>
              ))}
            </div>
            <div className="rp-order-meta">{order.grind} grind{order.name ? ` · ${order.name}` : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpeakersSection({ speakers, dominantId, onName }: {
  speakers: SpeakerInfo[];
  dominantId: string | null;
  onName: (speaker: SpeakerInfo, name: string) => void;
}) {
  return (
    <div className="rp-section">
      <div className="rp-section-header">
        <span className="rp-section-title">At the counter</span>
        {speakers.length > 0 && <span className="rp-badge">{speakers.length}</span>}
      </div>
      {speakers.length === 0 ? (
        <div className="rp-empty">
          <p>Nobody heard yet</p>
          <p className="rp-empty-hint">Lines are labelled for the barista once a second voice joins</p>
        </div>
      ) : (
        <div className="speakers">
          {speakers.map((speaker) => (
            <div key={speaker.id} className="speaker">
              <div className="speaker-head">
                <button
                  type="button"
                  className="speaker-name"
                  title="Click to give this speaker a name"
                  onClick={() => {
                    const name = window.prompt(`Name for ${speaker.label}`, speaker.name ?? "");
                    if (name?.trim()) onName(speaker, name.trim());
                  }}
                >
                  {speaker.label}
                </button>
                {speaker.id === dominantId && speakers.length > 1 && <span className="speaker-lead">most of the talking</span>}
                <span className="speaker-share">{Math.round(speaker.share * 100)}%</span>
              </div>
              <div className="speaker-bar"><span style={{ width: `${Math.round(speaker.share * 100)}%` }} /></div>
              <span className="speaker-meta">{speaker.words} words · {speaker.turns} turns · id {speaker.id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScribeSection({ monitor }: { monitor: ScribeMonitor }) {
  const p = monitor.probability;
  return (
    <div className="rp-section">
      <div className="rp-section-header">
        <span className="rp-section-title">Scribe</span>
        <button type="button" className="rp-clear" onClick={monitor.clear}>clear</button>
      </div>
      <div className="scribe-meter" title="Scribe v3 Live's end-of-turn probability for what it is hearing now">
        <div className="scribe-meter-label"><span>End of turn</span><span>{p === null ? "--" : p.toFixed(2)}</span></div>
        <div className="scribe-meter-bar"><span style={{ width: `${Math.round((p ?? 0) * 100)}%` }} /></div>
      </div>
      <div className="scribe-counts">
        <span title="Partial transcripts received">{monitor.partials} partials</span>
        <span title="Commits Scribe made">{monitor.commits} commits</span>
        <span title="Commits this side asked for: the local VAD, or the fallback when Scribe stayed silent">{monitor.flushes} local</span>
        <span title="Segments that came back with settled speaker labels">{monitor.labelled} labelled</span>
      </div>
      <div className="scribe-log">
        {monitor.lines.length === 0 ? (
          <span className="scribe-log-empty">Events appear here once voice is on.</span>
        ) : (
          [...monitor.lines].reverse().map((line) => (
            <div key={line.id} className={`scribe-line scribe-line--${line.kind}`}>
              <span className="scribe-line-time">{new Date(line.at).toLocaleTimeString([], { hour12: false })}</span>
              <span className="scribe-line-kind">{line.kind}</span>
              <span className="scribe-line-text">{line.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function VoicemailSection({ available, onVoicemail }: { available: boolean; onVoicemail: (file: File) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  return (
    <div className="rp-section">
      <div className="rp-section-header">
        <span className="rp-section-title">Recorded order</span>
      </div>
      <div className="rp-empty">
        <p className="rp-empty-hint">
          Upload a voice note or a voicemail. Batch Scribe v3 transcribes it, tells the speakers apart, and the barista takes it from there.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="audio/*,video/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setWorking(true);
          try {
            await onVoicemail(file);
          } finally {
            setWorking(false);
          }
        }}
      />
      <button type="button" className="rp-upload" disabled={!available || working} onClick={() => input.current?.click()}>
        {working ? "Transcribing..." : available ? "Upload a recording" : "Needs an ElevenLabs key"}
      </button>
    </div>
  );
}
