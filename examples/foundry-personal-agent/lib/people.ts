import type { CreateAgentInstanceOptions, CreateConversationOptions } from "glove-foundry";

/**
 * A person's Muse, as data. One Muse per person, in their own workspace. Its
 * context holds who they are, their WhatsApp number and the Sentinel's list of
 * sites they allowed; its installations are the apps they connected, each with
 * the access they chose. The application seeds a demo person with these
 * through defineAgentInstance, and your app creates everyone else's at signup.
 */
export interface Person {
  readonly id: string;
  readonly name: string;
  /** Their WhatsApp number, digits only with the country code, like 15550101234. */
  readonly phone?: string;
}

export function museFor(person: Person): CreateAgentInstanceOptions {
  return {
    id: `${person.id}-muse`,
    workspaceId: person.id,
    name: "Muse",
    description: `${person.name}'s personal agent`,
    context: {
      name: person.name,
      ...(person.phone ? { phone: person.phone } : {}),
      sentinel: { allowed: [], blocked: [] },
    },
  };
}

/** Its two conversations: the app and WhatsApp. They share one memory. */
export const CHANNELS = { app: "app", whatsapp: "whatsapp" } as const;

export function channel(museId: string, key: keyof typeof CHANNELS): CreateConversationOptions {
  return { id: `${museId}-${key}`, title: key === "app" ? "Muse" : "WhatsApp", context: { conversationKey: CHANNELS[key] } };
}

/** The demo person `pnpm dev` and `pnpm verify` start with. */
export const ROSA: Person = { id: "rosa", name: "Rosa", phone: "15550101234" };
