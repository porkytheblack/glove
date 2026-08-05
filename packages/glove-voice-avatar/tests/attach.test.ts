// The bridge wires exactly three events and detaches exactly what it added.

import { test } from "node:test";
import assert from "node:assert/strict";
import EventEmitter from "eventemitter3";
import type { RealtimeAgent } from "glove-voice-s2s";
import { attachAvatar } from "../src/attach";
import type { AvatarAdapter, AvatarEvents, AvatarView } from "../src/types";

const PCM_24K = { sampleRate: 24_000, channels: 1 as const, encoding: "pcm_s16le" as const };

class FakeAvatar extends EventEmitter<AvatarEvents> implements AvatarAdapter {
  connected = false;
  calls: string[] = [];
  view: AvatarView | null = null;
  get isConnected() {
    return this.connected;
  }
  async connect() {
    this.connected = true;
    this.view = { kind: "webrtc-room", url: "https://x", provider: "fake" };
  }
  async disconnect() {
    this.connected = false;
  }
  sendAudio(pcm: Int16Array) {
    this.calls.push(`audio:${pcm.length}`);
  }
  endUtterance() {
    this.calls.push("end");
  }
  interrupt() {
    this.calls.push("interrupt");
  }
}

function fakeRt() {
  // Only what attachAvatar touches: the adapter's event surface.
  const adapter = new EventEmitter();
  return { adapter } as unknown as RealtimeAgent;
}

test("audio, utterance end and barge-in all reach the avatar; detach removes only ours", async () => {
  const rt = fakeRt();
  const avatar = new FakeAvatar();

  let hostSaw = 0;
  (rt.adapter as unknown as EventEmitter).on("audio", () => hostSaw++);

  const detach = await attachAvatar(rt, avatar);
  assert.ok(avatar.isConnected, "attach should connect by default");

  (rt.adapter as unknown as EventEmitter).emit("audio", new Int16Array(240), PCM_24K);
  (rt.adapter as unknown as EventEmitter).emit("agent_speech_stopped");
  (rt.adapter as unknown as EventEmitter).emit("interrupted");
  assert.deepEqual(avatar.calls, ["audio:240", "end", "interrupt"]);

  detach();
  (rt.adapter as unknown as EventEmitter).emit("audio", new Int16Array(240), PCM_24K);
  assert.equal(avatar.calls.length, 3, "avatar still wired after detach");
  assert.equal(hostSaw, 2, "detach removed the host's own listener");
});
