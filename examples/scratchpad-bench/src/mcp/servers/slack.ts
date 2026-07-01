import { z } from "zod";
import type { ServerSpec } from "../spec";
import type { World } from "../seed";

const lc = (v: unknown) => String(v ?? "").toLowerCase();

export function slackServer(world: World): ServerSpec {
  return {
    namespace: "slack",
    title: "Slack",
    tools: [
      {
        name: "list_channels",
        description: "List Slack channels.",
        readOnly: true,
        input: {},
        handler: () => world.slackChannels,
      },
      {
        name: "list_messages",
        description: "List messages in a channel (by name).",
        readOnly: true,
        input: { channel: z.string() },
        handler: (a) => world.slackMessages.filter((m) => lc(m.channel) === lc(a.channel)),
      },
      {
        name: "search_messages",
        description: "Search all messages for a substring.",
        readOnly: true,
        input: { query: z.string() },
        handler: (a) => world.slackMessages.filter((m) => lc(m.text).includes(lc(a.query))),
      },
      {
        name: "post_message",
        description: "Post a message to a channel.",
        readOnly: false,
        input: { channel: z.string(), text: z.string() },
        handler: (a) => {
          world.outbox.push({ kind: "slack.post_message", at: new Date(0).toISOString(), payload: a });
          return { channel: a.channel, ts: "posted", ok: true };
        },
      },
    ],
    entities: [
      {
        table: "slack_channels",
        description: "Slack channels.",
        volatility: "stable",
        columns: [
          { name: "id", type: "text" },
          { name: "name", type: "text" },
          { name: "topic", type: "text" },
          { name: "members", type: "bigint" },
        ],
        select: { tool: "list_channels" },
      },
      {
        table: "slack_messages",
        description: "Messages. SELECT requires WHERE channel = '…'. INSERT posts a message.",
        volatility: "stable",
        columns: [
          { name: "id", type: "text" },
          { name: "channel", type: "text", requiredKey: true },
          { name: "user", type: "text" },
          { name: "text", type: "text" },
          { name: "ts", type: "timestamptz" },
          { name: "reactions", type: "bigint" },
        ],
        select: { tool: "list_messages", args: (b) => ({ channel: b.one("channel") }) },
        insert: { tool: "post_message", args: (r) => ({ channel: r.channel, text: r.text }) },
      },
    ],
  };
}
