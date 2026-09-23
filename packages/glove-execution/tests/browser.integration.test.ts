import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { Glove, MemoryStore, Displaymanager, type ModelAdapter } from "glove-core";
import { BrowserSessionManager, type BrowserAction, type BrowserCommand, type BrowserOpenOptions } from "station-browser-use";
import { PlaywrightBrowserAdapter } from "station-browser-use/playwright";
import { mountBrowser } from "../src/index";
import { stationBrowser } from "../src/station";

test("a real Station browser completes a form in one script and supplies a native screenshot", { skip: process.env.GLOVE_BROWSER_INTEGRATION !== "1" }, async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end('<!doctype html><title>Glove test</title><label>Name<input id="name"></label><button onclick="document.getElementById(\'result\').textContent=\'Hello \'+document.getElementById(\'name\').value">Submit</button><p id="result"></p>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const manager = new BrowserSessionManager(new PlaywrightBrowserAdapter({ executablePath: process.env.GLOVE_BROWSER_EXECUTABLE }), 1);
  let sawImage = false;
  const model: ModelAdapter = { name: "test", setSystemPrompt() {}, async prompt(request) {
    sawImage = request.messages.some(message => message.content?.some(part => part.type === "image"));
    return { messages: [{ sender: "agent", text: "verified" }], tokens_in: 0, tokens_out: 0 };
  } };
  const glove = new Glove({ model, store: new MemoryStore("browser-test"), displayManager: new Displaymanager(), systemPrompt: "test", compaction_config: { compaction_instructions: "preserve" } }).build();
  const mounted = mountBrowser(glove, { adapter: stationBrowser({ allowEvaluate: true, maxSessions: 1, client: {
    async request<T>(body: Record<string, unknown>) {
      switch (body.method) {
        case "open": return await manager.open(body.options as BrowserOpenOptions) as T;
        case "action": return await manager.perform(body.id as string, body.action as BrowserAction, body.value as string | undefined) as T;
        case "execute": return await manager.execute(body.id as string, body.command as BrowserCommand) as T;
        case "close": await manager.requestCloseSession(body.id as string); return null as T;
        default: throw new Error("Unexpected test operation");
      }
    },
  } }) });
  try {
    const result = await mounted.session.execute(`
      const page = browser.open({});
      browser.navigate({ sessionId: page.id, url: "http://127.0.0.1:${address.port}" });
      const initial = browser.observe({ sessionId: page.id });
      browser.interact({ sessionId: page.id, command: { op: "fill", target: { by: "label", value: "Name" }, value: "Ada" } });
      browser.interact({ sessionId: page.id, command: { op: "click", target: { by: "role", role: "button", name: "Submit" } } });
      const text = browser.evaluate({ sessionId: page.id, expression: "document.getElementById('result').textContent" });
      browser.screenshot({ sessionId: page.id });
      browser.close({ sessionId: page.id });
      text;
    `);
    assert.equal(result.value, "Hello Ada");
    assert.deepEqual(mounted.resourceIds(), []);
    await glove.processRequest("Verify the screenshot");
    assert.equal(sawImage, true);
  } finally {
    await mounted.close();
    await manager.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
