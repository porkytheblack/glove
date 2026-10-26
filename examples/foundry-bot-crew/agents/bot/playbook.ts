import { composePlaybook } from "glove-foundry";
import { gmailRoutes } from "../../lib/connect.js";
import type { EventRoutine } from "../../lib/people.js";
import readMail from "./actions/read-mail.action.js";
import gmailApp from "./apps/gmail.app.js";
import mailReceived from "./events/mail-received.event.js";
import gmail from "./transmissions/gmail.transmission.js";

/**
 * The routines that run on new mail, on the bot they belong to: one
 * directive each. The bot answers in its own chat and can reply from its
 * owner's address.
 */
export function newMailFor(accountId: string, routines: ReadonlyArray<EventRoutine>) {
  const routes = gmailRoutes(accountId);
  return composePlaybook({
    name: "new-mail",
    transmission: gmail,
    match: { event: mailReceived, routes: [routes.in] },
    directives: routines.map((routine) => ({
      action: readMail,
      instruction: [
        routine.skill ? `Run the ${routine.skill} skill; read it with glove_read_skill first.` : "",
        routine.instruction,
        "To answer, reply from your owner's address with the Gmail send tool (they approve each email). If it is a sibling's job, hand it over.",
      ].filter(Boolean).join(" "),
    })),
    applications: [gmailApp],
    outbound: [{ route: routes.out, application: gmailApp, instruction: "Reply in the same Gmail thread." }],
  });
}
