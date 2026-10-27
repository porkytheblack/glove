import { handle, liveRun, ownedRun, requirePerson, resumeAfter } from "glove-foundry-web-kit/server";
import { describeTool } from "../../../../server/muse";

export const dynamic = "force-dynamic";

/** A run's live updates, if the run is the person's: streamed text, tools, approvals, the end. */
export const GET = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const run = await ownedRun(person.id, (await params).id);
  return liveRun(run.id, { after: resumeAfter(request), signal: request.signal, describeTool: await describeTool() });
});
