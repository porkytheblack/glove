import { HttpError, handle, requirePerson } from "glove-foundry-web-kit/server";
import { demoState, sendMail, sendSlack, type SlackPlace } from "../../server/demo";
import { body, text } from "../../server/http";

const PLACES: ReadonlyArray<SlackPlace> = ["dm", "channel", "teammate"];

/** The mock Slack's conversations and the delivery log, for the signed-in person. */
export const GET = handle(async () => {
  const person = await requirePerson();
  return Response.json(await demoState(person.id));
});

/** Send as a mock provider: a Slack message to the dot, or new mail to the inbox it watches. */
export const POST = handle(async (request: Request) => {
  const person = await requirePerson();
  const input = await body(request);
  if (input.kind === "slack") {
    if (!PLACES.includes(input.place as SlackPlace)) throw new HttpError(400, "Send in your DM, #feedback or a teammate's DM.");
    return Response.json(await sendSlack(person.id, input.place as SlackPlace, text(input.text, "The message", 1000)));
  }
  if (input.kind === "mail") {
    const from = text(input.from, "From", 320);
    if (!/^[^@\s]+@[^@\s]+$/.test(from.replace(/^.*<([^>]+)>$/, "$1"))) throw new HttpError(400, "From needs an email address.");
    return Response.json(await sendMail(person.id, { from, subject: text(input.subject, "The subject", 200), body: text(input.body, "The message", 4000) }));
  }
  throw new HttpError(400, "Send a Slack message or a mail.");
});
