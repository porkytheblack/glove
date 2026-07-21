import type { SpeakerRole } from "../shared/types";

export interface ScenarioLine {
  speaker: SpeakerRole;
  text: string;
}

export interface Scenario {
  id: string;
  title: string;
  blurb: string;
  lines: ScenarioLine[];
}

// Scripted multi-party scenes. Each one exercises a specific behavior; play them
// end-to-end to watch the monitor, the delegation, and the proactive relay work.
export const SCENARIOS: Scenario[] = [
  {
    id: "addressed-vs-overheard",
    title: "Addressed vs. overheard",
    blurb:
      "The customer talks to Sam (Nova stays quiet), then Sam asks Nova — who delegates a history lookup.",
    lines: [
      { speaker: "customer", text: "Morning Sam — I finally hauled the Rustbucket in for you." },
      { speaker: "operator", text: "Good to see it. Let's take a look." },
      { speaker: "operator", text: "Nova, can you pull up the service history on Dr. Okonkwo's hull, KES-0007?" },
    ],
  },
  {
    id: "customer-to-nova",
    title: "Customer speaks to Nova directly",
    blurb:
      "A different person in the room addresses Nova. The monitor should route it to the assistant and Nova checks the warranty.",
    lines: [
      { speaker: "customer", text: "Hey Nova — is the warranty still good on the Rustbucket?" },
    ],
  },
  {
    id: "side-chat-then-question",
    title: "Side chat, then a real request",
    blurb:
      "Kit and Sam chat (overheard), then Sam asks Nova a catalog question. Nova ignores the chatter and answers only the request.",
    lines: [
      { speaker: "bystander", text: "Sam, bay three's open if you want it for the miner." },
      { speaker: "operator", text: "Thanks Kit, give me five." },
      { speaker: "operator", text: "Nova, what interceptors do we have on the lot under one and a half million?" },
    ],
  },
  {
    id: "sales-financing",
    title: "Sales + financing",
    blurb:
      "The customer asks Nova about upgrading. Worker pulls model specs and financing estimates; Nova relays them.",
    lines: [
      { speaker: "customer", text: "Nova, I've been thinking about an upgrade. What does a Pathfinder Explorer go for, and could I finance it on a Preferred account?" },
    ],
  },
  {
    id: "ambiguous",
    title: "Ambiguous address",
    blurb:
      "A vague line with no clear addressee. The monitor should flag it ambiguous — and Nova stays out of it.",
    lines: [
      { speaker: "customer", text: "So... what do you reckon, then?" },
    ],
  },
];
