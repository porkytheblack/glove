// ─────────────────────────────────────────────────────────────────────────────
// The avatar conformance suite.
//
// Same philosophy as glove-voice-s2s's: the contract in `types.ts` says what
// an adapter must look like; this says what it must DO, against a fake
// transport, without credentials. Each harness translates the suite's
// synthetic descriptors into the provider's REAL wire shapes so the cases
// exercise the adapter's actual mapping code — never handle `__conformance`
// inside an adapter.
//
// And the same honesty: passing proves the adapter is wired correctly
// against its own reading of the protocol. Only a live call proves the
// provider accepts the frames.
// ─────────────────────────────────────────────────────────────────────────────

import type { AvatarAdapter } from "./types";

export interface AvatarConformanceContext {
  adapter: AvatarAdapter;
  /** Everything the adapter has sent to the provider, in order. */
  outbound(): unknown[];
  /** Wait a tick so event handlers settle. */
  settle(): Promise<void>;
}

export interface AvatarConformanceCase {
  name: string;
  /** Why this behaviour is required — surfaced on failure. */
  why: string;
  run(ctx: AvatarConformanceContext): Promise<void>;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const PCM_24K = { sampleRate: 24_000, channels: 1 as const, encoding: "pcm_s16le" as const };

export const AVATAR_CONFORMANCE_CASES: AvatarConformanceCase[] = [
  {
    name: "connect surfaces a view a client can attach to",
    why:
      "The view is the only way a user ever sees the face. An adapter that " +
      "connects without one renders to nobody, which looks like a broken " +
      "provider rather than a missing URL.",
    async run({ adapter, settle }) {
      let viewFromEvent: unknown = null;
      adapter.on("view_ready", (v) => {
        viewFromEvent = v;
      });
      await adapter.connect();
      await settle();
      assert(adapter.view, "view is null after connect()");
      assert(viewFromEvent, "view_ready never fired");
      assert(
        adapter.view.kind === "webrtc-room" || adapter.view.kind === "sdk-session",
        `view.kind was ${JSON.stringify((adapter.view as { kind?: string }).kind)}`,
      );
    },
  },

  {
    name: "agent audio reaches the provider",
    why:
      "PCM in, face out is the entire job. Audio that never frames onto the " +
      "wire is a silent, motionless avatar with a healthy-looking session.",
    async run({ adapter, outbound, settle }) {
      await adapter.connect();
      const before = outbound().length;
      adapter.sendAudio(Int16Array.from({ length: 2_400 }, (_, i) => i % 128), PCM_24K);
      adapter.endUtterance();
      await settle();
      assert(outbound().length > before, "sendAudio + endUtterance framed nothing outbound");
    },
  },

  {
    name: "endUtterance flushes anything buffered",
    why:
      "Adapters may batch small chunks. A final fragment that stays buffered " +
      "swallows the end of every sentence — the face stops a word early, " +
      "every single turn.",
    async run({ adapter, outbound, settle }) {
      await adapter.connect();
      adapter.sendAudio(new Int16Array(240), PCM_24K); // deliberately tiny
      const beforeEnd = outbound().length;
      adapter.endUtterance();
      await settle();
      assert(
        outbound().length > beforeEnd,
        "a tiny buffered fragment was dropped instead of flushed on endUtterance",
      );
    },
  },

  {
    name: "interrupt() is always safe and reaches the provider",
    why:
      "The voice side treats every user speech-start as a potential barge-in " +
      "and the face must follow — including when nothing is in flight, " +
      "because audio generates faster than it renders and 'in flight' is not " +
      "knowable from outside. An interrupt that throws, or never frames, " +
      "leaves the avatar talking over the caller.",
    async run({ adapter, outbound, settle }) {
      await adapter.connect();
      // Nothing in flight: must not throw.
      adapter.interrupt();
      // Mid-utterance: must reach the wire.
      adapter.sendAudio(new Int16Array(2_400), PCM_24K);
      const before = outbound().length;
      adapter.interrupt();
      await settle();
      assert(outbound().length > before, "mid-utterance interrupt never framed anything outbound");
    },
  },

  {
    name: "audio after an interrupt starts a fresh utterance",
    why:
      "Barge-in drops the cut sentence; the NEXT reply must not inherit its " +
      "buffered tail or its inference identity, or the face replays audio " +
      "the conversation already abandoned.",
    async run({ adapter, outbound, settle }) {
      await adapter.connect();
      adapter.sendAudio(new Int16Array(2_400), PCM_24K);
      adapter.interrupt();
      const before = outbound().length;
      adapter.sendAudio(new Int16Array(2_400), PCM_24K);
      adapter.endUtterance();
      await settle();
      assert(outbound().length > before, "post-interrupt audio never reached the provider");
    },
  },

  {
    name: "reports disconnection and stops claiming to be connected",
    why:
      "Hosts restart avatar sessions off this. An adapter that stays " +
      "`isConnected` after teardown makes a dead face look healthy.",
    async run({ adapter, settle }) {
      await adapter.connect();
      assert(adapter.isConnected, "not connected after connect()");
      await adapter.disconnect();
      await settle();
      assert(!adapter.isConnected, "still reports connected after disconnect()");
    },
  },
];

export interface AvatarConformanceResult {
  name: string;
  passed: boolean;
  error?: string;
}

export class AvatarConformanceFailure extends Error {
  constructor(caseName: string, why: string, detail: string) {
    super(`${caseName}: ${detail}\n  required because: ${why}`);
    this.name = "AvatarConformanceFailure";
  }
}

/** Run every case against a freshly built adapter — `makeContext` builds a
 *  new adapter + fake transport per case. */
export async function runAvatarConformance(
  makeContext: () => Promise<AvatarConformanceContext> | AvatarConformanceContext,
): Promise<AvatarConformanceResult[]> {
  const results: AvatarConformanceResult[] = [];
  for (const c of AVATAR_CONFORMANCE_CASES) {
    try {
      const ctx = await makeContext();
      await c.run(ctx);
      results.push({ name: c.name, passed: true });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({
        name: c.name,
        passed: false,
        error: new AvatarConformanceFailure(c.name, c.why, detail).message,
      });
    }
  }
  return results;
}
