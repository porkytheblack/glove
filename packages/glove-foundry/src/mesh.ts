import { randomUUID } from "node:crypto";
import type { GloveFoldArgs } from "glove-core";
import type { AgentIdentity } from "glove-mesh";
import { z } from "zod";
import type { AgentAssemblyContext } from "./definition.js";
import type { AgentInstance } from "./primitives.js";

// Glove Mesh, hosted by Foundry, for agents that are peers: existing instances
// in one workspace, addressed by instance id. Who they are (name, description)
// is instance data, so it changes without touching code. A message to an agent
// starts a thread: a conversation on the recipient. Messages in a thread go to
// the other side's conversation through Foundry's durable event delivery (the
// "mesh" delivery kind in delegation.ts): into the run working there, or as one
// run once that conversation is free. The recipient's final reply goes back on
// its own. For workers an agent owns, use durableSubagents or delegates.

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

export type FoundryMeshThreadStatus = "working" | "waiting" | "replied" | "failed" | "cancelled" | "taken-over";

export interface FoundryMeshParty {
  readonly agentId: string;
  readonly name: string;
  readonly definitionId: string;
  /** The party's workspace. Older records: the thread's `workspaceId`. */
  readonly workspaceId?: string;
}

/** A message the application's gate held or drafted: stored, not delivered. */
export interface FoundryMeshHeldMessage {
  readonly message: FoundryMeshMessage;
  readonly side: "recipient" | "starter";
  readonly decision: "hold" | "draft";
  /** The approval that decides a draft. */
  readonly approvalId?: string;
  /** What delivering it changes on the thread, such as a question the starter is now asked. */
  readonly onDeliver?: { readonly status?: FoundryMeshThreadStatus; readonly question?: string; readonly reply?: string };
}

