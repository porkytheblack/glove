import { appendFile, mkdir, readFile } from "node:fs/promises";
import { z } from "zod";
import type { Action } from "./auto-review.js";
import { dataDir, dataPath } from "./paths.js";

// your code: your helpdesk and GitHub. Here every action that really runs is
// appended to .data/actions.jsonl, so you can see what got through the review
// and what didn't. Email goes out through the Gmail app; agent.ts puts the
// same review around it under the rule send_email.

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

/** What a dot can do outside its apps. Each one goes through auto-review. */
export function actionsFor(agentId: string): Action[] {
  return [
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

/** Every rule name: these actions, and send_email for the Gmail app's send. */
export const ACTION_NAMES = ["send_email", "open_draft_pr", "merge_pr", "change_password"] as const;
