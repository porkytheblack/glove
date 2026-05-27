import { connectMcp, type McpTransportKind } from "glove-mcp";
import { startRobotServer } from "./stub-server";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function runScenario(
  url: string,
  transport: McpTransportKind | undefined,
): Promise<void> {
  const label = transport ?? "auto (default)";
  console.log(`\n[smoke] --- scenario: ${label} ---`);

  const conn = await connectMcp({
    namespace: "robot",
    url,
    transport,
  });

  try {
    const tools = await conn.listTools();
    const names = tools.map((t) => t.name).sort();
    console.log(`[smoke] tools: ${names.join(", ")}`);
    assert(tools.length === 2, `expected 2 tools, got ${tools.length}`);
    assert(names.includes("get_status"), "missing get_status");
    assert(names.includes("move"), "missing move");

    const status = await conn.callTool("get_status", {});
    const statusText = status.content.map((c) => c.text ?? "").join("");
    console.log(`[smoke] get_status -> ${statusText}`);
    assert(statusText.includes("Battery"), "get_status output missing 'Battery'");

    const move = await conn.callTool("move", { x: 1, y: 2, z: 3 });
    const moveText = move.content.map((c) => c.text ?? "").join("");
    console.log(`[smoke] move(1,2,3) -> ${moveText}`);
    assert(moveText.includes("Moved to"), "move output missing 'Moved to'");
  } finally {
    await conn.close();
  }
}

async function main(): Promise<void> {
  const handle = await startRobotServer(0);
  console.log(`[smoke] stub server up at ${handle.url}`);

  try {
    // Explicit SSE transport — the robot path.
    await runScenario(handle.url, "sse");
    // Auto-fallback — server speaks SSE only, so Streamable HTTP fails
    // first and the client retries via the legacy transport.
    await runScenario(handle.url, undefined);
    console.log("\n[smoke] OK");
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error("\n[smoke] FAILED:", err);
  process.exit(1);
});
