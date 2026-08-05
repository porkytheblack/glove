// ─────────────────────────────────────────────────────────────────────────────
// The adapter conformance suite.
//
// "Run the same agent on any provider" is only true if the providers behave
// the same, and they do not: each has its own wire protocol, its own names for
// the same events, its own idea of who owns the microphone. The contract in
// `types.ts` says what they must look like; this says what they must DO.
//
// Every adapter runs these checks against a fake socket. That verifies the
// half that is genuinely portable — event mapping, tool-call round trips, PCM
// handling, teardown — without credentials or a network.
//
// Be clear about what it cannot verify: whether the provider ACCEPTS the
// frames an adapter sends. Only a live call proves that. Passing conformance
// means an adapter is wired correctly against its own understanding of the
// protocol; it does not mean that understanding is right.
// ─────────────────────────────────────────────────────────────────────────────

import type { S2SAdapter, S2SSessionConfig } from "./types";

export interface ConformanceCase {
  name: string;
  /** Why this behaviour is required — surfaced on failure. */
  why: string;
  run(ctx: ConformanceContext): Promise<void>;
}

export interface ConformanceContext {
  adapter: S2SAdapter;
  /**
   * Feed a provider message into the adapter, as its socket would.
   *
   * The suite calls this with SYNTHETIC descriptors (`{ __conformance:
   * "tool_call" | "user_transcript" | "audio", … }`). The harness must
   * translate each descriptor into the provider's REAL wire shape before
   * handing it to the adapter — that way the case exercises the adapter's
   * actual mapping code, not a test-only shim. Never handle `__conformance`
   * inside the adapter itself.
   */
  inbound(message: unknown): void;
  /** Everything the adapter has sent to the provider, in order. */
  outbound(): unknown[];
  /** Wait a tick so event handlers settle. */
  settle(): Promise<void>;
}

