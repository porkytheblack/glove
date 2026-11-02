import { composePlaybook } from "glove-foundry";
import { gmailRoutes } from "../../lib/connect.js";
import readMail from "./actions/read-mail.action.js";
import gmailApp from "./apps/gmail.app.js";
import mailReceived from "./events/mail-received.event.js";
import gmail from "./transmissions/gmail.transmission.js";

/**
 * New mail in the person's inbox comes to the partner in their one thread.
 * It decides whether the mail needs them before the next check-in.
 */
export function newMailFor(accountId: string) {
  const routes = gmailRoutes(accountId);
  return composePlaybook({
    name: "new-mail",
    transmission: gmail,
    match: { event: mailReceived, routes: [routes.in] },
    directives: [{
      action: readMail,
      instruction:
        "New mail. If it needs the person before the next check-in, tell them once with notify_person, saying what and why. Otherwise do not notify, and reply exactly: (nothing new)",
    }],
    applications: [gmailApp],
    outbound: [{ route: routes.out, application: gmailApp, instruction: "Reply in the same Gmail thread." }],
  });
}
