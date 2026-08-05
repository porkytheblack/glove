// ─────────────────────────────────────────────────────────────────────────────
// Anam over LiveKit.
//
// Anam's LiveKit integration is a two-step handshake: a session token minted
// with the persona config AND the LiveKit room coordinates baked in
// (`environment.livekitUrl` / `environment.livekitToken`, `llmId:
// "CUSTOMER_CLIENT_V1"` marking the brain as ours), then an engine-session
// start authorized BY that token, which makes the avatar worker join the
// room. Driving it is the shared datastream protocol.
//
// Written against Anam's documented API + the conformance suite; live
// verification pending an Anam key (#71's posture).
// ─────────────────────────────────────────────────────────────────────────────

import type { AvatarView } from "glove-voice-avatar";
import { LiveKitAvatarSession } from "./session";
import type { AvatarWire } from "./wire";

/** The identity Anam's worker joins under — mint the avatar token for it. */
export const ANAM_AVATAR_IDENTITY = "anam-avatar-agent";

export interface AnamLiveKitConfig {
  apiKey: string;
  /** The Anam avatar to render. */
  avatarId: string;
  /** Persona display name; cosmetic. */
  name?: string;
  /** Session lifetime cap, seconds (default 3600) — Anam's own default is
   *  short and darkens the face mid-call. */
  maxSessionLengthSeconds?: number;
  /** Silence window before Anam auto-ends the session (default 7200, the
   *  documented max — effectively off; conversational pauses must not kill
   *  the session). */
  silenceBeforeSessionEndSeconds?: number;

  /** The LiveKit server the room lives on (wss://…). Handed to Anam. */
  livekitUrl: string;
  /** A join token for the avatar worker — mint with `mintAvatarToken`
   *  (identity `ANAM_AVATAR_IDENTITY`, on behalf of the agent). */
  avatarToken: string;
  /** The room leg: `new RoomAvatarWire(room, ANAM_AVATAR_IDENTITY)` in
   *  production, a fake in tests. */
  wire: AvatarWire;

  apiBase?: string;
  fetchFn?: typeof fetch;
}

export class AnamLiveKitAvatar extends LiveKitAvatarSession {
  private sessionToken: string | null = null;

  constructor(private readonly cfg: AnamLiveKitConfig) {
    super(cfg.wire);
    if (!cfg.apiKey) throw new Error("AnamLiveKitConfig.apiKey is required");
    if (!cfg.avatarId) throw new Error("AnamLiveKitConfig.avatarId is required");
    if (!cfg.livekitUrl || !cfg.avatarToken)
      throw new Error("AnamLiveKitConfig needs livekitUrl + avatarToken — the worker joins YOUR room");
  }

  protected async openSession(): Promise<AvatarView> {
    const doFetch = this.cfg.fetchFn ?? fetch;
    const base = (this.cfg.apiBase ?? "https://api.anam.ai").replace(/\/$/, "");

    const tokenRes = await doFetch(`${base}/v1/auth/session-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personaConfig: {
          name: this.cfg.name ?? "glove-avatar",
          avatarId: this.cfg.avatarId,
          // The agent IS the brain — Anam must not run its own LLM.
          llmId: "CUSTOMER_CLIENT_V1",
          maxSessionLengthSeconds: this.cfg.maxSessionLengthSeconds ?? 3_600,
          voiceDetectionOptions: {
            silenceBeforeSessionEndSeconds: this.cfg.silenceBeforeSessionEndSeconds ?? 7_200,
          },
        },
        environment: {
          livekitUrl: this.cfg.livekitUrl,
          livekitToken: this.cfg.avatarToken,
        },
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`Anam session token failed: ${tokenRes.status} ${await tokenRes.text()}`);
    }
    const tokenBody = (await tokenRes.json()) as { sessionToken?: string };
    if (!tokenBody.sessionToken) throw new Error("Anam returned no sessionToken");
    this.sessionToken = tokenBody.sessionToken;

    const engineRes = await doFetch(`${base}/v1/engine/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!engineRes.ok) {
      throw new Error(`Anam engine session failed: ${engineRes.status} ${await engineRes.text()}`);
    }

    return { kind: "webrtc-room", url: this.cfg.livekitUrl, provider: "anam-livekit" };
  }

  protected async closeSession(): Promise<void> {
    // Anam exposes no explicit end call in this flow — the worker leaves when
    // the room closes or its token expires.
    this.sessionToken = null;
  }
}
