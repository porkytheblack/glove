import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import type { IGloveRunnable, SubscriberAdapter, SubscriberEventDataMap } from "glove-core";
import type { AgentHandlerContext } from "glove-foundry";
import { storedInstance } from "./dot.js";
import { dataDir, dataPath } from "./paths.js";

/** Hand-offs and denials in a row before the monitor pauses a dot. */
export const PAUSE_AFTER = 3;

const STREAKS = dataPath("monitor.json");

async function streaks(): Promise<Record<string, number>> {
  try {
    return JSON.parse(await readFile(STREAKS, "utf8")) as Record<string, number>;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw cause;
  }
}

/**
 * Safety monitoring. It watches how each reviewed action ends: it ran, or
 * auto-review handed it off, or the person denied it. After PAUSE_AFTER
 * hand-offs and denials in a row it pauses the dot, so its runs only read
 * until its person resumes it (`paused: false` with configureAgent). Pausing
 * doesn't undo actions already taken.
 */
export async function monitored<T>(
  agent: IGloveRunnable,
  ctx: Pick<AgentHandlerContext, "agentId" | "agentInstance" | "data">,
  reviewedTools: ReadonlySet<string>,
  run: () => Promise<T>,
): Promise<T> {
  const ended: Array<"ran" | "stopped"> = [];
  const watcher: SubscriberAdapter = {
    record: async (type, data) => {
      if (type !== "tool_use_result") return;
      const { tool_name, result } = data as SubscriberEventDataMap["tool_use_result"];
      if (!reviewedTools.has(tool_name)) return;
      if (result.status === "success") ended.push("ran");
      else if (/^(Auto-review:|Permission denied)/.test(result.message ?? "")) ended.push("stopped");
    },
  };
  agent.addSubscriber(watcher);
  try {
    return await run();
  } finally {
    agent.removeSubscriber(watcher);
    if (ended.length > 0) await settle(ctx, ended);
  }
}

async function settle(ctx: Pick<AgentHandlerContext, "agentId" | "agentInstance" | "data">, ended: ReadonlyArray<"ran" | "stopped">) {
  const all = await streaks();
  let streak = all[ctx.agentId] ?? 0;
  for (const outcome of ended) streak = outcome === "ran" ? 0 : streak + 1;
  if (streak >= PAUSE_AFTER) {
    const instance = await storedInstance(ctx);
    await Effect.runPromise(ctx.data.putAgent({
      ...instance,
      context: { ...instance.context, paused: true },
      updatedAt: new Date().toISOString(),
    }));
    streak = 0;
  }
  await mkdir(dataDir, { recursive: true });
  await writeFile(STREAKS, JSON.stringify({ ...all, [ctx.agentId]: streak }));
}
