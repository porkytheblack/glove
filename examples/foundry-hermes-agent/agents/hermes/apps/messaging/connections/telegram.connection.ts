import { Effect } from "effect";
import { defineConnection, type ApplicationConnectionContext } from "glove-foundry";
import type { HermesMessengerSession } from "../../../../../lib/account-sessions.js";
import {
  telegramCall,
  telegramDisplayName,
  type TelegramUpdate,
} from "../../../../../lib/telegram.js";
import chat from "../transmissions/chat.transmission.js";

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function providerOf(route: ApplicationConnectionContext["routes"][number]): string | undefined {
  return route.config && typeof route.config === "object" && "provider" in route.config
    ? String(route.config.provider)
    : undefined;
}

async function listen(
  context: ApplicationConnectionContext,
  session: HermesMessengerSession,
): Promise<void> {
  const route = context.routes.find((candidate) => providerOf(candidate) === "telegram");
  if (!route || session.provider !== "telegram") {
    await Effect.runPromise(context.ready());
    await waitForAbort(context.signal);
    return;
  }

  await telegramCall(session, "getMe", {}, context.signal);
  await Effect.runPromise(context.ready());
  let offset = 0;
  const timeout = Math.max(1, Math.min(50, Number(process.env.TELEGRAM_LONG_POLL_SECONDS ?? 25)));
  while (!context.signal.aborted) {
    const updates = await telegramCall<ReadonlyArray<TelegramUpdate>>(
      session,
      "getUpdates",
      { offset, timeout, allowed_updates: ["message"] },
      context.signal,
    );
    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      const message = update.message;
      const text = message?.text ?? message?.caption;
      if (!message || !text?.trim()) continue;
      await Effect.runPromise(context.receive({
        route,
        eventId: `telegram:${update.update_id}`,
        threadKey: String(message.chat.id),
        raw: {
          sender: telegramDisplayName(message.from),
          thread: String(message.chat.id),
          text,
        },
      }));
    }
  }
}

const telegram = defineConnection({
  description: "Telegram Bot API long polling with supervised reconnect and deduplicated ingress",
  transmissions: [chat],
  connect: (context) => {
    if (!context.withAccountSession) {
      return Effect.fail(new Error("Telegram ingress requires an installed account session adapter."));
    }
    return context.withAccountSession("telegram:listen", (session) => Effect.tryPromise({
      try: () => listen(context, session as HermesMessengerSession),
      catch: (cause) => cause,
    }));
  },
});

export default telegram;
