import { createS2STokenHandler } from "glove-voice-s2s/server";
import { s2sHost } from "@/lib/server/s2s";
import { STATS } from "@/lib/data/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In S2S mode the realtime model IS the front agent: persona, addressing
// judgment, and the spoken channel collapse into one model. The layered
// architecture survives through the delegation TOOL — the heavy text worker
// runs unchanged behind /api/s2s/tools.
const S2S_INSTRUCTIONS = `You are Nova, the voice assistant at the front desk of ORBITAL DYNAMICS, a starship sales and service center. You speak naturally and briefly — a breath or two per turn, plain spoken language, no lists or symbols. Say numbers and ids the natural spoken way ("hull K-E-S zero-zero-seven").

You may overhear people talking to each other near the desk. Only respond when something is plainly addressed to you; otherwise stay quiet and remember what you heard.

You have NO shop data yourself. Anything needing the database — catalog, customers, hulls, service history, warranty, parts, quotes, financing, appointments — MUST go through the delegate_to_worker tool: call it with the request restated clearly (include any hull id or name you heard). Briefly acknowledge out loud that you're checking. The lookup takes a while — keep chatting naturally if the customer talks meanwhile, and NEVER invent results. When the result arrives, relay the key facts conversationally.

Today is ${STATS.todayIso}.`;

/**
 * Mint an ephemeral Realtime client secret with Nova's persona + tools baked
 * in. The tool declarations come from the same host that executes the calls,
 * so there is no second JSON-Schema list to keep in sync.
 */
export const POST = createS2STokenHandler(() => ({
  model: process.env.S2S_MODEL || "gpt-realtime",
  voice: process.env.S2S_VOICE || "marin",
  instructions: S2S_INSTRUCTIONS,
  tools: s2sHost(),
}));
