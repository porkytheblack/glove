import { composePlaybook, type AgentAssemblyContext } from "glove-foundry";
import { gmailRoutes, whatsappFor } from "../../lib/connect.js";
import answer from "./actions/answer.action.js";
import readMail from "./actions/read-mail.action.js";
import gmailApp from "./apps/gmail.app.js";
import whatsappApp from "./apps/whatsapp.app.js";
import mailReceived from "./events/mail-received.event.js";
import message from "./events/message.event.js";
import fromPerson from "./predicates/from-person.predicate.js";
import { whatsappIn } from "./topology.js";
import gmail from "./transmissions/gmail.transmission.js";
import whatsapp from "./transmissions/whatsapp.transmission.js";

/** The person's own WhatsApp messages reach their Muse, which answers there. */
export function whatsappFrom(agentId: string, person: { readonly id: string; readonly phone: string }) {
  return composePlaybook({
    name: "whatsapp",
    transmission: whatsapp,
    match: { event: message, routes: [whatsappIn], predicate: { definition: fromPerson, parameters: { phone: person.phone } } },
    directives: [{ action: answer, instruction: "Answer on WhatsApp with the WhatsApp send tool. Keep it short, like a text." }],
    applications: [whatsappApp],
    outbound: [{ route: whatsappFor(agentId, person).out, application: whatsappApp, instruction: "Answer the person here." }],
  });
}

/** New mail: Muse reads it, and tells the person only if something changed that they should know now. */
export function newMailFor(accountId: string) {
  return composePlaybook({
    name: "new-mail",
    transmission: gmail,
    match: { event: mailReceived, routes: [gmailRoutes(accountId).in] },
    directives: [{
      action: readMail,
      instruction:
        "New mail. If it changes something the person cares about (a plan, a booking, a bill), tell them on WhatsApp in one or two lines and offer what you could do. Otherwise note it in one line here.",
    }],
    applications: [gmailApp],
  });
}

/** WhatsApp once the person gave their number; new mail once Gmail is connected. */
export function musePlaybooks({ agentId, agentInstance, installations }: Pick<AgentAssemblyContext, "agentId" | "agentInstance" | "installations">) {
  const phone = typeof agentInstance.context.phone === "string" ? agentInstance.context.phone : undefined;
  const mail = installations.find((item) => item.kind === "application" && item.id === gmailApp.id);
  return [
    ...(phone ? [whatsappFrom(agentId, { id: agentInstance.workspaceId, phone })] : []),
    ...(mail?.accountId ? [newMailFor(mail.accountId)] : []),
  ];
}
