// The delegation job.
//
// In the browser-hosted example the worker is a second in-process agent that
// the front agent reaches over glove-mesh. Here it is a station SIGNAL: a
// discrete unit of work, run to completion in its own supervised child
// process, with a timeout, retries, and a durable Run record carrying its
// input, output and timing.
//
// That swap buys three things the in-process mesh cannot give you:
//   • The heavy agent cannot take the voice loop down with it. It runs in a
//     different process; a crash, a hang, or an OOM is the supervisor's
//     problem, and Nova keeps talking.
//   • Delegations survive the gateway. The Run is in the database before the
//     worker starts, so a gateway restart mid-research loses the conversation
//     but never the job.
//   • Every delegation is inspectable after the fact — `station` dashboard,
//     runs view: what was asked, what came back, how long it took, what
//     retried. Voice systems are miserable to debug precisely because this
//     record normally does not exist.
//
// The cost is that each run is a cold process: no warm agent, no conversation
// memory. That is why the front agent's tool description insists on a
// SELF-CONTAINED request — the worker starts from nothing every time. For a
// research job that is the right shape anyway, and it makes each run a pure
// function of its input, which is what makes retries safe.

import { signal, z } from "station-signal";
import { MemoryStore, type SubscriberAdapter } from "glove-core";
import { buildWorkerAgent } from "../lib/worker-agent";

export const research = signal("research")
  .input(
    z.object({
      /** A self-contained question for the shop database. */
      request: z.string().min(1),
      /** Which voice session asked, so the gateway can route the answer back. */
      sessionId: z.string().optional(),
    }),
  )
  .output(
    z.object({
      /** What gets read to the customer. */
      answer: z.string(),
      /** How many database lookups it took — visible in the dashboard. */
      toolCalls: z.number(),
      ms: z.number(),
    }),
  )
  // The worker makes many tool calls over the database; give it room, but not
  // so much that a wedged run keeps a customer waiting indefinitely.
  .timeout(90_000)
  // Retries are safe: the run is a pure function of its input, and every tool
  // it uses is a read except book_appointment (which the prompt gates behind a
  // confirmation).
  .retries(1)
  .run(async (input) => {
    const worker = buildWorkerAgent(new MemoryStore(`research_${Date.now()}`));

    // The worker's answer is whatever it says AFTER its last tool call. Every
    // tool call resets the accumulator, so intermediate narration ("let me
    // check the warranty table…") never survives into the reply.
    let answer = "";
    let toolCalls = 0;
    const subscriber: SubscriberAdapter = {
      record: async (type, data) => {
        if (type === "text_delta") {
          answer += (data as { text: string }).text;
        } else if (type === "tool_use") {
          toolCalls += 1;
          answer = "";
        }
      },
    };
    worker.addSubscriber(subscriber);

    const startedAt = Date.now();
    await worker.processRequest(
      `[Delegated request from the front desk]\n\n${input.request}\n\n` +
        `Research this with your tools and answer it directly. Your final message IS the reply that gets read to the customer — no preamble, no "here is what I found", just the answer.`,
    );

    const reply = answer.trim();
    if (!reply) {
      // Fail loudly rather than resolving with silence: a failed Run surfaces
      // in the dashboard and gets retried, where an empty success would just
      // leave the customer waiting on nothing.
      throw new Error("worker produced no reply text");
    }

    return {
      answer: reply,
      toolCalls,
      ms: Date.now() - startedAt,
    };
  });
