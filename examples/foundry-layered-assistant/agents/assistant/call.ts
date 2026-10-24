import type { AgentAssemblyContext } from "glove-foundry";
import { voiceCall, webSocketRoom } from "glove-foundry/voice";
import { z } from "zod";

/** How the app starts a call: the port the page will connect to, and a one-time token. */
export const callRequest = z.object({
  call: z.object({
    port: z.number().int().min(1024).max(65_535),
    token: z.string().min(24),
  }),
});

export function isCall(context: Pick<AgentAssemblyContext, "request">): boolean {
  return callRequest.safeParse(context.request.payload).success;
}

/**
 * A live call. Foundry runs the speech session over the assembled agent, so
 * the call has the same memory and delegates as the chat. Results that land
 * mid-call are spoken at the next pause.
 */
export const call = voiceCall({
  room: (context) => {
    const { call: room } = callRequest.parse(context.request.payload);
    return webSocketRoom({ port: room.port, token: room.token, agentName: "Iris" });
  },
  greeting: "The person just called. Greet them in one short sentence, by name if you know it.",
});