/** A message on its way: committed to the application's record (or about to be), not yet handed over. */
export interface FoundryMeshOutgoing {
  readonly message: FoundryMeshMessage;
  readonly side: "recipient" | "starter";
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
  /** The application's record this thread is bound to (`mesh.bindThread`). Default: the thread id. */
  readonly record?: string;
  /** Messages the application's gate held or drafted, until they are released or discarded. */
  readonly held?: ReadonlyArray<FoundryMeshHeldMessage>;
  /** Messages being committed to the application's record and handed over. Retried at start. */
  readonly outbox?: ReadonlyArray<FoundryMeshOutgoing>;
  /** Who took the thread over, and which agents left it. */
  readonly takenOver?: { readonly by: string; readonly agentIds: ReadonlyArray<string>; readonly at: string };
  /**
   * Older records only: messages not handed over yet, for the starter's
   * conversation and for this one. On start Foundry moves them to the event
   * journal and drops these lists.
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
  /**
   * Who sent it. For a person (`kind: "human"`, entered with
   * `runtime.meshHumanMessage`), `agentId` is the application's id for them.
   */
  readonly from: { readonly agentId: string; readonly name: string; readonly kind?: "agent" | "human" };
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

/** Whether an agent has left a thread because a person took it over. */
export function isTakenOverBy(thread: FoundryMeshThread, agentId: string): boolean {
  return Boolean(thread.takenOver?.agentIds.includes(agentId));
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
export function renderMeshMessage(message: FoundryMeshMessage, side: "recipient" | "starter", peer?: string): string {
  const who = `${message.from.name} (${message.from.agentId})`;
  const status = message.kind === "message" ? "" : ` status="${message.kind === "reply" ? "replied" : message.kind}"`;
  const human = message.from.kind === "human";
  const open = `<mesh-message id="${escapeAttribute(message.id)}" thread="${escapeAttribute(message.threadId)}" from="${escapeAttribute(message.from.agentId)}" name="${escapeAttribute(message.from.name)}"${human ? ' party="human"' : ""}${status}>`;
  const body = message.kind === "failed" ? `It stopped: ${message.content}` : message.content;
  const lines = [open, body, "</mesh-message>"];
  if (human) {
    lines.push(side === "recipient"
      ? `${message.from.name} is a person in this thread, not an agent. Your final reply goes to the thread on its own.`
      : `${message.from.name} is a person in your thread${peer ? ` with ${peer}` : ""}. To answer in the thread, use glove_mesh_send_message${peer ? ` to "${peer}"` : ""} with in_reply_to "${message.id}".`);
  } else if (side === "recipient") {
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

// ── The application's rules ─────────────────────────────────────────────────
//
// An application with its own record of conversations sets
// `defineApplication({ mesh })`. Foundry still hosts the threads, but the
// application decides who an agent can see (in any workspace), whether each
// message is delivered, held, drafted or refused, which record a thread is
// bound to, and it commits every message to that record before Foundry hands
// it over. Without it, the mesh is the workspace's, ungated.

/** An agent the application lets a sender see. Name and description default to the instance's. */
export interface FoundryMeshPeer {
  readonly agentId: string;
  readonly name?: string;
  readonly description?: string;
}

/** What the application's hooks get besides their input. */
export interface FoundryMeshHookContext {
  readonly data: import("./primitives.js").FoundryDataAdapter;
  /** The run that sent it, when an agent did. */
  readonly runId?: string;
}

/**
 * One message on its way, for the gate. The sender is the run's own
 * instance, checked by the controller: never what the model claimed.
 */
export interface FoundryMeshSend {
  /** "message": sent with glove_mesh_send_message. "reply": the recipient's final answer. "ack": a read receipt. */
  readonly kind: "message" | "reply" | "ack";
  /** Stable across retries. */
  readonly messageId: string;
  /** The thread it continues. Absent when it would start one. */
  readonly thread?: FoundryMeshThread;
  readonly sender: AgentInstance;
  /** The sender's conversation it was sent from. */
  readonly senderConversationId: string;
  readonly recipient: AgentInstance;
  readonly content: string;
  readonly inReplyTo?: string;
}

/**
 * What happens to a message. To the sender, "deliver", "hold" and "draft"
 * look the same. "refuse" fails the send with `message`, your wording.
 */
export type FoundryMeshDecision =
  | { readonly decision: "deliver" }
  /** Stored, not delivered, until `runtime.releaseMeshMessage`. */
  | { readonly decision: "hold" }
  /**
   * Stored, not delivered, behind a Foundry approval: approved, it is
   * delivered; denied, it is dropped. Pass `approvalId` (`approval_<uuid>`)
   * to choose its id.
   */
  | { readonly decision: "draft"; readonly approvalId?: string }
  | { readonly decision: "refuse"; readonly message: string };

/** A thread about to start, for the application to bind to its record. */
export interface FoundryMeshThreadStart {
  /** The id Foundry would use. */
  readonly proposedId: string;
  readonly sender: AgentInstance;
  readonly senderConversationId: string;
  readonly recipient: AgentInstance;
  readonly messageId: string;
  readonly content: string;
}

/** A message for the application's record, before it is delivered. */
export interface FoundryMeshRecordedMessage {
  readonly thread: FoundryMeshThread;
  readonly message: FoundryMeshMessage;
  /** The side it goes to. */
  readonly side: "recipient" | "starter";
}

type MeshResolvable<T> = T | Promise<T> | import("effect").Effect.Effect<T, unknown, never>;

export interface FoundryApplicationMesh {
  /**
   * Who `sender` can see and message, in any workspace. Replaces the
   * workspace's agents when set; a definition's own `mesh.peers` still
   * narrows it. Asked again for every list and every new thread, so a block
   * takes effect at once.
   */
  readonly peers?: (sender: AgentInstance, context: FoundryMeshHookContext) => MeshResolvable<ReadonlyArray<FoundryMeshPeer>>;
  /**
   * The gate, asked before every message is delivered: new threads, replies
   * in open threads (both ways), recipients' final answers and read
   * receipts. Default: deliver.
   */
  readonly authorize?: (send: FoundryMeshSend, context: FoundryMeshHookContext) => MeshResolvable<FoundryMeshDecision>;
  /**
   * Name a new thread after your record, such as your conversation id.
   * `threadId` is the recipient's conversation id in Foundry, so it is new
   * per direction; `record` (default `threadId`) is what `commit` gets.
   * Returning the id of a thread between the same two agents, in the same
   * direction, continues that thread.
   */
  readonly bindThread?: (start: FoundryMeshThreadStart, context: FoundryMeshHookContext) => MeshResolvable<{ readonly threadId: string; readonly record?: string }>;
  /**
   * Write a message to your record before it is delivered. Must be
   * idempotent on `message.id`: after a crash Foundry commits again, then
   * delivers. A person's message (`runtime.meshHumanMessage`) came from your
   * record and is not committed again.
   */
  readonly commit?: (recorded: FoundryMeshRecordedMessage, context: FoundryMeshHookContext) => MeshResolvable<{ readonly recordId?: string } | void>;
  /**
   * What a sender reads when Foundry itself refuses: an agent it cannot
   * reach, or a thread it was taken off. Default: "Your message could not be sent."
   */
  readonly refusal?: string;
}

/** The default wording when the application's mesh refuses a send. */
export const DEFAULT_MESH_REFUSAL = "Your message could not be sent.";

const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;

/** Whether an id from `bindThread` can name a conversation. */
export function isBindableThreadId(value: string): boolean {
  return RECORD_ID.test(value) && !value.includes("..");
}
