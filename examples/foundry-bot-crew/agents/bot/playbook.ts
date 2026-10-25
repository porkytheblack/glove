import { composePlaybook } from "glove-foundry";
import { gmailRoutes } from "../../lib/connect.js";
import readMail from "./actions/read-mail.action.js";
import gmailApp from "./apps/gmail.app.js";
import mailReceived from "./events/mail-received.event.js";
import gmail from "./transmissions/gmail.transmission.js";

/** New mail in this person's inbox goes to their main bot, which can reply from their address. */
export function newMailFor(accountId: string) {
  const routes = gmailRoutes(accountId);
  return composePlaybook({
    name: "new-mail",
    transmission: gmail,
    match: { event: mailReceived, routes: [routes.in] },
    directives: [{
      action: readMail,
      instruction:
        "New mail. If it needs an answer, reply from your owner's address with the Gmail send tool (they approve each email). If it belongs to another bot's job, hand it over. Otherwise say in one line what it is.",
    }],
    applications: [gmailApp],
    outbound: [{ route: routes.out, application: gmailApp, instruction: "Reply in the same Gmail thread." }],
  });
}
