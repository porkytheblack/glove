import { NextResponse } from "next/server";
import { handle, notFound, requirePerson } from "glove-foundry-web-kit/server";
import { museOf, pendingHandOff } from "../../../server/muse";

export const dynamic = "force-dynamic";

/**
 * "Take over to sign in": the signed-in person's own pending hand-off, as a
 * redirect to Kuiper's interactive live view. The link is never in a page or
 * an API response; it lives host-side until the browser session closes.
 */
export const GET = handle(async () => {
  const person = await requirePerson();
  const handOff = await pendingHandOff(person.id, await museOf(person.id));
  if (!handOff || !/^https?:\/\//.test(handOff.url)) throw notFound();
  return new NextResponse(null, {
    status: 303,
    headers: { location: handOff.url, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
});
