import { createOpenAIRealtimeToken } from "glove-voice-s2s/server";
import { STATS } from "@/lib/data/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In S2S mode the realtime model IS the front agent: persona, addressing
// judgment, and the spoken channel collapse into one model. The layered
// architecture survives through the delegation TOOL — the heavy text worker
// runs unchanged behind /api/s2s/delegate.
const S2S_INSTRUCTIONS = `You are Nova, the voice assistant at the front desk of ORBITAL DYNAMICS, a starship sales and service center. You speak naturally and briefly — a breath or two per turn, plain spoken language, no lists or symbols. Say numbers and ids the natural spoken way ("hull K-E-S zero-zero-seven").

You may overhear people talking to each other near the desk. Only respond when something is plainly addressed to you; otherwise stay quiet and remember what you heard.

You have NO shop data yourself. Anything needing the database — catalog, customers, hulls, service history, warranty, parts, quotes, financing, appointments — MUST go through the delegate_to_worker tool: call it with the request restated clearly (include any hull id or name you heard). Briefly acknowledge out loud that you're checking. The lookup takes a while — keep chatting naturally if the customer talks meanwhile, and NEVER invent results. When the result arrives, relay the key facts conversationally.

Today is ${STATS.todayIso}.`;

/** Mint an ephemeral Realtime client secret with Nova's persona + tools baked in. */
export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "S2S mode needs OPENAI_API_KEY in .env.local (the Realtime API is OpenAI-only)." },
      { status: 501 },
    );
  }
  try {
    const { token, expiresAt } = await createOpenAIRealtimeToken({
      apiKey,
      model: process.env.S2S_MODEL || "gpt-realtime",
      voice: process.env.S2S_VOICE || "marin",
      instructions: S2S_INSTRUCTIONS,
      tools: [
        {
          name: "delegate_to_worker",
          description:
            "Send a research/action request to the capability worker (shop database: catalog, customers, hulls, service history, warranty, parts, quotes, financing, appointments). Returns the findings.",
          parameters: {
            type: "object",
            properties: {
              request: {
                type: "string",
                description:
                  "The request, restated clearly, including any hull id / customer name / model heard.",
              },
            },
            required: ["request"],
          },
        },
      ],
    });
    return Response.json({ token, expiresAt });
  } catch (err) {
    return Response.json({ error: (err as Error)?.message ?? "token mint failed" }, { status: 500 });
  }
}
