import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

test("optional mounts bundle and execute without Node or Station in a browser host", async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", globalName: "execution",
    write: false, metafile: true,
  });
  assert.ok(!Object.keys(bundle.metafile!.inputs).some(path => /station-|src\/station\./.test(path)));
  const result = await runInNewContext(`${bundle.outputFiles[0].text}
    (async () => {
      if (typeof process !== "undefined" || typeof Buffer !== "undefined" || typeof require !== "undefined") throw Error("Node globals leaked");
      const tools = [];
      const providers = new Set();
      const subscribers = new Set();
      let prompt = "Host instructions";
      let closed = 0;
      let image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
      const agent = {
        fold(tool) { tools.push(tool); },
        setModel() { throw Error("Mount must not own the model"); },
        addContextProvider(value) { providers.add(value); return () => providers.delete(value); },
        addSubscriber(value) { subscribers.add(value); },
        removeSubscriber(value) { subscribers.delete(value); },
        getSystemPrompt() { return prompt; },
        setSystemPrompt(value) { prompt = value; },
      };
      const adapter = {
        name: "web-backend", resourceIds: () => [], uncertainCreations: () => 0,
        async close() { closed++; },
        operations: [{ name: "screenshot", description: "Image", inputSchema: { type: "object" },
          async execute() { return { status: "success", data: "captured", images: [{ mimeType: "image/png", base64: image }] }; },
        }],
      };
      const browser = execution.mountBrowser(agent, { adapter });
      await browser.session.execute('browser.screenshot({})');
      const observed = [...providers][0]()[1].source.data === image;
      let rejected = 0;
      for (const invalid of ["%%%", image + " ", "YWJj", "iVBORw0KGgp="]) {
        image = invalid;
        try { await browser.session.execute('browser.screenshot({})'); }
        catch { rejected++; }
      }
      const sandbox = execution.mountSandbox(agent, { adapter: {
        ...adapter, operations: [{ name: "inspect", description: "Inspect", inputSchema: { type: "object" },
          async execute() { return { status: "success", data: 42 }; },
        }],
      } });
      const value = (await sandbox.session.execute('sandbox.inspect({})')).value;
      const textScope = execution.createSandboxAdapter({ sandboxIds: ["owned"], backend: {
        name: "web-files", methods: ["writeFile"],
        async invoke(method, input) { return { encoded: input.options.base64 }; },
      } });
      const written = await textScope.operations.find(op => op.name === "writeText").execute({ id: "owned", path: "hello.txt", text: "世界" });
      if (written.data.encoded !== "5LiW55WM") throw Error("UTF-8 encoding failed in web host");
      await textScope.close();
      await browser.close();
      if (providers.size || subscribers.size) throw Error("Mount hooks leaked");
      await sandbox.close();
      return { observed, rejected, value, closed, tools: tools.map(tool => tool.name) };
    })()
  `, { atob, btoa, TextEncoder, AbortController, setTimeout, clearTimeout });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    observed: true, rejected: 4, value: 42, closed: 2, tools: ["execute_browser", "execute_sandbox"],
  });
});
