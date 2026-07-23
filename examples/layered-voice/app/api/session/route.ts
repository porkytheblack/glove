import { createSession } from "@/lib/server/session";
import { SPEAKERS, ASSISTANT_NAME } from "@/lib/server/speakers";
import type { SessionConfig } from "@/lib/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a fresh voice session (front + worker + mesh) and return its config.
 * Optional JSON body: `{ frontModel?: string }` — per-session front-model
 * override, used by the eval runner to A/B models without a server restart.
 */
export async function POST(req: Request) {
  let frontModel: string | undefined;
  try {
    const body = (await req.json()) as { frontModel?: string };
    if (typeof body?.frontModel === "string" && body.frontModel.trim()) {
      frontModel = body.frontModel.trim();
    }
  } catch {
    /* empty body is the normal UI path */
  }
  const session = createSession({ frontModel });
  await session.ready.catch(() => {});

  const config: SessionConfig & { buildError: string | null } = {
    sessionId: session.id,
    speakers: SPEAKERS,
    assistantName: ASSISTANT_NAME,
    buildError: session.getBuildError(),
  };
  return Response.json(config);
}
