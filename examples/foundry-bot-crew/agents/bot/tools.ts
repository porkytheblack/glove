import { Effect } from "effect";
import { createMemorySkillReader, createReadSkillTool, type GloveFoldArgs } from "glove-core";
import type { AgentAssemblyContext } from "glove-foundry";
import { z } from "zod";
import { accountsOf } from "../../lib/accounts.js";
import { APP_NAMES, type AppName } from "../../lib/connect.js";
import type { EventRoutine } from "../../lib/people.js";
import { loadSkills, saveSkill } from "./skills.js";

/**
 * What any bot can do to itself and its owner's account. Each one writes
 * data; none of it needs new code. A rename or a routine is a write to the
 * bot's own instance, and connecting an app writes the account and gives it
 * to every bot the owner has.
 */
export async function botTools(ctx: AgentAssemblyContext): Promise<GloveFoldArgs<any>[]> {
  const tools: GloveFoldArgs<any>[] = [
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
      name: "connect_app",
      description: `Ask your owner to connect an app you need (${APP_NAMES.join(", ")}). They sign in with the provider, and the account is then theirs on every one of their bots, from the next message on.`,
      inputSchema: z.object({ app: z.enum(APP_NAMES as [AppName, ...AppName[]]), why: z.string().min(1) }),
      // Your app shows this approval as a Connect button that runs the
      // provider's sign-in (lib/oauth.ts) and saves the account (lib/connect.ts),
      // then approves. The tool reports what got connected.
      requiresPermission: true,
      async do({ app }: { readonly app: AppName }) {
        const account = (await accountsOf(ctx.workspaceId)).find((item) => item.app === app);
        return account
          ? { status: "success" as const, data: { connected: app, account: account.label ?? account.externalAccountId } }
          : { status: "success" as const, data: { connected: false, app, note: "Your owner hasn't finished signing in." } };
      },
    },
    {
      name: "save_skill",
      description: "Save a workflow you were shown, step by step, so any of your owner's bots can run it. Your owner reviews it first.",
      inputSchema: z.object({
        name: z.string().regex(/^[a-z][a-z0-9-]*$/).describe("Short kebab-case name."),
        description: z.string().min(1),
        steps: z.string().min(1).describe("When to use it, inputs and access, the steps, how to check the result, what to return, and what needs approval."),
      }),
      // The owner reads the draft skill before any bot can use it.
      requiresPermission: true,
      async do(skill: { readonly name: string; readonly description: string; readonly steps: string }) {
        await saveSkill(ctx.data, ctx.workspaceId, { ...skill, by: ctx.agentId });
        return { status: "success" as const, data: { saved: skill.name } };
      },
    },
    {
      name: "add_routine",
      description: "Run a workflow every time an event happens, on you. For a routine on a schedule, use glove_foundry_schedule instead.",
      inputSchema: z.object({
        on: z.enum(["new-mail"]).describe("new-mail: each new email in your owner's Gmail."),
        skill: z.string().optional().describe("A saved skill to run, by name."),
        instruction: z.string().min(1).describe("What to do each time, in a sentence or two."),
      }),
      // A routine belongs to one bot. It is a write to this bot's own data; the
      // playbook built from it takes effect from the next run.
      async do(routine: EventRoutine) {
        const current = await Effect.runPromise(ctx.data.getAgent(ctx.agentId));
        if (!current) return { status: "error" as const, data: null, message: "This bot no longer exists." };
        const routines = ((current.context.routines ?? []) as ReadonlyArray<EventRoutine>).filter((item) => item.on !== routine.on);
        await Effect.runPromise(ctx.data.putAgent({
          ...current,
          context: { ...current.context, routines: [...routines, routine] },
          updatedAt: new Date().toISOString(),
        }));
        return { status: "success" as const, data: { routine: routine.on, skill: routine.skill ?? null } };
      },
    },
    {
      name: "request_sign_in",
      description: "Ask your owner for a step only they can do: single sign-on, a passkey, a CAPTCHA, a code from another device. Never ask for a password. The result says whether there is a browser to sign in with.",
      inputSchema: z.object({
        site: z.string().min(1),
        url: z.string().url(),
        why: z.string().min(1),
      }),
      requiresPermission: true,
      async do(input: { readonly site: string; readonly url: string }) {
        // A stand-in: this example has no browser, so nothing is signed in. Mount
        // a Kuiper browser per owner (kuiperBrowser from glove-execution/kuiper,
        // with persistProfile) and hand it over with browser.handOff, as the
        // personal-agent example does; the profile then keeps the sign-in for
        // every bot.
        return { status: "success" as const, data: { approved: true, signedIn: false, site: input.site, note: "There is no browser in this setup, so nothing was signed in. Say so." } };
      },
    },
  ];

  // The owner's skill library, shared by all their bots.
  const skills = await loadSkills(ctx.data, ctx.workspaceId);
  if (skills.length > 0) {
    const read = createReadSkillTool(createMemorySkillReader(skills), {
      initialSummaries: skills.map(({ name, description }) => ({ name, description })),
    });
    tools.push({
      name: read.name,
      description: read.description,
      inputSchema: z.object({ name: z.string(), section: z.string().optional() }),
      do: (input: { readonly name: string; readonly section?: string }) => read.run(input),
    });
  }
  return tools;
}
