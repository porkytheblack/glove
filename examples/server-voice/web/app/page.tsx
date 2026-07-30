"use client";

import { useState } from "react";
import { useRoom, type SpeakerRole } from "./lib/useRoom";

const SPEAKERS: Array<{ id: SpeakerRole; label: string }> = [
  { id: "operator", label: "Sam (you)" },
  { id: "customer", label: "Dr. Okonkwo (walk-in)" },
  { id: "bystander", label: "Kit (technician)" },
];

export default function Page() {
  const { state, connect, hangUp, setSpeaker, say } = useRoom();
  const [speaker, setSpeakerLocal] = useState<SpeakerRole>("operator");
  const [typed, setTyped] = useState("");

  return (
    <div className="app">
      <header>
        <div>
          <h1>Orbital Dynamics · rooms</h1>
          <div className="sub">
            this page is an audio duct — the room beacon runs VAD, transcription,
            endpointing, the agent and speech
          </div>
        </div>
        <div className="spacer" />
        {state.workerBusy && (
          <span className="pill worker">
            <span className="dot" /> worker researching
          </span>
        )}
        <span className="pill" data-active={state.connected}>
          <span className="dot" /> {state.status}
        </span>
        <select
          value={speaker}
          onChange={(e) => {
            const next = e.target.value as SpeakerRole;
            setSpeakerLocal(next);
            setSpeaker(next);
          }}
        >
          {SPEAKERS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button onClick={() => void (state.connected ? hangUp() : connect())}>
          {state.connected ? "Hang up" : "🎙 Connect"}
        </button>
      </header>

      {state.error && <div className="banner">{state.error}</div>}

      <main>
        <section>
          <div className="head">Conversation</div>
          <div className="scroll">
            {state.log.length === 0 && (
              <div className="empty">
                Connect to claim a room. You are buying your first ship and know nothing
                about ships; Nova sells them. Tell her what you want to DO with it — move
                cargo between two colonies, take four people somewhere warm — and watch
                the lookup she needs run as a station job and come back over the mesh.
              </div>
            )}
            {state.log.map((l) =>
              l.kind === "system" || l.kind === "error" ? (
                <div key={l.id} className={l.kind === "error" ? "note error" : "note"}>
                  {l.text}
                </div>
              ) : (
                <div key={l.id} className={`line ${l.kind}`}>
                  <span className="who">{l.who}</span>
                  <div className="body">{l.text}</div>
                </div>
              ),
            )}
          </div>
          <div className="partial">{state.partial}</div>
          <form
            className="compose"
            onSubmit={(e) => {
              e.preventDefault();
              if (!typed.trim()) return;
              say(speaker, typed);
              setTyped("");
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="…or type a line as the selected speaker"
              disabled={!state.connected}
            />
          </form>
        </section>

        <section className="side">
          <div className="head">Latency</div>
          {state.config && (
            <div className="config">
              {Object.entries(state.config).map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span> {String(v)}
                </div>
              ))}
            </div>
          )}
          <div className="hero">
            <div className="hero-label">Time to first spoken token</div>
            <div className="hero-value">
              {state.ttft != null ? `${state.ttft}ms` : "—"}
              {state.ttftAvg != null && <span>avg {state.ttftAvg}ms</span>}
            </div>
          </div>
          <div className="note dim">
            Room lifecycle, delegation runs and live logs are in the station
            dashboard at <a href="http://localhost:4400/beacons">localhost:4400</a>.
          </div>
        </section>
      </main>
    </div>
  );
}
