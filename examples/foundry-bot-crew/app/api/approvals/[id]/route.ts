import { HttpError, foundry, handle, ownedAgent, ownedApproval, requirePerson } from "glove-foundry-web-kit/server";
import { alwaysAllowable } from "../../../server/crew";
import { host, writes } from "../../../server/host";
import { body } from "../../../server/http";

/**
 * Allow once, deny, or always allow. "Always allow" adds the tool to the
 * bot's installation of that app (its alwaysAllow), then approves this one.
 */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const approval = await ownedApproval(person.id, (await params).id);
  if (approval.status !== "pending") throw new HttpError(409, "This was already decided.");
  const decision = (await body(request)).decision;
  if (decision !== "approve" && decision !== "deny" && decision !== "always") throw new HttpError(400, "Decide approve, deny or always.");

  if (decision === "always") {
    const bot = await ownedAgent(person.id, approval.agentId);
    const allowable = alwaysAllowable(approval, bot);
    if (!allowable) throw new HttpError(400, "This one always asks.");
    const { accounts, connect } = await host();
    const account = (await accounts.accountsOf(person.id)).find((item) => item.id === allowable.installation.accountId);
    if (!account) throw new HttpError(409, "That app's account isn't connected any more.");
    const config = (allowable.installation.config ?? {}) as { alwaysAllow?: string[]; alwaysAsk?: string[] };
    const installation = connect.installationFor(account, [...new Set([...(config.alwaysAllow ?? []), allowable.tool])], config.alwaysAsk ?? []);
    await (await writes()).install(bot.id, installation);
  }

  await foundry().resolveApproval(approval.id, decision === "deny" ? "deny" : "approve");
  return Response.json({ ok: true });
});
