import { Effect } from "effect";
import type { GloveFoldArgs } from "glove-core";
import type { AgentAssemblyContext } from "glove-foundry";
import { z } from "zod";
import { saveSkill } from "./skills.js";

/**
 * What any bot can do to itself and its owner's account. Each one writes
 * data; none of it needs new code. A rename is a write to the instance.
 */
export function botTools(ctx: AgentAssemblyContext): GloveFoldArgs<any>[] {
  return [
    {
      name: "take_job",
      description: "Take on the job your owner described: give yourself a short name and one sentence saying what you do.",
      inputSchema: z.object({
        name: z.string().min(1).max(40).describe("Like Sales Outbound or Inbox Manager."),
        description: z.string().min(1).max(300),
      }),
      async do(job: { readonly name: string; readonly description: string }) {
        const current = await Effect.runPromise(ctx.data.getAgent(ctx.agentId));
        if (!current) return { status: "error" as const, data: null, message: "This bot no longer exists." };
        await Effect.runPromise(ctx.data.putAgent({ ...current, ...job, updatedAt: new Date().toISOString() }));
        return { status: "success" as const, data: { renamed: job.name } };
      },
    },
    {
      name: "save_skill",
      description: "Save a workflow you were shown, step by step, so any of your owner's bots can run it. Your owner reviews it first.",
      inputSchema: z.object({
        name: z.string().regex(/^[a-z][a-z0-9-]*$/).describe("Short kebab-case name."),
        description: z.string().min(1),
        steps: z.string().min(1),
      }),
      // The owner reads the draft skill before any bot can use it.
      requiresPermission: true,
      async do(skill: { readonly name: string; readonly description: string; readonly steps: string }) {
        await saveSkill(ctx.data, ctx.workspaceId, { ...skill, by: ctx.agentId });
        return { status: "success" as const, data: { saved: skill.name } };
      },
    },
    {
      name: "request_sign_in",
      description: "Hand the browser to your owner so they can sign in to a site for you. You never see the password; the session stays on your computer.",
      inputSchema: z.object({
        site: z.string().min(1),
        url: z.string().url(),
        why: z.string().min(1),
      }),
      // The approval is the hand-back: the owner signs in, then approves.
      requiresPermission: true,
      async do(input: { readonly site: string; readonly url: string }) {
        // your code: a Kuiper browser with a profile per owner keeps the session.
        return { status: "success" as const, data: { signedIn: true, site: input.site } };
      },
    },
  ];
}
