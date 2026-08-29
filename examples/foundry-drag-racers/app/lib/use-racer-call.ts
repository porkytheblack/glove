"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface TranscriptLine {
  readonly id: number;
  readonly speaker: "you" | "racer" | "system";
  readonly text: string;
}

export interface RacerCallState {
  readonly phase: "idle" | "starting" | "connecting" | "live";
  readonly status: string;
  readonly transcript: ReadonlyArray<TranscriptLine>;
  readonly activeTool: string | null;
  readonly exposedTools: ReadonlyArray<string>;
  readonly error: string | null;
}

const INITIAL: RacerCallState = {
  phase: "idle",
  status: "Choose a racer",
  transcript: [],
  activeTool: null,
  exposedTools: [],
  error: null,
};

export function useRacerCall() {
  const [state, setState] = useState<RacerCallState>(INITIAL);
  const socket = useRef<WebSocket | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const microphone = useRef<MediaStream | null>(null);
  const playback = useRef<AudioWorkletNode | null>(null);
  const runId = useRef<string | null>(null);
  const sequence = useRef(0);
  const agentTurn = useRef<number | null>(null);

  const addLine = useCallback((speaker: TranscriptLine["speaker"], text: string) => {
    setState((current) => ({
      ...current,
      transcript: [...current.transcript.slice(-79), { id: ++sequence.current, speaker, text }],
    }));
  }, []);

  const stopAudio = useCallback(() => {
    microphone.current?.getTracks().forEach((track) => track.stop());
    microphone.current = null;
    void audio.current?.close();
    audio.current = null;
    playback.current = null;
  }, []);

  const startAudio = useCallback(async () => {
    const context = new AudioContext({ sampleRate: 16_000 });
    audio.current = context;
    await context.audioWorklet.addModule("/capture-worklet.js");
    await context.audioWorklet.addModule("/playback-worklet.js");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    microphone.current = stream;

    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, "capture");
    capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(event.data);
    };
    source.connect(capture);
    const mute = context.createGain();
    mute.gain.value = 0;
    capture.connect(mute).connect(context.destination);

    const output = new AudioWorkletNode(context, "playback", { outputChannelCount: [1] });
    output.connect(context.destination);
    playback.current = output;
  }, []);

  const hangUp = useCallback(async () => {
    socket.current?.close();
    socket.current = null;
    stopAudio();
    const activeRun = runId.current;
    runId.current = null;
    if (activeRun) {
      await fetch(`/api/calls?runId=${encodeURIComponent(activeRun)}`, { method: "DELETE" }).catch(() => undefined);
    }
    agentTurn.current = null;
    setState((current) => ({ ...INITIAL, transcript: current.transcript, status: "Call ended" }));
  }, [stopAudio]);

  const connect = useCallback(async (racerId: string) => {
    setState({ ...INITIAL, phase: "starting", status: "Assembling the agent…" });
    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ racerId }),
      });
      const room = (await response.json()) as { runId?: string; port?: number; wsUrl?: string; error?: string };
      if (!response.ok || !room.runId || !room.port || !room.wsUrl) {
        throw new Error(room.error ?? "The call room could not be allocated.");
      }
      runId.current = room.runId;
      const deadline = Date.now() + 45_000;
      for (;;) {
        if (Date.now() > deadline) throw new Error("Gemini Live did not start within 45 seconds.");
        const health = await fetch(`/api/calls?runId=${encodeURIComponent(room.runId)}&port=${room.port}`, { cache: "no-store" })
          .then((item) => item.json()) as { ready?: boolean; dead?: boolean; error?: string };
        if (health.dead) throw new Error(health.error ?? "The Foundry run stopped during startup.");
        if (health.ready) break;
        setState((current) => ({ ...current, status: "Opening Gemini Live…" }));
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      await startAudio();
      setState((current) => ({ ...current, phase: "connecting", status: "Connecting audio…" }));
      const ws = new WebSocket(room.wsUrl);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          playback.current?.port.postMessage(event.data, [event.data]);
          return;
        }
        const message = JSON.parse(event.data as string) as Record<string, unknown>;
        if (message.t === "ready") {
          setState((current) => ({
            ...current,
            phase: "live",
            status: "Listening",
            exposedTools: (message.tools as string[]) ?? [],
          }));
          addLine("system", `${String(message.racer)} joined the call.`);
        } else if (message.t === "utterance") {
          addLine("you", String(message.text));
        } else if (message.t === "speech") {
          const turnId = Number(message.turnId);
          const text = String(message.text);
          if (agentTurn.current !== turnId) {
            agentTurn.current = turnId;
            addLine("racer", text);
          } else {
            setState((current) => {
              const transcript = [...current.transcript];
              const last = transcript.at(-1);
              if (last?.speaker === "racer") transcript[transcript.length - 1] = { ...last, text: last.text + text };
              return { ...current, transcript };
            });
          }
        } else if (message.t === "speech_end") {
          agentTurn.current = null;
        } else if (message.t === "state") {
          const providerState = String(message.state);
          setState((current) => ({ ...current, status: providerState[0]!.toUpperCase() + providerState.slice(1) }));
        } else if (message.t === "clear") {
          playback.current?.port.postMessage("clear");
          agentTurn.current = null;
        } else if (message.t === "tool") {
          const name = String(message.name);
          setState((current) => ({ ...current, activeTool: message.phase === "start" ? name : null }));
        } else if (message.t === "error") {
          addLine("system", String(message.message));
        }
      };
      ws.onclose = () => {
        stopAudio();
        setState((current) => current.phase === "idle" ? current : { ...current, phase: "idle", status: "Disconnected" });
      };
      ws.onerror = () => setState((current) => ({ ...current, error: "The audio connection failed." }));
    } catch (error) {
      const activeRun = runId.current;
      if (activeRun) {
        await fetch(`/api/calls?runId=${encodeURIComponent(activeRun)}`, { method: "DELETE" }).catch(() => undefined);
      }
      runId.current = null;
      stopAudio();
      setState({ ...INITIAL, error: error instanceof Error ? error.message : String(error) });
    }
  }, [addLine, startAudio, stopAudio]);

  const say = useCallback((text: string) => {
    if (socket.current?.readyState === WebSocket.OPEN && text.trim()) {
      socket.current.send(JSON.stringify({ t: "say", text: text.trim() }));
    }
  }, []);

  useEffect(() => () => {
    socket.current?.close();
    stopAudio();
  }, [stopAudio]);

  return { state, connect, hangUp, say };
}
