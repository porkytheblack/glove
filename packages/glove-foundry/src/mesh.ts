import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GloveFoldArgs } from "glove-core";
import type { AgentIdentity } from "glove-mesh";
import { z } from "zod";
import type { AgentAssemblyContext } from "./definition.js";
import type { AgentInstance } from "./primitives.js";

// Glove Mesh, hosted by Foundry. Agents are peers addressed by their instance
// id; who they are (name, description) is instance data, so it changes without
// touching code. A message to an agent starts a thread: a conversation on the
// recipient. Messages in a thread go to the other side's conversation, into a
// run that is listening (a call) or as a new run once that conversation is
// free. The recipient's final reply goes back on its own.

/** @internal Directory the runtime uses to hand messages to runs that are listening. */
export const FOUNDRY_MAILBOX_DIRECTORY_ENV = "GLOVE_FOUNDRY_MAILBOX_DIRECTORY";
/** @internal A run reports when it starts and stops listening on its conversation. */
export const FOUNDRY_CONVERSATION_LISTEN_EVENT = "foundry.conversation.listen";

const THREAD_ID = /^thread_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Default wait for a reply to a blocking send, inside the same run. */
export const DEFAULT_MESH_WAIT_MS = 90_000;

/**
 * Put an agent on the mesh. Its peers are the other agent instances in its
 * workspace, found from data: a person's bots, a team's agents, whatever the
 * application created.
 */
export interface FoundryMeshOptions {
  /**
   * Which agents this one may see and message, decided from data. Default:
   * every other agent in its workspace. An agent can always answer whoever
   * messaged it.
   */
  readonly peers?: (self: AgentInstance, peer: AgentInstance) => boolean;
  /** How long a blocking send waits in the same run for the reply. Default 90 s. */
  readonly waitMs?: number;
  /**
   * Whether this run gets the mesh tools. Default: every run. Use it to keep a
   * run that must only read, such as scheduled research, from messaging anyone.
   */
  readonly mount?: (context: AgentAssemblyContext) => boolean;
}

/** How an agent appears to its peers: from its instance data. */
export function meshIdentity(agent: AgentInstance): AgentIdentity {
  return {
    id: agent.id,
    name: agent.name ?? agent.id,
    description: agent.description ?? "",
    metadata: { definitionId: agent.definitionId },
  };
}

export type FoundryMeshThreadStatus = "working" | "waiting" | "replied" | "failed" | "cancelled";

export interface FoundryMeshParty {
  readonly agentId: string;
  readonly name: string;
  readonly definitionId: string;
}

/**
 * A conversation between two agents. Its id is also the recipient's
 * conversation id, and the record lives on that conversation's
 * `context.meshThread`.
 */
