import { Effect } from "effect";
import type { IGloveRunnable } from "glove-core";
import { mountBrowser } from "glove-execution";
import { kuiperBrowser, type KuiperHandOff } from "glove-execution/kuiper";
import type { AgentAssemblyContext, FoundryExecutionContext } from "glove-foundry";
import { chromium } from "playwright-core";
import { logActivity } from "../../lib/activity.js";
import { identify, kuiper } from "../../lib/kuiper.js";
import { record } from "../../lib/ledger.js";
import { sendText } from "../../lib/whatsapp.js";
import { sentinelFor } from "./sentinel.js";

/**
 * Muse's browser: a real Chrome on Kuiper, one per person, kept between runs.
 * What the instance remembers is two IDs in its context: the person's profile
 * (their logins, saved when a session ends) and the session Muse is using.
 * Kuiper sessions belong to the project, so the next run reconnects to the
 * same browser by ID, and a session nobody uses hibernates on its own.
 *
 * - The Sentinel is the browser's guard: every request it makes passes it first.
 * - It says it is an agent: its tabs add AGENT_TOKEN to the browser's own
 *   user agent (lib/kuiper.ts).
 * - Signing in is the person's: browser.handOff sends them Kuiper's live view
 *   of this browser on WhatsApp, from here, so the link never reaches Muse.
 *   They sign in; the cookies stay in the browser, and in their profile once
 *   Muse closes it.
 * - Watching is theirs too: the session's view-only live view is kept here
 *   for their app's Watch link. The prompt never reads it.
 */

export interface MuseBrowser {
  /** The person's Kuiper browser profile: their logins. */
  readonly profileId?: string;
  /** The session Muse is using, kept between runs. */
  readonly sessionId?: string;
  /** That session's view-only live view, for the person's app to show. Host code only: never in the prompt. */
  readonly watchUrl?: string;
}

export const browserOf = (context: Readonly<Record<string, unknown>>): MuseBrowser => (context.browser ?? {}) as MuseBrowser;

async function remember(ctx: Pick<AgentAssemblyContext, "agentId" | "data">, change: MuseBrowser): Promise<void> {
  const current = await Effect.runPromise(ctx.data.getAgent(ctx.agentId));
  if (!current) return;
  await Effect.runPromise(ctx.data.putAgent({
    ...current,
    context: { ...current.context, browser: { ...browserOf(current.context), ...change } },
    updatedAt: new Date().toISOString(),
  }));
}

/** The live view goes to the person on WhatsApp, straight from here. */
async function sendLiveView(ctx: Pick<AgentAssemblyContext, "agentInstance" | "workspaceId">, handOff: KuiperHandOff): Promise<void> {
  const to = ctx.agentInstance.context.phone;
  if (typeof to !== "string") throw new Error("There is no private way to reach the person: add their WhatsApp number.");
  const name = ctx.agentInstance.name ?? "Muse";
  const text = `${name} needs you for one step: ${handOff.reason}. This link opens ${name}'s browser for you (it is yours only): ${handOff.url}`;
  const token = process.env.WHATSAPP_TOKEN;
  if (token) await sendText(token, { phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "", to, text });
  else await record({ kind: "whatsapp", to, text, messageId: `offline-wa-${Date.now().toString(36)}` });
  await logActivity({ person: ctx.workspaceId, kind: "browser", what: `handed the browser over on ${handOff.page.url}`, outcome: "sent the person a link", detail: handOff.reason });
}

/** In `configure`: mounts execute_browser when Kuiper is there. */
export function mountMuseBrowser(agent: IGloveRunnable, ctx: FoundryExecutionContext): void {
  const gateway = kuiper();
  if (!gateway) return;
  const saved = browserOf(ctx.agentInstance.context);
  const adapter = kuiperBrowser({
    browsers: gateway.browsers,
    sessionIds: saved.sessionId ? [saved.sessionId] : [],
    session: {
      ...(saved.profileId ? { profileId: saved.profileId } : {}),
      persistProfile: true,
      timeout: 2 * 60 * 60_000,
      inactivityTimeout: 10 * 60_000,
      dimensions: { width: 1280, height: 800 },
      // Hibernate when nobody uses it; record it, so your app can show a replay (session.recording()).
      kuiper: { onInactive: "hibernate", record: true },
    },
    cleanup: "keep",
    guard: sentinelFor(ctx).guard,
    // Playwright over CDP, as by default, and the tabs say they are an agent.
    connect: async (url) => {
      const browser = await chromium.connectOverCDP(url, { timeout: 60_000 });
      await identify(browser);
      return browser;
    },
    onHandOff: (handOff) => sendLiveView(ctx, handOff),
    onOpen: async (session) => {
      await remember(ctx, {
        sessionId: session.id,
        ...(session.profileId ? { profileId: session.profileId } : {}),
        ...(session.debugUrl ? { watchUrl: session.debugUrl } : {}),
      });
      await logActivity({ person: ctx.workspaceId, kind: "browser", what: "opened a browser", outcome: "live", detail: `Kuiper session ${session.id}` });
    },
  });
  let close = () => adapter.close();
  ctx.onCleanup(async () => {
    await close();
    // A browser Muse closed (or one that ended) is gone; the next errand opens one from the profile.
    const current = await Effect.runPromise(ctx.data.getAgent(ctx.agentId));
    const sessionId = current && browserOf(current.context).sessionId;
    if (sessionId && !adapter.resourceIds().includes(sessionId)) await remember(ctx, { sessionId: undefined, watchUrl: undefined });
  });
  const mounted = mountBrowser(agent, { adapter });
  close = () => mounted.close();
}
