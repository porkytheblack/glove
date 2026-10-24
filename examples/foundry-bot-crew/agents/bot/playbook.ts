import { composePlaybook } from "glove-foundry";
import xApp from "./apps/x.app.js";
import mention from "./events/mention.event.js";
import fromOwner from "./predicates/from-owner.predicate.js";
import takeTask from "./actions/take-task.action.js";
import { xMentionsIn } from "./topology.js";
import xMentions from "./transmissions/x-mentions.transmission.js";

/** When this person tags the bot on X, the post is a task for their chief. */
export function mentionsFrom(authorId: string) {
  return composePlaybook({
    name: "x-mentions",
    transmission: xMentions,
    match: {
      event: mention,
      routes: [xMentionsIn],
      predicate: { definition: fromOwner, parameters: { authorId } },
    },
    directives: [{
      action: takeTask,
      instruction:
        "First reply on X with reply_on_x: one short sentence saying you are on it. Then do the work in this thread: hand it to the right bot.",
    }],
    applications: [xApp],
  });
}
