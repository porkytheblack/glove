import { createSession } from "@/lib/server/session";
import { SPEAKERS, ASSISTANT_NAME } from "@/lib/server/speakers";
import type { SessionConfig } from "@/lib/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create a fresh voice session (three agents + mesh) and return its config. */
export async function POST() {
  const session = createSession();
  await session.ready.catch(() => {});

  const config: SessionConfig & { buildError: string | null } = {
    sessionId: session.id,
    speakers: SPEAKERS,
    assistantName: ASSISTANT_NAME,
    buildError: session.getBuildError(),
  };
  return Response.json(config);
}
