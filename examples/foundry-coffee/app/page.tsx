"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGloveVoice } from "glove-react/voice";
import { SpeakerTracker, type SpeakerInfo } from "glove-voice";
import { viewBag } from "./lib/bag-view";
import { FoundryRunnable, type RunTurn } from "./lib/foundry-runnable";
import { useScribeMonitor } from "./lib/use-scribe-monitor";
import { useShop } from "./lib/use-shop";
import { DEFAULT_VOICE, createSileroVAD, createVoiceAdapters, type VoiceSettings } from "./lib/voice";
import { ChatInput } from "./components/chat-input";
import { EmptyState } from "./components/empty-state";
import { RightPanel } from "./components/right-panel";
import { Timeline } from "./components/timeline";
import { TopBar } from "./components/top-bar";

type SileroVAD = Awaited<ReturnType<typeof createSileroVAD>>;

/** Speaker labels at the start of the lines of a message: "[Speaker A] ...". */
function labelsIn(text: string): string[] {
  return [...text.matchAll(/^\[([^\]]+)\]/gm)].map((match) => match[1]!);
}

export default function Home() {
  const shop = useShop();
  const [input, setInput] = useState("");
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Voice adapters ──────────────────────────────────────────────────────
  // Rebuilt when the settings change, which the UI only allows while voice
  // is off.
  const adapters = useMemo(() => createVoiceAdapters(settings), [settings]);
  const monitor = useScribeMonitor(adapters.stt);

  const [vad, setVad] = useState<SileroVAD | null>(null);
  useEffect(() => {
    let cancelled = false;
    createSileroVAD().then((ready) => { if (!cancelled) setVad(ready); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // ── The agent, as GloveVoice sees it ────────────────────────────────────
  // A spoken turn goes to the Foundry conversation with who is speaking.
  const speakersRef = useRef<SpeakerInfo[]>([]);
  const note = monitor.note;
  const runSpoken: RunTurn = useCallback(
    (text, options) => {
      note("turn", `to the barista: ${text.replaceAll("\n", " / ")}`);
      // The labels on this message, plus everyone heard before it.
      const known = speakersRef.current.map((s) => ({ label: s.label, ...(s.name ? { name: s.name } : {}) }));
      const fresh = labelsIn(text).filter((label) => !known.some((s) => s.label === label)).map((label) => ({ label }));
      const voice = options.voice ? { ...options.voice, speakers: [...known, ...fresh] } : undefined;
      return shop.runTurn(text, { ...options, ...(voice ? { voice } : {}) });
    },
    [shop.runTurn, note],
  );
  const runnable = useMemo(() => new FoundryRunnable(runSpoken).asGlove(), [runSpoken]);

  const voiceConfig = useMemo(
    () => ({ stt: adapters.stt, createTTS: adapters.createTTS, turnMode: adapters.turnMode, vad: vad ?? undefined }),
    [adapters, vad],
  );
  const voice = useGloveVoice({ runnable, voice: voiceConfig });
  useEffect(() => {
    speakersRef.current = voice.speakers;
  }, [voice.speakers]);

  // The hook keeps the last session's speakers after voice ends, which is
  // right while the same customer is here and wrong for the next one.
  const [speakersCleared, setSpeakersCleared] = useState(false);
  useEffect(() => {
    if (voice.isActive) setSpeakersCleared(false);
  }, [voice.isActive]);
  const speakers = speakersCleared ? [] : voice.speakers;

  // The barista's name_speaker tool runs in Foundry; the labels live here.
  const nameSpeaker = voice.nameSpeaker;
  useEffect(() => {
    shop.onRunEvent.current = (event) => {
      if (event.type !== "speaker_named") return;
      const applied = nameSpeaker(event.speaker, event.name);
      note("turn", `the barista named ${event.speaker}: ${event.name}${applied ? "" : " (no such speaker here)"}`);
    };
    return () => { shop.onRunEvent.current = null; };
  }, [shop.onRunEvent, nameSpeaker, note]);

  useEffect(() => {
    if (voice.mode !== "idle") note("turn", `pipeline: ${voice.mode}`);
  }, [voice.mode, note]);

  // The coffee example's thinking sound. Not while a checkout waits on the
  // customer: that is them thinking, not the barista.
  const waitingOnCustomer = shop.timeline.some((entry) => entry.kind === "approval" && entry.status === "pending");
  useEffect(() => {
    if (voice.mode !== "thinking" || waitingOnCustomer) return;
    const audio = new Audio("/bow-loading.mp3");
    audio.loop = true;
    audio.play().catch(() => {});
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [voice.mode, waitingOnCustomer]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [shop.timeline, shop.streaming]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const ready = shop.conversationId !== null;
  const say = useCallback(
    (text: string) => {
      if (!ready || shop.busy) return;
      shop.send(text);
    },
    [ready, shop.busy, shop.send],
  );

  const handleSubmit = useCallback(
    (e: { preventDefault: () => void }) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || shop.busy || !ready) return;
      setInput("");
      shop.send(text);
    },
    [input, shop.busy, shop.send, ready],
  );

  const stop = useCallback(() => {
    shop.stop();
    voice.interrupt();
  }, [shop.stop, voice.interrupt]);

  const newConversation = useCallback(async () => {
    await voice.stop();
    monitor.clear();
    setSpeakersCleared(true);
    await shop.newConversation();
  }, [voice.stop, monitor.clear, shop.newConversation]);

  // A recording, transcribed with batch Scribe v3 and handed to the barista.
  // Not while the microphone is on: a spoken turn would start over the
  // recording's turn, and its reply would be dropped from the screen.
  const voiceOn = useRef(false);
  voiceOn.current = voice.isActive;
  const voicemail = useCallback(
    async (file: File) => {
      if (voiceOn.current) {
        shop.note("Turn voice off to send a recording.");
        return;
      }
      // The customer this recording belongs to. `shop.now()` is read at the
      // moment it matters; the hook's state would be a render behind.
      const forConversation = shop.now().conversationId;
      const form = new FormData();
      form.set("file", file);
      type Transcribed = {
        error?: string;
        text?: string;
        languageCode?: string;
        tookMs?: number;
        turns?: Array<{ speakerId: string | null; text: string; start?: number; end?: number }>;
      };
      let response: Response;
      let data: Transcribed;
      try {
        response = await fetch("/api/transcribe", { method: "POST", body: form });
        data = (await response.json()) as Transcribed;
      } catch (failure) {
        if (shop.now().conversationId === forConversation) {
          shop.note(`The recording could not be sent: ${failure instanceof Error ? failure.message : String(failure)}`);
        }
        return;
      }
      // A new conversation started meanwhile: this is not that customer's order.
      if (shop.now().conversationId !== forConversation) return;
      if (!response.ok || !data.turns) {
        shop.note(`The recording could not be transcribed: ${data.error ?? response.status}`);
        return;
      }
      const tracker = new SpeakerTracker();
      tracker.record(data.turns);
      const several = tracker.count > 1;
      shop.note(
        `Transcribed "${file.name}" with Scribe v3 in ${((data.tookMs ?? 0) / 1000).toFixed(1)}s: ` +
          `${tracker.count || 1} speaker${several ? "s" : ""}${data.languageCode ? `, ${data.languageCode}` : ""}.`,
      );
      const body = several ? tracker.format(data.turns) : (data.text ?? "");
      if (!body.trim()) {
        shop.note("Nothing was said in that recording.");
        return;
      }
      // Sending now would stop whatever the barista is doing (a checkout
      // waiting to be confirmed, a spoken turn).
      if (shop.now().busy || voiceOn.current) {
        shop.note(
          voiceOn.current
            ? "Voice was turned on while the recording was being transcribed, so it was not sent. Turn voice off and upload it again."
            : "The barista was busy when the recording was ready, so it was not sent. Upload it again.",
        );
        return;
      }
      shop.send(
        several
          ? `This order came in as a recording. Each line starts with who said it.\n${body}`
          : `This order came in as a recording: ${body}`,
      );
    },
    [shop.now, shop.note, shop.send],
  );

  const bag = useMemo(() => viewBag(shop.bag), [shop.bag]);
  const dominant = speakers.length > 1 ? voice.dominantSpeaker() : null;
  const problem = shop.error ?? voice.error?.message ?? null;
  const empty = shop.timeline.length === 0 && !shop.busy;

  return (
    <main className="app-layout">
      <TopBar status={shop.status} onNew={() => void newConversation()} />
      <div className="content-area">
        <div className="chat-main">
          <div ref={scrollRef} className="chat-messages">
            {empty ? (
              <div className="chat-messages-inner">
                <EmptyState shop={shop.status?.shop ?? "Glove Coffee"} onSuggestion={say} />
              </div>
            ) : (
              <Timeline
                entries={shop.timeline}
                streaming={shop.streaming}
                busy={shop.busy}
                bag={bag}
                onSay={say}
                onDecide={(approvalId, decision, seen) => void shop.decide(approvalId, decision, seen)}
              />
            )}
          </div>

          {problem && <div className="problem-bar" role="alert">{problem}</div>}

          <ChatInput
            input={input}
            setInput={setInput}
            busy={shop.busy}
            ready={ready}
            onSubmit={handleSubmit}
            onStop={stop}
            voice={voice}
            voiceAvailable={shop.status?.elevenlabs ?? false}
            settings={settings}
            onSettings={setSettings}
          />
        </div>

        <RightPanel
          bag={bag}
          orders={shop.orders}
          speakers={speakers}
          dominantId={dominant?.id ?? null}
          onName={(speaker, name) => {
            voice.nameSpeaker(speaker.id, name);
            note("turn", `you named ${speaker.label}: ${name}`);
          }}
          monitor={monitor}
          voiceOn={voice.isActive}
          voiceAvailable={shop.status?.elevenlabs ?? false}
          busy={shop.busy || !ready || voice.isActive}
          onVoicemail={voicemail}
        />
      </div>
    </main>
  );
}
