import { Kuiper } from "@kuiper-sh/sdk";
import type { Browser, Page } from "playwright-core";

/**
 * Muse's Kuiper client: models and browsers behind one gateway key. On a
 * Kuiper unit, KUIPER_GATEWAY_KEY and BROWSERS_URL come from the unit's
 * `${{models.API_KEY}}` and `${{browsers.BASE_URL}}`; the two references open
 * both services for the unit's key. Anywhere else, a key from
 * `kuiper keys create`, and Kuiper's own gateway. Without a key there is no
 * Kuiper, and Muse has no browser.
 */
let client: Kuiper | undefined;

export function kuiper(): Kuiper | undefined {
  if (!process.env.KUIPER_GATEWAY_KEY) return undefined;
  return client ??= new Kuiper({ gatewayUrl: process.env.BROWSERS_URL || undefined });
}

/** How Muse names itself to sites. Put your agent's name and a page about it here. */
export const AGENT_TOKEN = "MuseRebuild/1.0 (+https://glove.dterminal.net/foundry/docs/rebuilds/meta-muse)";

/**
 * Says it is an agent: every tab sends the browser's own user agent with
 * AGENT_TOKEN added, while this connection lasts. It never claims to be a
 * different browser. Returns the step that names one tab, for a tab the host
 * opens itself and must name before it loads anything.
 */
export async function identify(browser: Browser): Promise<(page: Page) => Promise<void>> {
  const { userAgent } = await (await browser.newBrowserCDPSession()).send("Browser.getVersion");
  const name = async (page: Page) => {
    const tab = await page.context().newCDPSession(page);
    await tab.send("Network.setUserAgentOverride", { userAgent: `${userAgent} ${AGENT_TOKEN}` });
  };
  for (const context of browser.contexts()) {
    await Promise.all(context.pages().map(name));
    context.on("page", (page) => void name(page).catch(() => undefined));
  }
  return name;
}
