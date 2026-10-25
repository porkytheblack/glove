import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core";
import { z } from "zod";
import gmailApp from "../agents/dot/apps/gmail.app.js";
import { dataPath, fixturePath } from "./paths.js";

// The mailbox is read through the Gmail app (gmail.search_threads in code).
// Slack history is your code: conversations.history with a read-only token.
// Here it is the JSON file in fixtures/.

interface ChannelLog { readonly channel: string; readonly messages: ReadonlyArray<{ ts: string; user: string; text: string }> }

const readJson = async <T>(name: string): Promise<T> => JSON.parse(await readFile(fixturePath(name), "utf8")) as T;

/**
 * People who wrote in: the addresses in the inbox the dot watches, read
 * through its Gmail app. The dot may write back to them; anyone else needs
 * approval, whatever the rule says.
 */
export async function knownContacts(agent: IGloveRunnable): Promise<string[]> {
  const search = agent.tools.find((tool) => tool.name === `${gmailApp.id}__search_threads`);
  if (!search) return [];
  const result = await search.run({ query: "in:inbox", maxResults: 50 });
  if (result.status !== "success") return [];
  const text = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
  return [...new Set([...text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((match) => match[0].toLowerCase()))];
}

/** The dot's private notes, one file per instance. */
export function notesFile(agentId: string): string {
  return join(dataPath("notes"), `${createHash("sha256").update(agentId).digest("hex").slice(0, 32)}.md`);
}

/**
 * The research tools. With the Gmail app's reads in code, they read and they
 * write the dot's own notes; none of them can send a message or change
 * anything outside the dot.
 */
export function researchTools(agentId: string): GloveFoldArgs<any>[] {
  let suggested = false;
  return [
    {
      name: "read_channel",
      description: "Read recent messages in a Slack channel you watch. Read-only.",
      inputSchema: z.object({ channel: z.string().describe("For example #feedback.") }),
      async do({ channel }: { channel: string }) {
        const log = await readJson<ChannelLog>("feedback-channel.json");
        if (channel.replace(/^#/, "") !== log.channel) {
          return { status: "error" as const, data: null, message: `You don't have access to ${channel}.` };
        }
        return { status: "success" as const, data: log };
      },
    },
    {
      name: "read_notes",
      description: "Read your private notes from earlier runs.",
      inputSchema: z.object({}),
      async do() {
        try {
          return { status: "success" as const, data: await readFile(notesFile(agentId), "utf8") };
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
          return { status: "success" as const, data: "No notes yet." };
        }
      },
    },
    {
      name: "keep_note",
      description: "Add to your private notes: grouped reports, counts, what changed since last time. Only you read them.",
      inputSchema: z.object({ note: z.string().min(1) }),
      async do({ note }: { note: string }) {
        await mkdir(dataPath("notes"), { recursive: true });
        await appendFile(notesFile(agentId), `- ${new Date().toISOString()} ${note.replace(/\n/g, " ")}\n`);
        return { status: "success" as const, data: { kept: true } };
      },
    },
    {
      name: "suggest",
      description: "Bring one suggestion or question to the person. At most one per run; end your reply with it.",
      inputSchema: z.object({ text: z.string().min(1) }),
      async do({ text }: { text: string }) {
        if (suggested) return { status: "error" as const, data: null, message: "You already made a suggestion this run." };
        suggested = true;
        return { status: "success" as const, data: { suggestion: text, next: "Say it as your reply." } };
      },
    },
  ];
}
