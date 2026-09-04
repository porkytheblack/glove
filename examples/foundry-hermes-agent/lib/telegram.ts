import type { HermesMessengerSession } from "./account-sessions.js";

interface TelegramEnvelope<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly description?: string;
}

export interface TelegramUser {
  readonly id: number;
  readonly username?: string;
  readonly first_name?: string;
  readonly last_name?: string;
}

export interface TelegramMessage {
  readonly message_id: number;
  readonly from?: TelegramUser;
  readonly chat: { readonly id: number; readonly type: string };
  readonly text?: string;
  readonly caption?: string;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
}

export async function telegramCall<T>(
  session: HermesMessengerSession,
  method: string,
  body: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<T> {
  if (session.provider !== "telegram" || !session.token) {
    throw new Error(`Telegram operation "${method}" requires a Telegram account session.`);
  }
  const response = await fetch(
    `${session.apiBaseUrl.replace(/\/$/, "")}/bot${encodeURIComponent(session.token)}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  );
  let envelope: TelegramEnvelope<T>;
  try {
    envelope = await response.json() as TelegramEnvelope<T>;
  } catch {
    throw new Error(`Telegram ${method} returned an unreadable HTTP ${response.status} response.`);
  }
  if (!response.ok || !envelope.ok || envelope.result === undefined) {
    throw new Error(`Telegram ${method} failed: ${envelope.description ?? `HTTP ${response.status}`}`);
  }
  return envelope.result;
}

export function telegramDisplayName(user: TelegramUser | undefined): string {
  if (!user) return "telegram-user";
  if (user.username) return `@${user.username}`;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || String(user.id);
}
