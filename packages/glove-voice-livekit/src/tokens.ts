// Token minting for the three parties in a LiveKit voice room: the agent
// (server-side, publishes voice or feeds an avatar), callers (browsers), and
// the avatar worker the provider spawns into the room. All server-side —
// browsers and providers only ever see finished JWTs.

import { AccessToken } from "livekit-server-sdk";
import { ATTRIBUTE_PUBLISH_ON_BEHALF } from "./wire";

export interface TokenCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface MintTokenOptions {
  roomName: string;
  identity: string;
  name?: string;
  /** Seconds. Rooms are call-length; default one hour. */
  ttl?: number;
}

/** A participant token: join, publish, subscribe, data. Callers and agents. */
export async function mintParticipantToken(
  creds: TokenCredentials,
  opts: MintTokenOptions,
): Promise<string> {
  const at = new AccessToken(creds.apiKey, creds.apiSecret, {
    identity: opts.identity,
    name: opts.name ?? opts.identity,
    ttl: opts.ttl ?? 3_600,
  });
  at.addGrant({
    roomJoin: true,
    room: opts.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}

export interface MintAvatarTokenOptions extends MintTokenOptions {
  /** The agent identity whose voice the avatar renders — stamped into the
   *  token as `lk.publish_on_behalf` so frontends attribute the avatar's
   *  tracks to the agent (LiveKit's `useVoiceAssistant` does this natively). */
  onBehalfOf: string;
}

/** The avatar worker's token: kind `agent`, publishing on the agent's behalf. */
export async function mintAvatarToken(
  creds: TokenCredentials,
  opts: MintAvatarTokenOptions,
): Promise<string> {
  const at = new AccessToken(creds.apiKey, creds.apiSecret, {
    identity: opts.identity,
    name: opts.name ?? opts.identity,
    ttl: opts.ttl ?? 3_600,
    attributes: { [ATTRIBUTE_PUBLISH_ON_BEHALF]: opts.onBehalfOf },
  });
  at.kind = "agent";
  at.addGrant({
    roomJoin: true,
    room: opts.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}
