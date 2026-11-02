import { HttpError, handle, notFound, requirePerson } from "glove-foundry-web-kit/server";
import { body } from "../../../server/http";
import { host, writes } from "../../../server/host";
import { museOf } from "../../../server/muse";

/**
 * What Muse may do in one of the person's apps: read, act, or nothing
 * (disconnect). Writes to the installation and the send binding, not a deploy.
 */
export const PUT = handle(async (request: Request, { params }: { params: Promise<{ app: string }> }) => {
  const person = await requirePerson();
  const app = (await params).app;
  const access = (await body(request)).access;
  if (access !== "read" && access !== "act" && access !== "off") throw new HttpError(400, "Choose read, act or off.");
  const { accounts, connect } = await host();
  if (!(connect.APP_NAMES as ReadonlyArray<string>).includes(app)) throw notFound();
  const account = (await accounts.accountsOf(person.id)).find((item) => item.app === app);
  if (!account) throw notFound();
  const muse = await museOf(person.id);
  const foundry = await writes();
  if (access === "off") {
    await connect.disconnect(foundry, muse.id, account.id);
  } else {
    // Keep what it was always allowed to do there.
    const current = muse.installations.find((item) => item.kind === "application" && item.accountId === account.id);
    const alwaysAllow = (current?.config as { alwaysAllow?: string[] } | undefined)?.alwaysAllow ?? [];
    await connect.setAccess(foundry, muse.id, account, access, alwaysAllow);
  }
  return Response.json({ ok: true });
});
