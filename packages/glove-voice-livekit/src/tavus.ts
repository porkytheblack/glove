// ─────────────────────────────────────────────────────────────────────────────
// Tavus over LiveKit.
//
// The SAME Tavus conversation API the echo adapter uses — but instead of
// Tavus hosting a Daily room, the conversation is pointed at OUR LiveKit
// room via `properties.livekit_ws_url` / `properties.livekit_room_token`,
// and the Tavus worker joins it as a participant that renders the agent's
// datastream audio into a talking face. No Daily, no browser courier: the
// interaction channel this adapter needs is the standard avatar RPC set.
// ─────────────────────────────────────────────────────────────────────────────

import type { AvatarView } from "glove-voice-avatar";
import { ensureEchoPal } from "glove-voice-avatar";
import { LiveKitAvatarSession } from "./session";
import type { AvatarWire } from "./wire";

/** The identity Tavus's worker joins under — mint the avatar token for it. */
export const TAVUS_AVATAR_IDENTITY = "tavus-avatar-agent";

export interface TavusLiveKitConfig {
  apiKey: string;
  /** The face to render. Required — Tavus conversations need one. */
  faceId: string;
  /** Reuse a specific PAL. Omit to ensure glove's minimal echo PAL — same
   *  reuse-by-name behaviour as the echo adapter, no second voice. */
  palId?: string;
  /** Name for the ensured PAL when `palId` is omitted. */
  palName?: string;
  /** Defaults to "" — an ABSENT greeting makes Tavus speak a stock one in
   *  its own voice over the agent's stream. */
  greeting?: string;

  /** The LiveKit server the room lives on (wss://…). Handed to Tavus. */
  livekitUrl: string;
  /** A join token for the avatar worker — mint with `mintAvatarToken`
   *  (identity `TAVUS_AVATAR_IDENTITY`, on behalf of the agent). */
  avatarToken: string;
  /** The room leg: `new RoomAvatarWire(room, TAVUS_AVATAR_IDENTITY)` in
   *  production, a fake in tests. */
  wire: AvatarWire;

  apiBase?: string;
  fetchFn?: typeof fetch;
}

export class TavusLiveKitAvatar extends LiveKitAvatarSession {
  private conversationId: string | null = null;

  constructor(private readonly cfg: TavusLiveKitConfig) {
    super(cfg.wire);
    if (!cfg.apiKey) throw new Error("TavusLiveKitConfig.apiKey is required");
    if (!cfg.faceId) throw new Error("TavusLiveKitConfig.faceId is required");
    if (!cfg.livekitUrl || !cfg.avatarToken)
      throw new Error("TavusLiveKitConfig needs livekitUrl + avatarToken — the worker joins YOUR room");
  }

  protected async openSession(): Promise<AvatarView> {
    const doFetch = this.cfg.fetchFn ?? fetch;
    const base = (this.cfg.apiBase ?? "https://tavusapi.com").replace(/\/$/, "");

    const palId =
      this.cfg.palId ??
      (await ensureEchoPal({
        apiKey: this.cfg.apiKey,
        faceId: this.cfg.faceId,
        name: this.cfg.palName,
        apiBase: base,
        fetchFn: this.cfg.fetchFn,
      }));

    const res = await doFetch(`${base}/v2/conversations`, {
      method: "POST",
      headers: { "x-api-key": this.cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        pal_id: palId,
        face_id: this.cfg.faceId,
        custom_greeting: this.cfg.greeting ?? "",
        properties: {
          livekit_ws_url: this.cfg.livekitUrl,
          livekit_room_token: this.cfg.avatarToken,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Tavus conversation create failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { conversation_id?: string };
    if (!body.conversation_id) throw new Error("Tavus returned no conversation_id");
    this.conversationId = body.conversation_id;

    // The face arrives IN the LiveKit room — clients already attached to the
    // room see it as another participant's tracks; nothing extra to join.
    return { kind: "webrtc-room", url: this.cfg.livekitUrl, provider: "tavus-livekit" };
  }

  protected async closeSession(): Promise<void> {
    if (!this.conversationId) return;
    const doFetch = this.cfg.fetchFn ?? fetch;
    const base = (this.cfg.apiBase ?? "https://tavusapi.com").replace(/\/$/, "");
    await doFetch(`${base}/v2/conversations/${this.conversationId}/end`, {
      method: "POST",
      headers: { "x-api-key": this.cfg.apiKey },
    }).catch(() => {});
    this.conversationId = null;
  }
}
