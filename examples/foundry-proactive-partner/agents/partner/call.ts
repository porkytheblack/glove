import type { AgentAssemblyContext } from "glove-foundry";
import { voiceCall, webSocketRoom } from "glove-foundry/voice";
import { z } from "zod";

/** How the app starts a call: the port the page connects to, and a one-time token. */
const callRequest = z.object({
  call: z.object({ port: z.number().int().min(1024).max(65_535), token: z.string().min(24) }),
});

export function isCall(context: Pick<AgentAssemblyContext, "request">): boolean {
  return callRequest.safeParse(context.request.payload).success;
}

/**
 * Hand it work by voice. The call runs over the same assembled partner, so it
 * has the same memory and the same computer. Tools that need approval stay off
 * the call; the partner says it will queue them instead.
 */
export const call = voiceCall({
  room: (context) => {
    const { call: room } = callRequest.parse(context.request.payload);
    return webSocketRoom({ port: room.port, token: room.token, agentName: "Partner" });
  },
  greeting: "The person just called. Greet them by name in one short sentence and ask what they need.",
});
