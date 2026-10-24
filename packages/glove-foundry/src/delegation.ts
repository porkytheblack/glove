import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GloveFoldArgs } from "glove-core";
import { z } from "zod";

/** @internal Directory the runtime uses to hand deliveries to runs that are listening. */
export const FOUNDRY_MAILBOX_DIRECTORY_ENV = "GLOVE_FOUNDRY_MAILBOX_DIRECTORY";
/** @internal A run reports when it starts and stops listening on its conversation. */
export const FOUNDRY_CONVERSATION_LISTEN_EVENT = "foundry.conversation.listen";

const DELEGATION_ID = /^delegation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;

/**
 * A sibling agent this one may hand work to, named by its route
 * (`"coder"` for `agents/coder/agent.ts`). Delegates are named rather than
 * imported so the delegating agent's process never loads the worker's
 * dependencies: a fast voice agent should not start up carrying a sandbox SDK.
 */
export type FoundryDelegate = string | FoundryDelegateOptions;

export interface FoundryDelegateOptions {
  /** Route of the worker definition. */
  readonly agent: string;
  /** What the worker is for. The delegating model reads this to choose. */
  readonly description?: string;
}

export type FoundryDelegationStatus =
  | "working"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * One handed-off task. Its id is also the worker conversation's id, and the
 * record lives on that conversation's `context.delegation`.
 */
