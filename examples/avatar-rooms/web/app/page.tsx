"use client";

import { useState } from "react";
import { useEffect } from "react";
import { useRoom, type SpeakerRole } from "./lib/useRoom";
import { useAvatarCall } from "./lib/useAvatarCall";

// Mirrors lib/speakers.ts, which is the source of truth the ROOM uses. Kept in
// sync by hand because this app is a separate package from the room and shares
// no code with it — the whole point of the split.
const SPEAKERS: Array<{ id: SpeakerRole; label: string }> = [
  { id: "operator", label: "Rae (you)" },
  { id: "customer", label: "Jules (came along)" },
  { id: "bystander", label: "Kit (technician)" },
];

export default function Page() {
  const avatar = useAvatarCall();
  const { state, connect, hangUp, setSpeaker, say } = useRoom({
    onAvatarInteraction: avatar.relay,
  });

  // Join the avatar's Daily room as soon as the room hands us its URL, and
  // leave when the call ends.
  const avatarUrl = typeof state.config?.avatarUrl === "string" ? state.config.avatarUrl : "";
  useEffect(() => {
    if (state.connected && avatarUrl) void avatar.join(avatarUrl);
    if (!state.connected) void avatar.leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connected, avatarUrl]);
  const [speaker, setSpeakerLocal] = useState<SpeakerRole>("operator");
  const [typed, setTyped] = useState("");

  return (
    <div className="app">
      <header>
        <div>
          <h1>Orbital Dynamics · avatar rooms</h1>
          <div className="sub">
            your mic goes up the duct to a speech-to-speech model; the agent's face
            and voice come back through the embedded room (Tavus echo)
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
          <div className="head">Aria — live</div>
          <video
            ref={avatar.videoRef}
            autoPlay
            playsInline
            style={{
              width: "100%",
              aspectRatio: "16 / 9",
              borderRadius: 8,
              background: "#000",
              display: avatar.joined ? "block" : "none",
            }}
          />
          <audio ref={avatar.audioRef} autoPlay />
          {!avatar.joined && (
            <div className="empty">
              The avatar appears here once the room is up — its face and voice
              arrive through Daily; YOUR mic flows through this page's duct.
            </div>
          )}
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
            dashboard at <a href="http://localhost:4410/signals">localhost:4410</a>.
          </div>
        </section>
      </main>
    </div>
  );
}
