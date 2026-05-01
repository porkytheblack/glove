/**
 * Demo client. Connects to a glovebox over WebSocket, uploads a PDF as input,
 * and streams the agent's tool calls + final outputs to stdout.
 *
 *   tsx ./client.ts ws://localhost:8080 ./sample.pdf
 *
 * Argv 1: WebSocket endpoint URL (defaults to $GLOVEBOX_ENDPOINT).
 * Argv 2: Path to a local PDF (required).
 * Auth from $GLOVEBOX_KEY.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { GloveboxClient } from "glovebox-client";

async function main() {
  const url = process.argv[2] ?? process.env.GLOVEBOX_ENDPOINT;
  const pdfPath = process.argv[3];
  const key = process.env.GLOVEBOX_KEY;

  if (!url) {
    console.error("Usage: tsx client.ts <ws-url> <pdf-path>");
    console.error("       (or set GLOVEBOX_ENDPOINT)");
    process.exit(2);
  }
  if (!pdfPath) {
    console.error("Missing PDF path. Usage: tsx client.ts <ws-url> <pdf-path>");
    process.exit(2);
  }
  if (!key) {
    console.error("Missing GLOVEBOX_KEY env var.");
    process.exit(2);
  }

  const bytes = await readFile(pdfPath);
  const fileName = path.basename(pdfPath);

  const client = GloveboxClient.make({
    endpoints: {
      pdf: { url, key },
    },
  });

  const box = client.box("pdf");
  const env = await box.environment();
  console.log(`Connected to ${env.name}@${env.version} (base=${env.base})`);

  const result = box.prompt(
    "Extract the text and structural metadata from this PDF. Use both tools. " +
      "Once you have results, summarize what you produced.",
    {
      files: {
        [fileName]: { mime: "application/pdf", bytes: new Uint8Array(bytes) },
      },
    },
  );

  // Stream subscriber events to stdout.
  (async () => {
    for await (const event of result.events) {
      switch (event.event_type) {
        case "text_delta": {
          const data = event.data as { text?: string };
          if (data.text) process.stdout.write(data.text);
          break;
        }
        case "tool_use": {
          const data = event.data as { name?: string; input?: unknown };
          process.stdout.write(`\n[tool_use] ${data.name} ${JSON.stringify(data.input)}\n`);
          break;
        }
        case "tool_use_result": {
          const data = event.data as {
            tool_name?: string;
            result?: { status?: string };
          };
          process.stdout.write(
            `[tool_use_result] ${data.tool_name} → ${data.result?.status ?? "?"}\n`,
          );
          break;
        }
        case "model_response_complete":
          process.stdout.write("\n[turn_complete]\n");
          break;
        default:
          break;
      }
    }
  })().catch((err) => {
    console.error("[client] event stream error:", err);
  });

  try {
    const finalMessage = await result.message;
    const outputs = await result.outputs;

    console.log("\n─── final message ─────────────────────────────");
    console.log(finalMessage);

    console.log("\n─── outputs ───────────────────────────────────");
    const outDir = path.resolve("./outputs");
    await mkdir(outDir, { recursive: true });
    for (const [name, ref] of Object.entries(outputs)) {
      const data = await result.read(name);
      const target = path.join(outDir, name);
      await writeFile(target, data);
      console.log(`  ${name}  (${ref.kind}, ${data.byteLength} bytes) → ${target}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[client] failed:", err);
  process.exit(1);
});
