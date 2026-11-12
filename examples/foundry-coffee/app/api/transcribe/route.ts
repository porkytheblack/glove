import { transcribeWithElevenLabs } from "glove-voice/server";
import { PRODUCTS } from "../../../lib/catalog";

export const dynamic = "force-dynamic";

// A recorded order (a voicemail, a voice note) transcribed with batch
// Scribe v3: speakers told apart, product names passed as keyterms.

const MAX_RECORDING_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return Response.json({ error: "Set ELEVENLABS_API_KEY to transcribe recordings." }, { status: 503 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) return Response.json({ error: "Attach a recording as `file`." }, { status: 400 });
  // The shop has no sign-in, and this spends the server's ElevenLabs key.
  if (file.size > MAX_RECORDING_BYTES) {
    return Response.json({ error: "That recording is over 25 MB. Send a shorter one." }, { status: 413 });
  }

  try {
    const started = Date.now();
    const transcript = await transcribeWithElevenLabs({
      apiKey,
      audio: file,
      filename: file instanceof File ? file.name : "recording",
      diarize: true,
      tagAudioEvents: false,
      keyterms: PRODUCTS.map((p) => p.name),
    });
    return Response.json({
      text: transcript.text,
      languageCode: transcript.languageCode,
      turns: transcript.turns,
      words: transcript.words.length,
      tookMs: Date.now() - started,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
