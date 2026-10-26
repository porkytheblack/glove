import type { CreateAgentInstanceOptions, CreateConversationOptions } from "glove-foundry";

/**
 * A person's Muse, as data. One Muse per person, in their own workspace. Its
 * name is the one they gave it; its context holds who they are, their
 * WhatsApp number, how they want it to look and talk, and the Sentinel's
 * lists of sites they allowed; its installations are the apps they connected,
 * each with the access they chose. The application seeds a demo person with
 * these through defineAgentInstance, and your app creates everyone else's at
 * signup.
 */
export interface Person {
  readonly id: string;
  readonly name: string;
  /** Their WhatsApp number, digits only with the country code, like 15550101234. */
  readonly phone?: string;
  /** What they call their agent. Muse unless they choose. */
  readonly agentName?: string;
  /** Its picture, as a URL your app shows. */
  readonly avatar?: string;
  /** How they want it to talk to them, in their words. */
  readonly style?: string;
}

/** A person's Muse's id. */
export const museId = (personId: string) => `${personId}-muse`;

export function museFor(person: Person): CreateAgentInstanceOptions {
  return {
    id: museId(person.id),
    workspaceId: person.id,
    name: person.agentName ?? "Muse",
    description: `${person.name}'s personal agent`,
    context: {
      name: person.name,
      ...(person.phone ? { phone: person.phone } : {}),
      persona: { ...(person.avatar ? { avatar: person.avatar } : {}), ...(person.style ? { style: person.style } : {}) },
      sentinel: { read: [], write: [], blocked: [] },
    },
  };
}

/** Its two conversations: the app and WhatsApp. They share one memory. */
export const CHANNELS = { app: "app", whatsapp: "whatsapp" } as const;

export function channel(agentId: string, key: keyof typeof CHANNELS): CreateConversationOptions {
  return { id: `${agentId}-${key}`, title: key === "app" ? "Muse" : "WhatsApp", context: { conversationKey: CHANNELS[key] } };
}

/** The demo person `pnpm dev` and `pnpm verify` start with. */
export const ROSA: Person = { id: "rosa", name: "Rosa", phone: "15550101234", style: "Warm and brief, like a text from a friend. No exclamation marks." };
