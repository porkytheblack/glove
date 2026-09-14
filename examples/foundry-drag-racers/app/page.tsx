"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { RACERS, type RacerId } from "../lib/racers";
import { useRacerCall } from "./lib/use-racer-call";

export default function Home() {
  const [selected, setSelected] = useState<RacerId>("jax-redline");
  const [typed, setTyped] = useState("");
  const { state, connect, hangUp, say } = useRacerCall();
  const racer = useMemo(() => RACERS.find((item) => item.id === selected)!, [selected]);
  const inCall = state.phase !== "idle";

  const submitText = () => {
    if (!typed.trim()) return;
    say(typed);
    setTyped("");
  };

  return (
    <main style={{ "--accent": racer.accent } as React.CSSProperties}>
      <header className="topbar">
        <div className="brand"><span className="brandMark">G/F</span><span>GLOVE FOUNDRY</span></div>
        <div className="liveMeta"><i /> GEMINI LIVE · SERVER-HELD KEY</div>
      </header>

      <section className="hero">
        <div className="eyebrow">PADDOCK LINE / 003</div>
        <h1>Call the<br /><em>competition.</em></h1>
        <p>Three racers. Three agents. One live line into the staging lanes. Ask about the car, the last pass, or who they think is all talk.</p>
      </section>

      <section className="racerGrid" aria-label="Choose a racer">
        {RACERS.map((item, index) => (
          <button
            key={item.id}
            className={`racerCard ${selected === item.id ? "selected" : ""}`}
            style={{ "--card-accent": item.accent } as React.CSSProperties}
            onClick={() => !inCall && setSelected(item.id)}
            disabled={inCall && selected !== item.id}
          >
            <Image src={item.image} alt={`${item.name} with ${item.car.name}`} fill sizes="(max-width: 800px) 100vw, 33vw" priority={index === 0} />
            <span className="cardShade" />
            <span className="cardNumber">0{index + 1}</span>
            <span className="cardCopy">
              <small>{item.hometown}</small>
              <strong>{item.nickname}</strong>
              <span>{item.name} · {item.car.name}</span>
            </span>
            <span className="cardStat"><b>{item.car.bestQuarterMile.split(" at ")[0]}</b><small>QUARTER</small></span>
          </button>
        ))}
      </section>

      <section className={`console ${inCall ? "open" : ""}`}>
        <div className="consoleRail">
          <div className="statusBlock">
            <span className={`pulse ${state.phase === "live" ? "hot" : ""}`} />
            <div><small>CHANNEL STATUS</small><b>{state.status}</b></div>
          </div>
          <div className="carFacts">
            <span><small>OUTPUT</small><b>{racer.car.power}</b></span>
            <span><small>POWERTRAIN</small><b>{racer.car.powertrain}</b></span>
          </div>
          {!inCall ? (
            <button className="callButton" onClick={() => void connect(selected)}>
              <span className="phoneIcon">⌁</span>
              CALL {racer.nickname.toUpperCase()}
            </button>
          ) : (
            <button className="hangButton" onClick={() => void hangUp()}>END CALL</button>
          )}
        </div>

        {(inCall || state.transcript.length > 0 || state.error) && (
          <div className="callPanel">
            <div className="transcript">
              <div className="panelHead"><span>LIVE TRANSCRIPT</span><span>{state.activeTool ? `TOOL / ${state.activeTool}` : "VOICE / 16 KHZ PCM"}</span></div>
              <div className="lines">
                {state.transcript.length === 0 && <p className="empty">The line is quiet. Say hello when the channel opens.</p>}
                {state.transcript.map((line) => (
                  <p key={line.id} className={line.speaker}>
                    <b>{line.speaker === "racer" ? racer.nickname : line.speaker}</b>
                    <span>{line.text}</span>
                  </p>
                ))}
              </div>
              {state.phase === "live" && (
                <form className="typedInput" onSubmit={(event) => { event.preventDefault(); submitText(); }}>
                  <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Type if you can’t use the microphone…" />
                  <button type="submit">SEND</button>
                </form>
              )}
            </div>
            <aside className="telemetry">
              <div className="wave" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} />)}</div>
              <small>ASSEMBLED TOOLS</small>
              <ul>
                {(state.exposedTools.length ? state.exposedTools : ["inspect_my_car", "share_garage_photo", "size_up_rival"]).map((tool) => <li key={tool}>{tool}</li>)}
              </ul>
              <small>ASK {racer.nickname.toUpperCase()}</small>
              <p>“What does your car make?”</p>
              <p>“Who worries you most?”</p>
              <p>“Show me the garage photo.”</p>
            </aside>
          </div>
        )}
        {state.error && <div className="errorBox">{state.error}</div>}
      </section>

      <footer><span>FICTIONAL RACERS · GENERATED PORTRAITS</span><span>FOUNDRY FILE ROUTES / LAZY ASSEMBLY / NATIVE GLOVE TOOLS</span></footer>
    </main>
  );
}