export class ConformanceFailure extends Error {
  constructor(caseName: string, why: string, detail: string) {
    super(`${caseName}: ${detail}\n  required because: ${why}`);
    this.name = "ConformanceFailure";
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const SESSION: S2SSessionConfig = {
  instructions: "You are a test agent.",
  voice: "test-voice",
  tools: [
    {
      name: "lookup",
      description: "Look something up.",
      parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    },
  ],
};

export const CONFORMANCE_CASES: ConformanceCase[] = [
  {
    name: "declares an audio mode",
    why:
      "A host wiring capture needs to know whether the adapter owns the microphone. " +
      "Inferring it means discovering the mismatch as silence on the first real call.",
    async run({ adapter }) {
      assert(
        adapter.mode === "device" || adapter.mode === "transport",
        `mode was ${JSON.stringify(adapter.mode)}`,
      );
    },
  },

  {
    name: "sends instructions and tools on connect",
    why:
      "The session config is the only place tools are declared. An adapter that " +
      "connects without them yields a model that can hear but cannot act, which " +
      "looks like a model that is ignoring its instructions.",
    async run({ adapter, outbound, settle }) {
      await adapter.connect(SESSION);
      await settle();
      const wire = JSON.stringify(outbound());
      assert(wire.includes("You are a test agent."), "instructions never reached the wire");
      assert(wire.includes("lookup"), "tool name never reached the wire");
    },
  },

  {
    name: "maps a provider tool call onto the tool_call event",
    why:
      "The bridge executes tools off this event. If the mapping is wrong the model " +
      "calls a tool, nothing happens, and the caller hears dead air while the " +
      "provider waits for a result that never comes.",
    async run({ adapter, inbound, settle }) {
      await adapter.connect(SESSION);
      const seen: Array<{ callId: string; name: string; arguments: string }> = [];
      adapter.on("tool_call", (c) => seen.push(c));
      inbound({ __conformance: "tool_call", callId: "c1", name: "lookup", arguments: '{"q":"x"}' });
      await settle();
      assert(seen.length === 1, `expected 1 tool_call, saw ${seen.length}`);
      assert(seen[0].callId === "c1", `callId was ${seen[0].callId}`);
      assert(seen[0].name === "lookup", `name was ${seen[0].name}`);
    },
  },

  {
    name: "sends a tool result carrying the same call id",
    why:
      "Providers correlate results to calls by id. A dropped or renamed id strands " +
      "the turn — the model never learns the answer it asked for.",
    async run({ adapter, outbound, settle }) {
      await adapter.connect(SESSION);
      adapter.sendToolResult("c1", { status: "success", data: { answer: 42 } });
      await settle();
      const wire = JSON.stringify(outbound());
      assert(wire.includes("c1"), "call id absent from the result frame");
      assert(wire.includes("42"), "result payload absent from the result frame");
    },
  },

  {
    name: "emits final user transcripts",
    why:
      "Transcripts are how the host logs the conversation and how the bridge tells " +
      "a finished utterance from a partial one. Marking every partial final " +
      "duplicates the transcript; never marking one final empties it.",
    async run({ adapter, inbound, settle }) {
      await adapter.connect(SESSION);
      const finals: string[] = [];
      adapter.on("user_transcript", (t, isFinal) => {
        if (isFinal) finals.push(t);
      });
      inbound({ __conformance: "user_transcript", text: "hello there", isFinal: true });
      await settle();
      assert(finals.length === 1 && finals[0] === "hello there", `finals: ${JSON.stringify(finals)}`);
    },
  },

  {
    name: "transport mode emits agent audio as PCM",
    why:
      "In transport mode the host owns playback, so audio it never receives is " +
      "audio the caller never hears. Skipped for device-mode adapters, which " +
      "legitimately play it themselves.",
    async run({ adapter, inbound, settle }) {
      if (adapter.mode !== "transport") return;
      await adapter.connect(SESSION);
      const chunks: Int16Array[] = [];
      adapter.on("audio", (pcm) => chunks.push(pcm));
      inbound({ __conformance: "audio", samples: [1, 2, 3, 4] });
      await settle();
      assert(chunks.length === 1, `expected 1 audio chunk, saw ${chunks.length}`);
      assert(chunks[0].length === 4, `chunk length was ${chunks[0].length}`);
    },
  },

  {
    name: "transport mode accepts sendAudio; device mode refuses it",
    why:
      "A device-mode adapter already holds the microphone. Silently accepting PCM " +
      "it will never transmit is worse than refusing — the host believes the " +
      "caller is being heard.",
    async run({ adapter, settle }) {
      await adapter.connect(SESSION);
      const pcm = new Int16Array(160);
      if (adapter.mode === "transport") {
        adapter.sendAudio(pcm);
        await settle();
      } else {
        let threw = false;
        try {
          adapter.sendAudio(pcm);
        } catch {
          threw = true;
        }
        assert(threw, "device-mode adapter accepted sendAudio instead of throwing");
      }
    },
  },

  {
    name: "reports disconnection and stops claiming to be connected",
    why:
      "Hosts restart sessions off this. An adapter that stays `isConnected` after " +
      "the socket drops makes a dead call look healthy.",
    async run({ adapter, settle }) {
      await adapter.connect(SESSION);
      assert(adapter.isConnected, "not connected after connect()");
      await adapter.disconnect();
      await settle();
      assert(!adapter.isConnected, "still reports connected after disconnect()");
    },
  },
];

export interface ConformanceResult {
  name: string;
  passed: boolean;
  error?: string;
}

/**
 * Run every case against a freshly built adapter.
 *
 * `makeContext` builds a new adapter + fake socket per case — shared state
 * between cases is how a suite starts passing for the wrong reason.
 */
export async function runConformance(
  makeContext: () => Promise<ConformanceContext> | ConformanceContext,
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  for (const c of CONFORMANCE_CASES) {
    try {
      const ctx = await makeContext();
      await c.run(ctx);
      results.push({ name: c.name, passed: true });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({
        name: c.name,
        passed: false,
        error: new ConformanceFailure(c.name, c.why, detail).message,
      });
    }
  }
  return results;
}
