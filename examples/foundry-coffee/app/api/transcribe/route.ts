import { transcribeWithElevenLabs } from "glove-voice/server";
import { PRODUCTS } from "../../../lib/catalog";

export const dynamic = "force-dynamic";

// A recorded order (a voicemail, a voice note) transcribed with batch
// Scribe v3: speakers told apart, product names passed as keyterms.

const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
// The recording plus the multipart wrapping around it.
const MAX_BODY_BYTES = MAX_RECORDING_BYTES + 1024 * 1024;
const TOO_LARGE = "That recording is over 25 MB. Send a shorter one.";

class BodyTooLarge extends Error {}

// Counts the body as it arrives, so an oversized upload is refused before it
// is held in memory and parsed.
function limited(body: ReadableStream<Uint8Array>, limit: number): ReadableStream<Uint8Array> {
  let received = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > limit) controller.error(new BodyTooLarge());
        else controller.enqueue(chunk);
      },
    }),
  );
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return Response.json({ error: "Set ELEVENLABS_API_KEY to transcribe recordings." }, { status: 503 });

  // The shop has no sign-in, and this spends the server's ElevenLabs key.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: TOO_LARGE }, { status: 413 });
  }
  if (!request.body) return Response.json({ error: "Attach a recording as `file`." }, { status: 400 });
  let form: FormData;
  try {
    form = await new Response(limited(request.body, MAX_BODY_BYTES), {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch (error) {
    if (error instanceof BodyTooLarge) return Response.json({ error: TOO_LARGE }, { status: 413 });
    return Response.json({ error: "The upload could not be read." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) return Response.json({ error: "Attach a recording as `file`." }, { status: 400 });
  if (file.size > MAX_RECORDING_BYTES) return Response.json({ error: TOO_LARGE }, { status: 413 });

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
