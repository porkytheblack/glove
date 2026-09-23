import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { BrowserUseClient } from "glove-execution/station";
import type { FoundryStationConnection } from "glove-foundry/station";
import { port, root } from "../lib/settings.js";
import { readState } from "../lib/state.js";
// Opt-in publication step, separate from normal use. Refuse non-demo histories/pages.
assert.equal(process.env.OPERATOR_DOCS_CAPTURE, "1", "Explicitly opt into documentation capture");
const base = `http://127.0.0.1:${port}`;
const state = await (await fetch(`${base}/api/state`)).json();
assert.equal(state.working, false);
assert.ok(state.messages.length > 0);
for (const message of state.messages.filter((item: { role: string }) => item.role === "user")) {
  assert.ok(message.text.includes("These are demo tasks, not private data.") || message.text.includes("PUBLIC VERIFICATION"), "Refusing to publish a non-demo conversation");
}
const connection = await readState<FoundryStationConnection | null>("worker-client.json", null);
assert.ok(connection);
const client = new BrowserUseClient({ baseUrl: connection.url, stationId: connection.stationId, apiKey: connection.token, access: "operator" });
for (const session of state.browsers) {
  const pages = await client.request<Array<{ url: string }>>({ method: "execute", id: session.id, command: { op: "pages" } });
  for (const page of pages) assert.ok(page.url === "about:blank" || new URL(page.url).hostname === "example.com", "Refusing to publish a private browser page");
}
const out = resolve(root, "../../packages/site/public/foundry/operator"); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.GLOVE_BROWSER_EXECUTABLE });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(base); await page.waitForFunction(() => (document.querySelector("#browser-image") as HTMLImageElement)?.naturalWidth > 0);
  await page.screenshot({ path: resolve(out, "browser.png") });
  await page.getByRole("button", { name: /Workspace/ }).click();
  await page.frameLocator("#preview").getByText("Field Notes", { exact: false }).first().waitFor();
  await page.screenshot({ path: resolve(out, "workspace.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile console must not overflow");
  assert.deepEqual(errors, []);
  console.log("Captured public demo browser/workspace images; desktop and mobile UI checks passed.");
} finally { await browser.close(); }
