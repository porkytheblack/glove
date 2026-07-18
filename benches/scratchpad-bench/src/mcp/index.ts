/**
 * Assemble the whole mock org: one seeded {@link World}, ten live in-process MCP
 * servers over it, and (for the scratchpad arm) the scratchpad resource tables
 * that call those same servers.
 */
import { buildWorld, type World } from "./seed";
import { buildConnection, type CallMeter } from "./inprocess";
import { serverResources, type ServerSpec } from "./spec";
import type { McpServerConnection } from "glove-mcp";
import type { ResourceTable } from "glove-scratchpad";

import { githubServer } from "./servers/github";
import { linearServer } from "./servers/linear";
import { emailServer } from "./servers/email";
import { slackServer } from "./servers/slack";
import { notionServer } from "./servers/notion";
import { jiraServer } from "./servers/jira";
import { sentryServer } from "./servers/sentry";
import { pagerdutyServer } from "./servers/pagerduty";
import { calendarServer } from "./servers/calendar";
import { filesystemServer } from "./servers/filesystem";

export type { World } from "./seed";
export { buildWorld } from "./seed";

/** The ten services a real product team wires up. Order is stable. */
export const SERVER_FACTORIES: Array<(w: World) => ServerSpec> = [
  githubServer,
  linearServer,
  emailServer,
  slackServer,
  notionServer,
  jiraServer,
  sentryServer,
  pagerdutyServer,
  calendarServer,
  filesystemServer,
];

export interface MockOrg {
  world: World;
  specs: ServerSpec[];
  connections: McpServerConnection[];
  /** Ground-truth `tools/call` counter, keyed by namespace. */
  meter: CallMeter;
  /** All scratchpad resource tables across all servers. */
  resources(): ResourceTable[];
  close(): Promise<void>;
}

export async function buildMockOrg(
  opts: { seed?: number; scale?: number; meter?: CallMeter; distractors?: number } = {},
): Promise<MockOrg> {
  const world = buildWorld(opts.seed ?? 1337, opts.scale);
  const specs = SERVER_FACTORIES.map((f) => f(world));
  if (opts.distractors && opts.distractors > 0) {
    const { distractorServers } = await import("./distractors");
    specs.push(...distractorServers(world, (opts.seed ?? 1337) + 1, opts.distractors));
  }
  const meter: CallMeter = opts.meter ?? new Map();
  const connections = await Promise.all(specs.map((s) => buildConnection(s, meter)));

  return {
    world,
    specs,
    connections,
    meter,
    resources: () => specs.flatMap((s, i) => serverResources(s, connections[i])),
    close: async () => {
      await Promise.all(connections.map((c) => c.close()));
    },
  };
}

/** Total number of MCP tools across all servers (the baseline arm's tool count). */
export function totalToolCount(specs: ServerSpec[]): number {
  return specs.reduce((sum, s) => sum + s.tools.length, 0);
}
