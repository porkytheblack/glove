import { HttpError, handle, requirePerson } from "glove-foundry-web-kit/server";
import { demoState, sendMail } from "../../server/demo";
import { body, text } from "../../server/http";

/** The delivery log, and the bots the latest mail woke, for the signed-in person. */
export const GET = handle(async () => {
  const person = await requirePerson();
  return Response.json(await demoState(person.id));
});

/** Send as the mock mail: new mail to the person's Gmail. */
export const POST = handle(async (request: Request) => {
  const person = await requirePerson();
  const input = await body(request);
  if (input.kind !== "mail") throw new HttpError(400, "Send a mail.");
  const from = text(input.from, "From", 320);
  if (!/^[^@\s]+@[^@\s]+$/.test(from.replace(/^.*<([^>]+)>$/, "$1"))) throw new HttpError(400, "From needs an email address.");
  return Response.json(await sendMail(person.id, { from, subject: text(input.subject, "The subject", 200), body: text(input.body, "The message", 4000) }));
});
