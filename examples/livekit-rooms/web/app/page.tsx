"use client";

import { useState } from "react";
import { useLivekitRoom, type SpeakerRole } from "./lib/useLivekitRoom";

// Mirrors lib/speakers.ts, which is the source of truth the ROOM uses. Kept in
// sync by hand because this app is a separate package from the room and shares
// no code with it — the whole point of the split.
const SPEAKERS: Array<{ id: SpeakerRole; label: string }> = [
  { id: "operator", label: "Rae (you)" },
  { id: "customer", label: "Jules (came along)" },
  { id: "bystander", label: "Kit (technician)" },
];

export default function Page() {
  const { state, connect, hangUp, setSpeaker, say, videoHostRef, hasVideo } = useLivekitRoom();
  const [speaker, setSpeakerLocal] = useState<SpeakerRole>("operator");
  const [typed, setTyped] = useState("");

  return (
    <div className="app">
      <header>
        <div>
          <h1>Orbital Dynamics · livekit rooms</h1>
          <div className="sub">
            this page is a LiveKit join — audio rides WebRTC tracks, the room
            runs the speech-to-speech front agent, lookups delegate to the
            worker over the mesh
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
          {/* The agent's face, when the room runs with AVATAR_PROVIDER set —
              the avatar worker's video track lands here. */}
          <div ref={videoHostRef} style={{ display: hasVideo ? "block" : "none", marginBottom: 12 }} />
          <div className="head">Transport</div>
          {state.config && (
            <div className="config">
              {Object.entries(state.config).map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span> {String(v)}
                </div>
              ))}
            </div>
          )}
          <div className="note dim">
            The audio path is a LiveKit session end to end: your mic publishes a
            WebRTC track the agent subscribes to, the agent publishes its voice
            back, and barge-in flushes server-side — no worklets, no playback
            buffer, no client VAD.
          </div>
          <div className="note dim">
            Room lifecycle, delegation runs and live logs are in the station
            dashboard at <a href="http://localhost:4430/signals">localhost:4430</a>.
          </div>
        </section>
      </main>
    </div>
  );
}
