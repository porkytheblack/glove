import { HttpError, handle, requirePerson } from "glove-foundry-web-kit/server";
import { demoState, sendMail, sendWhatsApp } from "../../server/demo";
import { body, text } from "../../server/http";

/** The mock WhatsApp's conversations and the delivery log, for the signed-in person. */
export const GET = handle(async () => {
  const person = await requirePerson();
  return Response.json(await demoState(person.id));
});

/** Send as a mock provider: a WhatsApp message to Muse, or new mail to the person's Gmail. */
export const POST = handle(async (request: Request) => {
  const person = await requirePerson();
  const input = await body(request);
  if (input.kind === "whatsapp") {
    if (input.from !== "me" && input.from !== "stranger") throw new HttpError(400, "Send from your phone or a stranger's.");
    return Response.json(await sendWhatsApp(person.id, input.from, text(input.text, "The message", 1000)));
  }
  if (input.kind === "mail") {
    const from = text(input.from, "From", 320);
    if (!/^[^@\s]+@[^@\s]+$/.test(from.replace(/^.*<([^>]+)>$/, "$1"))) throw new HttpError(400, "From needs an email address.");
    return Response.json(await sendMail(person.id, { from, subject: text(input.subject, "The subject", 200), body: text(input.body, "The message", 4000) }));
  }
  throw new HttpError(400, "Send a WhatsApp message or a mail.");
});
