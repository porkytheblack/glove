import { unavailable } from "../../lib/server/foundry";
import { visitOf } from "../../lib/server/visit";

export const dynamic = "force-dynamic";

/** A conversation's bag and orders. */
export async function GET(request: Request): Promise<Response> {
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!conversationId) return Response.json({ error: "conversationId is required." }, { status: 400 });
  try {
    return Response.json(await visitOf(conversationId));
  } catch (error) {
    return unavailable(error);
  }
}
