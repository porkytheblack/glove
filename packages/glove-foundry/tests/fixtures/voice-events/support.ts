/**
 * Fixtures for addressed events on voice calls, driven from the test through
 * files so that they work inside Foundry's real child processes:
 *
 * FOUNDRY_VOICE_DIR/control.json  { agentSpeaking, userSpeaking, end }
 * FOUNDRY_VOICE_DIR/fact.txt      the current product fact ("error" throws, "cancelled" suppresses)
 * FOUNDRY_VOICE_DIR/log.jsonl     what the agents did: joined, injected, after-call, handled
 * FOUNDRY_VOICE_DIR/transcripts/  conversation stores
 */
import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { permissionKey, type Message, type PermissionStatus, type StoreAdapter, type TokenConsumptionCounter } from "glove-core";
import type { S2SAdapter, S2SEvents, S2SSessionConfig } from "glove-voice-s2s";
import type { FoundryVoiceRoom } from "../../../src/voice.js";

export const dir = (): string => process.env.FOUNDRY_VOICE_DIR!;

export function log(entry: Record<string, unknown>): void {
  appendFileSync(join(dir(), "log.jsonl"), `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
}

/** Kill the controller's whole process group (controller, daemon, this run) when the test asks to. */
export function crashIf(checkpoint: string): void {
  if (process.env.FOUNDRY_VOICE_CRASH_AT !== checkpoint) return;
  log({ type: "crashed", checkpoint });
  process.kill(-Number(process.env.FOUNDRY_VOICE_PGID), "SIGKILL");
  for (;;) { /* the signal includes this process */ }
}

interface Control { agentSpeaking?: boolean; userSpeaking?: boolean; end?: boolean }
function control(): Control {
  try { return JSON.parse(readFileSync(join(dir(), "control.json"), "utf8")) as Control; } catch { return {}; }
}

export function fact(): string {
  try { return readFileSync(join(dir(), "fact.txt"), "utf8").trim(); } catch { return ""; }
}

class Base extends EventEmitter {
  override emit<E extends keyof S2SEvents>(event: E, ...args: S2SEvents[E]): boolean { return super.emit(event, ...args); }
}

/** A realtime adapter whose speech state comes from control.json; what it is given goes to the log. */
class ControlledAdapterImpl extends Base {
  readonly mode = "transport" as const;
  readonly inputFormat = { sampleRate: 16_000, channels: 1 as const, encoding: "pcm_s16le" as const };
  private connected = false;
  private timer?: ReturnType<typeof setInterval>;
  private state = { agentSpeaking: false, userSpeaking: false };
  get isConnected() { return this.connected; }
  async connect(_config?: S2SSessionConfig) {
    this.connected = true;
    this.timer = setInterval(() => this.poll(), 20);
    this.poll();
  }
  private poll(): void {
    const next = control();
    const agent = Boolean(next.agentSpeaking);
    const user = Boolean(next.userSpeaking);
    if (agent !== this.state.agentSpeaking) { this.state.agentSpeaking = agent; this.emit(agent ? "agent_speech_started" : "agent_speech_stopped"); }
    if (user !== this.state.userSpeaking) { this.state.userSpeaking = user; this.emit(user ? "user_speech_started" : "user_speech_stopped"); }
  }
  async disconnect() { this.connected = false; if (this.timer) clearInterval(this.timer); }
  sendAudio() {}
  injectText(text: string, opts?: { respond?: boolean; role?: "user" | "system" }) {
    log({ type: "injected", text, role: opts?.role ?? "user" });
    crashIf("after-inject");
  }
  sendToolResult() {}
  updateSession() {}
  interrupt() {}
}
export const ControlledAdapter = ControlledAdapterImpl as unknown as new () => S2SAdapter;

/** A room with one caller who joins at once and hangs up when control.json says `end`. */
export function controlRoom(): FoundryVoiceRoom {
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    open(call) {
      call.joined();
      log({ type: "joined", runId: call.runId });
      timer = setInterval(() => { if (control().end) call.end("test"); }, 20);
    },
    close() { if (timer) clearInterval(timer); },
  };
}

interface Saved { messages: Message[]; permissions: Record<string, PermissionStatus>; tokens: number; turns: number }

/** Transcripts on disk, so a restarted runtime finds them. */
export class FileStore implements StoreAdapter {
  readonly identifier: string;
  private readonly file: string;
  constructor(conversationId: string) {
    const directory = join(dir(), "transcripts");
    mkdirSync(directory, { recursive: true });
    this.identifier = conversationId;
    this.file = join(directory, `${Buffer.from(conversationId).toString("hex")}.json`);
  }
  private read(): Saved {
    if (!existsSync(this.file)) return { messages: [], permissions: {}, tokens: 0, turns: 0 };
    return JSON.parse(readFileSync(this.file, "utf8")) as Saved;
  }
  private change(edit: (saved: Saved) => void): void {
    const saved = this.read();
    edit(saved);
    writeFileSync(this.file, JSON.stringify(saved));
  }
  async getMessages() { return this.read().messages; }
  async appendMessages(messages: Message[]) { this.change((saved) => { saved.messages.push(...messages); }); }
  async getTokenCount() { return this.read().tokens; }
  async addTokens(args: TokenConsumptionCounter) { this.change((saved) => { saved.tokens += args.tokens_in + args.tokens_out; }); }
  async getTurnCount() { return this.read().turns; }
  async incrementTurn() { this.change((saved) => { saved.turns++; }); }
  async resetCounters() { this.change((saved) => { saved.tokens = 0; saved.turns = 0; }); }
  async getPermission(toolName: string, input?: unknown) { return this.read().permissions[permissionKey(toolName, input)] ?? "unset"; }
  async setPermission(toolName: string, status: PermissionStatus, input?: unknown) {
    this.change((saved) => {
      const key = permissionKey(toolName, input);
      if (status === "unset") delete saved.permissions[key];
      else saved.permissions[key] = status;
    });
  }
}

/** Product facts: what to say now, nothing, or a failure to read them. */
export function prepareFromFact(): { say: string } | { suppress: string } {
  const current = fact();
  if (current === "error") throw new Error("Product facts are unavailable.");
  if (current === "cancelled") return { suppress: "the meeting was cancelled" };
  return { say: current };
}