export interface FoundryMeshThread {
  readonly id: string;
  readonly workspaceId: string;
  /** Who started it, and the conversation its messages go back to. */
  readonly from: FoundryMeshParty & { readonly conversationId: string; readonly runId: string };
  /** Who it was sent to. Their side of the thread is this conversation. */
  readonly to: FoundryMeshParty;
  /** The first message, shortened. */
  readonly subject: string;
  readonly status: FoundryMeshThreadStatus;
  /** Every message id in the thread, so either side can reply to one. */
  readonly messageIds: ReadonlyArray<string>;
  /** The recipient's open question, while status is "waiting". */
  readonly question?: string;
  /** The recipient's last reply. */
  readonly reply?: string;
  readonly error?: string;
  /**
   * Bookkeeping: messages not handed over yet, for the starter's conversation
   * and for this one. Foundry hands them over again after a restart.
   */
  readonly undelivered?: ReadonlyArray<FoundryMeshMessage>;
  readonly pending?: ReadonlyArray<FoundryMeshMessage>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One message between agents, as it reaches a conversation. */
export interface FoundryMeshMessage {
  /**
   * "message": anything an agent sent. "reply": the recipient's final answer,
   * sent when its run finished. "failed": the recipient's run stopped.
   * "ack": a read receipt, which only reaches a run that is waiting.
   */
  readonly kind: "message" | "reply" | "failed" | "ack";
  readonly id: string;
  readonly threadId: string;
  readonly from: { readonly agentId: string; readonly name: string };
  readonly to: string;
  readonly content: string;
  readonly inReplyTo?: string;
  readonly createdAt: string;
}

export function isThreadId(value: string): boolean {
  return THREAD_ID.test(value);
}

export function newThreadId(): string {
  return `thread_${randomUUID()}`;
}

export function newMessageId(): string {
  return `msg_${randomUUID()}`;
}

/** Read a thread record from a conversation's context, if it has one. */
export function threadFromContext(
  context: Readonly<Record<string, unknown>> | undefined,
): FoundryMeshThread | undefined {
  const value = context?.meshThread;
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<FoundryMeshThread>;
  return typeof item.id === "string"
    && typeof item.status === "string"
    && Array.isArray(item.messageIds)
    && item.from && typeof item.from === "object"
    && item.to && typeof item.to === "object"
    ? item as FoundryMeshThread
    : undefined;
}

/** The ids of threads a conversation started, from its context. */
export function startedThreadIds(context: Readonly<Record<string, unknown>> | undefined): ReadonlyArray<string> {
  const value = context?.meshThreads;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function isOpenThread(thread: FoundryMeshThread): boolean {
  return thread.status === "working" || thread.status === "waiting";
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function threadSubject(content: string): string {
  return clip(content, 120);
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
}

/** How a message reads when it arrives in a conversation. */
export function renderMeshMessage(message: FoundryMeshMessage, side: "recipient" | "starter"): string {
  const who = `${message.from.name} (${message.from.agentId})`;
  const status = message.kind === "message" ? "" : ` status="${message.kind === "reply" ? "replied" : message.kind}"`;
  const open = `<mesh-message id="${escapeAttribute(message.id)}" thread="${escapeAttribute(message.threadId)}" from="${escapeAttribute(message.from.agentId)}" name="${escapeAttribute(message.from.name)}"${status}>`;
  const body = message.kind === "failed" ? `It stopped: ${message.content}` : message.content;
  const lines = [open, body, "</mesh-message>"];
  if (side === "recipient") {
    lines.push(
      `${who} is another agent, not the user. Your final reply goes back to them on its own, so make it the answer itself.`,
      `If you cannot go on without something only they or their user know, ask with glove_mesh_send_message to "${message.from.agentId}".`,
    );
  } else if (message.kind === "message") {
    lines.push(
      `${who} needs an answer to go on. If you know it, reply with glove_mesh_send_message to "${message.from.agentId}" with in_reply_to "${message.id}". Otherwise ask the user first, then reply.`,
    );
  }
  return lines.join("\n");
}

export function renderMeshMessages(
  messages: ReadonlyArray<FoundryMeshMessage>,
  side: (message: FoundryMeshMessage) => "recipient" | "starter",
): string {
  return messages.map((message) => renderMeshMessage(message, side(message))).join("\n\n");
}

/** Runtime context: the threads this conversation started and has not heard back on. */
export function renderOpenThreads(open: ReadonlyArray<FoundryMeshThread>): string | null {
  if (open.length === 0) return null;
  const lines = open.map((thread) =>
    thread.status === "waiting"
      ? `- ${thread.to.name} (${thread.to.agentId}), thread ${thread.id}: waiting for your answer to "${clip(thread.question ?? "", 200)}"`
      : `- ${thread.to.name} (${thread.to.agentId}), thread ${thread.id}: working on "${clip(thread.subject, 160)}"`,
  );
  return [
    "Agents still working on what you sent them (their replies arrive as <mesh-message> messages):",
    ...lines,
  ].join("\n");
}

/** Runtime context for the recipient's side of a thread. */
export function renderOwnThread(thread: FoundryMeshThread): string {
  return `In this conversation you are working for ${thread.from.name} (${thread.from.agentId}), another agent. Your final reply is sent to them.`;
}

// ── Commands ───────────────────────────────────────────────────────────────
//
// The tools ask the runtime, which owns the data: who the peers are, which
// thread a message belongs to, and whether it may be sent. The runtime
// answers each call, so a tool can report a refusal straight away.

interface MeshCommandBase {
  readonly id: string;
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
}

export type FoundryMeshCommand =
  | (MeshCommandBase & {
      readonly type: "mesh.list";
      readonly name?: string;
    })
  | (MeshCommandBase & {
      readonly type: "mesh.send";
      /**
       * The message. `threadId` is used when it starts a new thread; a reply
       * in an existing thread takes that thread's id.
       */
      readonly message: {
        readonly id: string;
        readonly threadId: string;
        readonly to: string;
        readonly content: string;
        readonly inReplyTo?: string;
      };
    })
  | (MeshCommandBase & {
      readonly type: "mesh.ack";
      readonly messageId: string;
      readonly note: string;
    });

export function isMeshCommand(command: { readonly type: string }): command is FoundryMeshCommand {
  return command.type === "mesh.list" || command.type === "mesh.send" || command.type === "mesh.ack";
}

/** What the runtime answers a send with. */
export interface FoundryMeshSent {
  readonly messageId: string;
  readonly threadId: string;
  readonly to: string;
  /** "new" started a thread; the others continued one toward that side. */
  readonly direction: "new" | "to-recipient" | "to-starter";
}

function commandId(): string {
  return `command_${randomUUID()}`;
}

export interface PendingMeshReply {
  current?: { readonly commandId: string; readonly threadId: string; readonly messageId: string };
}

export interface MeshToolContext {
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly options: FoundryMeshOptions;
  /** Send a command and wait for the runtime's answer. */
  readonly call: (command: FoundryMeshCommand) => Promise<unknown>;
  /** Wait in this run for the next message from an agent. Start it before sending. */
  readonly waitFrom: (agentId: string, timeoutMs: number) => {
    readonly message: Promise<FoundryMeshMessage | null>;
    readonly cancel: () => void;
  };
  readonly pending: PendingMeshReply;
}

const failure = (cause: unknown) => ({
  status: "error" as const,
  data: null,
  message: cause instanceof Error ? cause.message : String(cause),
});

/**
 * Glove Mesh's four tools, with Foundry as the transport. The names and
 * inputs match glove-mesh, so an agent written for Glove Mesh works here.
 */
export function createMeshTools(context: MeshToolContext): ReadonlyArray<GloveFoldArgs<any>> {
  const waitMs = context.options.waitMs ?? DEFAULT_MESH_WAIT_MS;
  const base = () => ({
    id: commandId(),
    definitionId: context.definitionId,
    agentId: context.agentId,
    conversationId: context.conversationId,
    workspaceId: context.workspaceId,
  });
  const send = (input: { readonly to: string; readonly content: string; readonly in_reply_to?: string }) => {
    const command: FoundryMeshCommand = {
      ...base(),
      type: "mesh.send",
      message: {
        id: newMessageId(),
        threadId: newThreadId(),
        to: input.to,
        content: input.content,
        ...(input.in_reply_to ? { inReplyTo: input.in_reply_to } : {}),
      },
    };
    return { command, sent: () => context.call(command) as Promise<FoundryMeshSent> };
  };

  return [
    {
      name: "glove_mesh_list_agents",
      description: "List the agents you can message: their ids, names and what they do. Filter by a name substring.",
      inputSchema: z.object({
        name: z.string().optional().describe("Only agents whose name contains this, ignoring case."),
      }),
      async do(input: { readonly name?: string }) {
        try {
          const agents = await context.call({ ...base(), type: "mesh.list", ...(input.name ? { name: input.name } : {}) });
          return { status: "success" as const, data: { agents } };
        } catch (cause) {
          return failure(cause);
        }
      },
    },
    {
      name: "glove_mesh_send_message",
      description: [
        "Send a message to another agent by its id. A new message starts a thread: the agent works on it in its own conversation, and its reply arrives later as a <mesh-message> message.",
        "Set in_reply_to to answer a message you received in a thread. Set blocking to wait here for the reply; if it does not come in time, end your turn and it arrives as your next message.",
        "The other agent cannot see this conversation, so write the message so it stands alone.",
      ].join(" "),
      inputSchema: z.object({
        to: z.string().min(1).describe("The agent's id, from glove_mesh_list_agents or a message it sent."),
        content: z.string().min(1).describe("Everything the agent needs, in one message."),
        in_reply_to: z.string().optional().describe("The id of the message you are answering."),
        blocking: z.boolean().default(false).describe("Wait here for the reply."),
      }),
      async do(input: { readonly to: string; readonly content: string; readonly in_reply_to?: string; readonly blocking?: boolean }) {
        const { command, sent } = send(input);
        // Listen before the message leaves, so an instant reply cannot miss this run.
        const waiting = input.blocking ? context.waitFrom(input.to, waitMs) : undefined;
        let result: FoundryMeshSent;
        try {
          result = await sent();
        } catch (cause) {
          waiting?.cancel();
          return failure(cause);
        }
        const data = { message_id: result.messageId, thread_id: result.threadId, to: result.to };
        if (!waiting) return { status: "success" as const, data };
        context.pending.current = { commandId: command.id, threadId: result.threadId, messageId: result.messageId };
        const answer = await waiting.message;
        if (answer) {
          context.pending.current = undefined;
          return {
            status: "success" as const,
            data: {
              ...data,
              reply: answer.kind === "failed" ? `It stopped: ${answer.content}` : answer.content,
              reply_id: answer.id,
            },
          };
        }
        return {
          status: "success" as const,
          data: {
            ...data,
            note: "No reply yet. End your turn now with one short line saying what you are waiting for. The reply arrives as your next message.",
          },
        };
      },
    },
    {
      name: "glove_mesh_broadcast",
      description: "Send the same message to every agent you can message. Each one starts its own thread, and each reply arrives on its own.",
      inputSchema: z.object({
        content: z.string().min(1).describe("The message, written to stand alone."),
      }),
      async do(input: { readonly content: string }) {
        try {
          const agents = await context.call({ ...base(), type: "mesh.list" }) as ReadonlyArray<AgentIdentity>;
          const sent: string[] = [];
          for (const agent of agents) {
            await send({ to: agent.id, content: input.content }).sent();
            sent.push(agent.id);
          }
          return { status: "success" as const, data: { to: sent } };
        } catch (cause) {
          return failure(cause);
        }
      },
    },
    {
      name: "glove_mesh_acknowledge",
      description: "Tell an agent you got its message, without answering yet. It reaches the agent only while it is waiting for you.",
      inputSchema: z.object({
        message_id: z.string().min(1),
        note: z.string().optional(),
      }),
      async do(input: { readonly message_id: string; readonly note?: string }) {
        try {
          await context.call({ ...base(), type: "mesh.ack", messageId: input.message_id, note: input.note ?? "Got it." });
          return { status: "success" as const, data: { acknowledged: input.message_id } };
        } catch (cause) {
          return failure(cause);
        }
      },
    },
  ];
}

// ── Mailbox ────────────────────────────────────────────────────────────────
//
// The runtime hands messages to a run that is listening on its conversation
// by writing files into a per-conversation directory; the run polls it. Files
// are written under a temporary name and renamed, so a reader never sees half
// of one.

function conversationDirectory(directory: string, conversationId: string): string {
  return join(directory, Buffer.from(conversationId, "utf8").toString("hex"));
}

export async function writeMailboxDelivery(
  directory: string,
  conversationId: string,
  message: FoundryMeshMessage,
): Promise<void> {
  const target = conversationDirectory(directory, conversationId);
  await mkdir(target, { recursive: true, mode: 0o700 });
  const name = `${Date.now().toString().padStart(15, "0")}-${randomUUID()}.json`;
  const temporary = join(target, `.tmp-${name}`);
  await writeFile(temporary, `${JSON.stringify(message)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, join(target, name));
}

const MESSAGE_SCHEMA = z.object({
  kind: z.enum(["message", "reply", "failed", "ack"]),
  id: z.string(),
  threadId: z.string(),
  from: z.object({ agentId: z.string(), name: z.string() }),
  to: z.string(),
  content: z.string(),
  inReplyTo: z.string().optional(),
  createdAt: z.string(),
});

/** Take every message waiting for a conversation, oldest first. */
export async function drainMailbox(
  directory: string,
  conversationId: string,
): Promise<FoundryMeshMessage[]> {
  const target = conversationDirectory(directory, conversationId);
  let names: string[];
  try {
    names = (await readdir(target)).filter((name) => name.endsWith(".json") && !name.startsWith(".tmp-")).sort();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  const messages: FoundryMeshMessage[] = [];
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
    const parsed = MESSAGE_SCHEMA.safeParse(JSON.parse(text));
    if (parsed.success) messages.push(parsed.data as FoundryMeshMessage);
  }
  return messages;
}

export interface ConversationListener {
  stop(): Promise<void>;
}

/**
 * Listen for messages to this run's conversation. While a run listens, the
 * runtime writes them to its mailbox instead of starting a new run. `report`
 * tells the runtime when listening starts and stops.
 */
export function listenToConversation(options: {
  readonly directory: string;
  readonly conversationId: string;
  readonly report: (state: "on" | "off") => Promise<void> | void;
  /** Called with each batch of messages, oldest first. */
  readonly handler: (messages: ReadonlyArray<FoundryMeshMessage>) => void | Promise<void>;
  readonly pollMs?: number;
}): ConversationListener {
  const pollMs = options.pollMs ?? 100;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling: Promise<void> = Promise.resolve();
  const reported = Promise.resolve(options.report("on"));
  const poll = async (): Promise<void> => {
    const messages = await drainMailbox(options.directory, options.conversationId);
    if (messages.length > 0) await options.handler(messages);
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
