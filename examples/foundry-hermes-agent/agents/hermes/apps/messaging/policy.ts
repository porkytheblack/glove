import { composePlaybook } from "glove-foundry";
import messaging from "../messaging.app.js";
import { chatInbound, chatOutbound, fileInbound, operatorAccount } from "../../topology.js";
import ingestFile from "./actions/ingest-file.action.js";
import respond from "./actions/respond.action.js";
import fileReceived from "./events/file-received.event.js";
import messageReceived from "./events/message-received.event.js";
import messageSent from "./events/message-sent.event.js";
import addressed from "./predicates/addressed.predicate.js";
import chat from "./transmissions/chat.transmission.js";
import fileDrop from "./transmissions/file-drop.transmission.js";

/** Data-only messaging policy reusable by runtime instances and subscriptions. */
export function messagingPlaybooks(agentName: string) {
  return [
    composePlaybook({
      name: "answer-addressed-messages",
      transmission: chat,
      match: {
        event: messageReceived,
        routes: [chatInbound],
        predicate: { definition: addressed, parameters: { name: agentName } },
      },
      directives: [{
        action: respond,
        instruction: "Understand the inbound message, complete useful work, and answer on its originating thread.",
        parameters: { preserveThread: true },
      }],
      applications: [messaging],
      outbound: [{
        route: chatOutbound,
        application: messaging,
        account: operatorAccount,
        applicationAccount: operatorAccount,
        event: messageSent,
        instruction: "Return the completed response to the source thread.",
      }],
      serialization: { envelope: "xml", payload: "json" },
    }),
    composePlaybook({
      name: "ingest-delivered-files",
      transmission: fileDrop,
      match: { event: fileReceived, routes: [fileInbound] },
      directives: [{
        action: ingestFile,
        instruction: "Place the delivered content in /inbox, inspect it, and create any requested derived artefacts in /out.",
      }],
      applications: [messaging],
      serialization: { envelope: "xml", payload: "json" },
    }),
  ] as const;
}