export interface FoundryDelegation {
  readonly id: string;
  /** Route of the worker definition. */
  readonly to: string;
  /** The worker instance: one per delegating instance and route. */
  readonly workerAgentId: string;
  readonly workspaceId: string;
  readonly from: {
    readonly definitionId: string;
    readonly agentId: string;
    readonly conversationId: string;
    readonly runId: string;
  };
  readonly task: string;
  readonly status: FoundryDelegationStatus;
  /** The open question while status is "waiting". */
  readonly question?: string;
  readonly result?: string;
  readonly error?: string;
  /**
   * Bookkeeping: an update for the delegating conversation, or replies for the
   * worker, not handed over yet. Foundry hands them over again after a restart.
   */
  readonly undelivered?: "result" | "question" | "failed";
  readonly pendingReplies?: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What reaches the delegating conversation. */
export type FoundryDelegationUpdate =
  | {
      readonly kind: "result";
      readonly delegationId: string;
      readonly agent: string;
      readonly task: string;
      readonly result: string;
    }
  | {
      readonly kind: "question";
      readonly delegationId: string;
      readonly agent: string;
      readonly task: string;
      readonly question: string;
    }
  | {
      readonly kind: "failed";
      readonly delegationId: string;
      readonly agent: string;
      readonly task: string;
      readonly error: string;
    };

/** What reaches a worker: an answer to its question, or more instructions. */
export interface FoundryDelegationReply {
  readonly kind: "reply";
  readonly delegationId: string;
  /** Route of the delegating definition. */
  readonly from: string;
  readonly message: string;
}

export type FoundryConversationDelivery = FoundryDelegationUpdate | FoundryDelegationReply;

export function isDelegationId(value: string): boolean {
  return DELEGATION_ID.test(value);
}

export function newDelegationId(): string {
  return `delegation_${randomUUID()}`;
}

/** One worker instance per delegating instance and worker route. */
export function workerAgentId(delegatorAgentId: string, route: string): string {
  return `${delegatorAgentId}.${route.replaceAll("/", ".")}`;
}

export function normalizeDelegates(
  delegates: ReadonlyArray<FoundryDelegate>,
): ReadonlyArray<Required<FoundryDelegateOptions>> {
  const seen = new Map<string, Required<FoundryDelegateOptions>>();
  for (const delegate of delegates) {
    const options = typeof delegate === "string" ? { agent: delegate } : delegate;
    if (!ROUTE.test(options.agent) || options.agent.includes("__")) {
      throw new Error(
        `Invalid delegate "${options.agent}". Name a sibling agent by its route, such as "coder" for agents/coder/agent.ts.`,
      );
    }
    if (seen.has(options.agent)) {
      throw new Error(`Delegate "${options.agent}" is listed twice.`);
    }
    seen.set(options.agent, {
      agent: options.agent,
      description: options.description ?? `The ${options.agent} agent.`,
    });
  }
  return [...seen.values()];
}

/** Read a delegation record from a conversation's context, if it has one. */
export function delegationFromContext(
  context: Readonly<Record<string, unknown>> | undefined,
): FoundryDelegation | undefined {
  const value = context?.delegation;
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<FoundryDelegation>;
  return typeof item.id === "string"
    && typeof item.to === "string"
    && typeof item.workerAgentId === "string"
    && typeof item.task === "string"
    && typeof item.status === "string"
    && item.from && typeof item.from === "object"
    ? item as FoundryDelegation
    : undefined;
}

/** The update a delegation record still owes its delegating conversation, if any. */
export function undeliveredUpdate(delegation: FoundryDelegation): FoundryDelegationUpdate | undefined {
  const base = { delegationId: delegation.id, agent: delegation.to, task: delegation.task };
  if (delegation.undelivered === "result") return { kind: "result", ...base, result: delegation.result ?? "" };
  if (delegation.undelivered === "question") return { kind: "question", ...base, question: delegation.question ?? "" };
  if (delegation.undelivered === "failed") return { kind: "failed", ...base, error: delegation.error ?? "" };
  return undefined;
}

export function isOpenDelegation(delegation: FoundryDelegation): boolean {
  return delegation.status === "working" || delegation.status === "waiting";
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
}

/** The first message a worker receives. */
export function renderDelegatedTask(input: {
  readonly delegationId: string;
  readonly from: string;
  readonly task: string;
}): string {
  return [
    `<delegated-task id="${escapeAttribute(input.delegationId)}" from="${escapeAttribute(input.from)}">`,
    input.task,
    "</delegated-task>",
    `Work on this task. Your final reply is sent back to the ${input.from} agent automatically, so make it the answer itself.`,
    "If you cannot continue without something only they or the user know, call glove_foundry_ask with one clear question.",
  ].join("\n");
}

/** How a delivery reads when it arrives as a message. */
export function renderDelivery(delivery: FoundryConversationDelivery): string {
  if (delivery.kind === "reply") {
    return [
      `<delegation-reply id="${escapeAttribute(delivery.delegationId)}" from="${escapeAttribute(delivery.from)}">`,
      delivery.message,
      "</delegation-reply>",
    ].join("\n");
  }
  const status = delivery.kind === "result" ? "completed" : delivery.kind;
  const open = `<delegation id="${escapeAttribute(delivery.delegationId)}" agent="${escapeAttribute(delivery.agent)}" status="${status}">`;
  const task = `Task: ${clip(delivery.task, 240)}`;
  if (delivery.kind === "result") {
    return [open, task, "Result:", delivery.result, "</delegation>"].join("\n");
  }
  if (delivery.kind === "question") {
    return [
      open,
      task,
      `The ${delivery.agent} agent needs an answer to continue: ${delivery.question}`,
      "If you already know the answer, reply with glove_foundry_reply. Otherwise ask the user, then reply.",
      "</delegation>",
    ].join("\n");
  }
  return [open, task, `It stopped: ${delivery.error}`, "</delegation>"].join("\n");
}

export function renderDeliveries(deliveries: ReadonlyArray<FoundryConversationDelivery>): string {
  return deliveries.map(renderDelivery).join("\n\n");
}

/** Runtime context listing what this conversation has handed off and not heard back on. */
export function renderOpenDelegations(open: ReadonlyArray<FoundryDelegation>): string | null {
  if (open.length === 0) return null;
  const lines = open.map((item) =>
    item.status === "waiting"
      ? `- ${item.id} (${item.to}): waiting for your answer to "${clip(item.question ?? "", 200)}"`
      : `- ${item.id} (${item.to}): working on "${clip(item.task, 160)}"`,
  );
  return [
    "Delegations still open (results and questions arrive as <delegation> messages):",
    ...lines,
  ].join("\n");
}

// ── Commands ───────────────────────────────────────────────────────────────

interface DelegationCommandBase {
  readonly id: string;
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly delegationId: string;
}

export type FoundryDelegationCommand =
  | (DelegationCommandBase & {
      readonly type: "delegate";
      readonly to: string;
      readonly task: string;
    })
  | (DelegationCommandBase & {
      readonly type: "delegate.reply";
      readonly message: string;
    })
  | (DelegationCommandBase & {
      readonly type: "delegate.ask";
      readonly question: string;
    });

export interface DelegationToolContext {
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  /** Record and forward a command to the runtime. */
  readonly emit: (command: FoundryDelegationCommand) => void;
}

function commandId(): string {
  return `command_${randomUUID()}`;
}

/** Tools for an agent with delegates: hand off work, and answer what comes back. */
export function createDelegatorTools(
  context: DelegationToolContext,
  delegates: ReadonlyArray<Required<FoundryDelegateOptions>>,
  onDelegated: (delegation: { readonly id: string; readonly to: string; readonly task: string }) => void,
): ReadonlyArray<GloveFoldArgs<any>> {
  if (delegates.length === 0) return [];
  const routes = delegates.map((delegate) => delegate.agent) as [string, ...string[]];
  const listing = delegates.map((delegate) => `- ${delegate.agent}: ${delegate.description}`).join("\n");
  return [
    {
      name: "glove_foundry_delegate",
      description: [
        "Hand a task to another agent and carry on. This returns at once with a delegation id.",
        "The agent's result, or a question it needs answered, arrives later as a message in <delegation> tags; it is not from the user.",
        "Write the task so it stands alone: the other agent cannot see this conversation.",
        "Agents you can delegate to:",
        listing,
      ].join("\n"),
      inputSchema: z.object({
        to: z.enum(routes).describe("Which agent to hand the task to."),
        task: z.string().min(1).describe("Everything the agent needs to do the work, in one message."),
      }),
      async do(input: { readonly to: string; readonly task: string }) {
        const delegationId = newDelegationId();
        context.emit({
          id: commandId(),
          type: "delegate",
          definitionId: context.definitionId,
          agentId: context.agentId,
          conversationId: context.conversationId,
          workspaceId: context.workspaceId,
          delegationId,
          to: input.to,
          task: input.task,
        });
        onDelegated({ id: delegationId, to: input.to, task: input.task });
        return {
          status: "success" as const,
          data: { delegationId, to: input.to, status: "working" },
        };
      },
    },
    {
      name: "glove_foundry_reply",
      description:
        "Answer a question from an agent you delegated to, or send it more instructions about that task. Use the delegation id from the <delegation> message.",
      inputSchema: z.object({
        delegationId: z.string().min(1).describe("The id from the delegation."),
        message: z.string().min(1).describe("The answer or the new instructions."),
      }),
      async do(input: { readonly delegationId: string; readonly message: string }) {
        if (!isDelegationId(input.delegationId)) {
          return {
            status: "error" as const,
            data: null,
            message: `"${input.delegationId}" is not a delegation id.`,
          };
        }
        context.emit({
          id: commandId(),
          type: "delegate.reply",
          definitionId: context.definitionId,
          agentId: context.agentId,
          conversationId: context.conversationId,
          workspaceId: context.workspaceId,
          delegationId: input.delegationId,
          message: input.message,
        });
        return { status: "success" as const, data: { delegationId: input.delegationId, sent: true } };
      },
    },
  ];
}

export interface PendingQuestion {
  current?: { readonly commandId: string; readonly delegationId: string; readonly question: string };
}

/**
 * The tool a worker uses to ask whoever delegated to it. It waits a short
 * while for the answer so a worker holding live state (a browser session, a
 * sandbox) can carry on in the same run. If no answer comes in time, the run
 * ends as suspended and the answer later starts a new run in the same
 * conversation.
 */
export function createWorkerTools(
  context: DelegationToolContext,
  delegation: FoundryDelegation,
  options: {
    readonly answerWaitMs: number;
    readonly pending: PendingQuestion;
    readonly waitForReply: (timeoutMs: number) => Promise<FoundryDelegationReply | null>;
  },
): ReadonlyArray<GloveFoldArgs<any>> {
  return [
    {
      name: "glove_foundry_ask",
      description: [
        `Ask the ${delegation.from.definitionId} agent, who gave you this task, one question you cannot answer yourself.`,
        "They answer from what they know or ask the user. If the answer comes quickly it is returned here; otherwise end your turn and it arrives as your next message.",
      ].join(" "),
      inputSchema: z.object({
        question: z.string().min(1).describe("One clear question, with the options if there are any."),
      }),
      async do(input: { readonly question: string }) {
        const command: FoundryDelegationCommand = {
          id: commandId(),
          type: "delegate.ask",
          definitionId: context.definitionId,
          agentId: context.agentId,
          conversationId: context.conversationId,
          workspaceId: context.workspaceId,
          delegationId: delegation.id,
          question: input.question,
        };
        options.pending.current = {
          commandId: command.id,
          delegationId: delegation.id,
          question: input.question,
        };
        // Listening starts inside waitForReply before the question leaves, so
        // an instant answer cannot miss this run.
        const reply = options.waitForReply(options.answerWaitMs);
        context.emit(command);
        const answer = await reply;
        if (answer) {
          options.pending.current = undefined;
          return { status: "success" as const, data: { answered: true, answer: answer.message } };
        }
        return {
          status: "success" as const,
          data: {
            answered: false,
            note: "No answer yet. End your turn now with one short line saying what you are waiting for. The answer will arrive as your next message.",
          },
        };
      },
    },
  ];
}

// ── Mailbox ────────────────────────────────────────────────────────────────
//
// The runtime hands deliveries to a run that is listening on its conversation
// by writing files into a per-conversation directory; the run polls it. Files
// are written under a temporary name and renamed, so a reader never sees half
// of one.

function conversationDirectory(directory: string, conversationId: string): string {
  return join(directory, Buffer.from(conversationId, "utf8").toString("hex"));
}

export async function writeMailboxDelivery(
  directory: string,
  conversationId: string,
  delivery: FoundryConversationDelivery,
): Promise<void> {
  const target = conversationDirectory(directory, conversationId);
  await mkdir(target, { recursive: true, mode: 0o700 });
  const name = `${Date.now().toString().padStart(15, "0")}-${randomUUID()}.json`;
  const temporary = join(target, `.tmp-${name}`);
  await writeFile(temporary, `${JSON.stringify(delivery)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, join(target, name));
}

const DELIVERY_SCHEMA = z.union([
  z.object({
    kind: z.literal("reply"),
    delegationId: z.string(),
    from: z.string(),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("result"),
    delegationId: z.string(),
    agent: z.string(),
    task: z.string(),
    result: z.string(),
  }),
  z.object({
    kind: z.literal("question"),
    delegationId: z.string(),
    agent: z.string(),
    task: z.string(),
    question: z.string(),
  }),
  z.object({
    kind: z.literal("failed"),
    delegationId: z.string(),
    agent: z.string(),
    task: z.string(),
    error: z.string(),
  }),
]);

/** Take every delivery waiting for a conversation, oldest first. */
export async function drainMailbox(
  directory: string,
  conversationId: string,
): Promise<FoundryConversationDelivery[]> {
  const target = conversationDirectory(directory, conversationId);
  let names: string[];
  try {
    names = (await readdir(target)).filter((name) => name.endsWith(".json") && !name.startsWith(".tmp-")).sort();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  const deliveries: FoundryConversationDelivery[] = [];
  for (const name of names) {
    const path = join(target, name);
    let text: string;
    try {
      text = await readFile(path, "utf8");
      await unlink(path);
    } catch (cause) {
      // Another reader took it first.
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw cause;
    }
    const parsed = DELIVERY_SCHEMA.safeParse(JSON.parse(text));
    if (parsed.success) deliveries.push(parsed.data as FoundryConversationDelivery);
  }
  return deliveries;
}

export interface ConversationListener {
  stop(): Promise<void>;
}

/**
 * Listen for deliveries to this run's conversation. While a run listens, the
 * runtime writes results, questions and replies to its mailbox instead of
 * starting a new run. `report` tells the runtime when listening starts and stops.
 */
export function listenToConversation(options: {
  readonly directory: string;
  readonly conversationId: string;
  readonly report: (state: "on" | "off") => Promise<void> | void;
  /** Called with each batch of deliveries, oldest first. */
  readonly handler: (deliveries: ReadonlyArray<FoundryConversationDelivery>) => void | Promise<void>;
  readonly pollMs?: number;
}): ConversationListener {
  const pollMs = options.pollMs ?? 100;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling: Promise<void> = Promise.resolve();
  const reported = Promise.resolve(options.report("on"));
  const poll = async (): Promise<void> => {
    const deliveries = await drainMailbox(options.directory, options.conversationId);
    if (deliveries.length > 0) await options.handler(deliveries);
  };
  const tick = (): void => {
    if (stopped) return;
    polling = poll()
      .catch((cause) => {
        process.stderr.write(
          `Foundry mailbox read failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
        );
      })
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, pollMs);
      });
  };
  void reported.then(tick);
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      await reported;
      await polling;
      // Anything that lands after this is the runtime's to redeliver.
      await options.report("off");
    },
  };
}
