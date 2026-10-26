import { Kuiper } from "@kuiper-sh/sdk";

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
