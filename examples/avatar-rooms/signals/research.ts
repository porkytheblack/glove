// The delegation job.
//
// Fire-and-forget from the room's point of view: the front agent's mesh send
// queues this run and returns immediately, so Nova acknowledges out loud and
// keeps the floor. This run then does the research in its own process and
// CONSOLIDATES BACK THROUGH THE MESH — a threaded `glove_mesh_send_message`
// with `in_reply_to` set, which resolves the front agent's pending
// `mesh:waiting` item and wakes her with the findings (§5).
//
// Running the worker as a signal rather than an in-process peer buys:
//   • Isolation — a crash, hang or OOM in the heavy agent is the supervisor's
//     problem, not the voice loop's. The room keeps talking.
//   • A timeout and retries around the whole unit of work.
//   • A durable Run record: what was asked, what came back, how long it took,
//     what retried. Voice systems are miserable to debug precisely because
//     that record usually does not exist.
//
// The cost is a cold process per run — no warm agent, no conversation memory —
// which is why the front agent's prompt insists on a SELF-CONTAINED request.

import { signal, z } from "station-signal";
import { MemoryStore, type SubscriberAdapter } from "glove-core";
import { mountMesh } from "glove-mesh";
import { buildWorkerAgent } from "../lib/worker-agent";
import {
  FRONT_ID,
  WORKER_IDENTITY,
  WorkerMeshAdapter,
} from "../lib/mesh-transport";

const DRAIN_PROMPT =
  'You have a new delegated request in your inbox. Research it with your tools, then reply to the front agent (id "front") via glove_mesh_send_message with in_reply_to set to the message id shown in the inbox line. Do NOT acknowledge — reply only.';

const RETRY_PROMPT =
  "You did all that research but NEVER SENT YOUR REPLY — the front desk and the customer are still waiting. Call glove_mesh_send_message NOW with to: \"front\", in_reply_to set to the message id from the inbox line, and content carrying your findings. Do not do any more research; reply with what you already have.";

export const research = signal("research")
  .input(
    z.object({
      /** A self-contained question for the shop database. */
      request: z.string().min(1),
      /** The front agent's mesh message id — the reply must be threaded to it,
       *  or her blocking send never resolves. */
      messageId: z.string(),
      /** Which room asked, for logs and metrics. */
      roomId: z.string(),
      /** Where the threaded reply goes: the room's inbound mesh endpoint. */
      replyUrl: z.string(),
      meshToken: z.string(),
    }),
  )
  .output(
    z.object({
      replied: z.boolean(),
      answer: z.string(),
      toolCalls: z.number(),
      recovered: z.boolean(),
    }),
  )
  .timeout(90_000)
  // Safe to retry: every tool is a read except book_appointment, which the
  // prompt gates behind a confirmation.
  .retries(1)
  .run(async (input) => {
    const mesh = new WorkerMeshAdapter({
      replyUrl: input.replyUrl,
      token: input.meshToken,
    });

    const worker = buildWorkerAgent(new MemoryStore(`worker_${input.roomId}`));

    let replied = false;
    let answer = "";
    let toolCalls = 0;
    const subscriber: SubscriberAdapter = {
      record: async (type, data) => {
        if (type !== "tool_use") return;
        const d = data as { name: string; input: unknown };
        if (d.name === "glove_mesh_send_message") {
          replied = true;
          answer = String((d.input as { content?: string })?.content ?? "");
        } else if (!d.name.startsWith("glove_mesh_")) {
          toolCalls += 1;
        }
      },
    };
    worker.addSubscriber(subscriber);

    await mountMesh(worker, { adapter: mesh, identity: WORKER_IDENTITY });

    // Put the delegated request in the worker's inbox exactly the way the
    // in-process bus would, so the prompt's "read the message id from the
    // inbox line" instructions hold unchanged.
    await mesh.deliver({
      kind: "direct",
      id: input.messageId,
      from: FRONT_ID,
      to: WORKER_IDENTITY.id,
      content: input.request,
      created_at: new Date().toISOString(),
      blocking: true,
    });

    await worker.processRequest(DRAIN_PROMPT);

    // Reasoning workers sometimes finish the research and just stop without
    // sending. One firm nudge recovers most of those runs far cheaper than
    // leaving the caller waiting on a trouble turn.
    let recovered = false;
    if (!replied) {
      await worker.processRequest(RETRY_PROMPT);
      recovered = replied;
    }

    if (!replied) {
      // Fail the Run rather than resolving with silence: a failed run is
      // visible in the dashboard and retried, where an empty success would
      // just strand the caller. The room's own timeout covers the customer.
      throw new Error("worker never sent its mesh reply");
    }

    return { replied, answer, toolCalls, recovered };
  });
