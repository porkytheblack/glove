import { appendFile, mkdir, readFile } from "node:fs/promises";
import { z } from "zod";
import type { Action } from "./auto-review.js";
import { dataDir, dataPath } from "./paths.js";

// your code: your helpdesk, GitHub and email. Here every action that really
// runs is appended to .data/actions.jsonl, so you can see what got through
// the review and what didn't.

export interface Performed {
  readonly agentId: string;
  readonly action: string;
  readonly input: unknown;
  readonly at: string;
}

const LOG = dataPath("actions.jsonl");

export async function performedActions(): Promise<Performed[]> {
  try {
    return (await readFile(LOG, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Performed);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}

async function perform(agentId: string, action: string, input: unknown): Promise<number> {
  await mkdir(dataDir, { recursive: true });
  await appendFile(LOG, `${JSON.stringify({ agentId, action, input, at: new Date().toISOString() } satisfies Performed)}\n`);
  return (await performedActions()).length;
}

const ok = (data: Record<string, unknown>) => ({ status: "success" as const, data });

/** Everything a dot can do to the outside world. Each one goes through auto-review. */
export function actionsFor(agentId: string): Action[] {
  return [
    {
      name: "reply_to_customer",
      description: "Reply by email to a customer who wrote in.",
      inputSchema: z.object({ to: z.string().email(), text: z.string().min(1) }),
      recipient: (input: { to: string }) => input.to,
      handOff: (input: { to: string }) => `Reply to ${input.to} yourself.`,
      async do(input: { to: string; text: string }) {
        await perform(agentId, "reply_to_customer", input);
        return ok({ sent: true, to: input.to });
      },
    },
    {
      name: "send_email",
      description: "Send a new email.",
      inputSchema: z.object({ to: z.string().email(), subject: z.string().min(1), body: z.string().min(1) }),
      recipient: (input: { to: string }) => input.to,
      handOff: (input: { to: string; subject: string }) => `Send "${input.subject}" to ${input.to} yourself.`,
      async do(input: { to: string; subject: string; body: string }) {
        await perform(agentId, "send_email", input);
        return ok({ sent: true, to: input.to });
      },
    },
    {
      name: "open_draft_pr",
      description: "Open a draft pull request for a fix. Nothing merges.",
      inputSchema: z.object({ title: z.string().min(1), branch: z.string().min(1) }),
      handOff: (input: { title: string }) => `Open a draft PR for "${input.title}" yourself.`,
      async do(input: { title: string; branch: string }) {
        const pr = 100 + (await perform(agentId, "open_draft_pr", input));
        return ok({ pr, draft: true, title: input.title });
      },
    },
    {
      name: "merge_pr",
      description: "Merge a pull request.",
      inputSchema: z.object({ pr: z.number().int().positive() }),
      handOff: (input: { pr: number }) => `Review PR #${input.pr} and merge it yourself.`,
      async do(input: { pr: number }) {
        await perform(agentId, "merge_pr", input);
        return ok({ merged: true, pr: input.pr });
      },
    },
    {
      name: "change_password",
      description: "Change the password of an account.",
      inputSchema: z.object({ account: z.string().min(1) }),
      handOff: (input: { account: string }) => `Change the password for ${input.account} yourself, in its own settings.`,
      async do(input: { account: string }) {
        await perform(agentId, "change_password", input);
        return ok({ changed: true, account: input.account });
      },
    },
  ];
}

export const ACTION_NAMES = ["reply_to_customer", "send_email", "open_draft_pr", "merge_pr", "change_password"] as const;
