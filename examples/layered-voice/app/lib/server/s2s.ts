// The S2S tool host — the ONE place the realtime front model meets the
// heavy text worker.
//
// In S2S mode the realtime model IS the front agent, so the delegation the
// cascaded mode does over the mesh collapses into a single tool:
// `delegateToolHost` publishes the declaration, runs the worker's full agent
// loop behind it, serializes concurrent delegations (a Glove is
// single-threaded over its own history), and hands back the worker's final
// message as the tool result for Nova to relay out loud.
//
// Both routes — the token mint and the tool bridge — read from here, so the
// declaration the model is given and the code that answers it can never
// drift apart.

import type { IGloveRunnable } from "glove-core";
import { delegateToolHost, type S2SToolHost } from "glove-voice-s2s/server";
import { buildWorkerAgent } from "./worker-agent";
import { createAgentStore } from "./stores";

const g = globalThis as unknown as {
  __s2sWorker?: IGloveRunnable;
  __s2sHost?: S2SToolHost;
};

export function s2sWorker(): IGloveRunnable {
  if (!g.__s2sWorker) g.__s2sWorker = buildWorkerAgent(createAgentStore("s2s_worker"));
  return g.__s2sWorker;
}

export function s2sHost(): S2SToolHost {
  if (!g.__s2sHost) {
    g.__s2sHost = delegateToolHost(s2sWorker(), {
      description:
        "Send a research/action request to the capability worker (shop database: catalog, " +
        "customers, hulls, service history, warranty, parts, quotes, financing, appointments). " +
        "Returns the findings.",
      requestDescription:
        "The request, restated clearly, including any hull id / customer name / model heard.",
      // The worker's system prompt tells it to reply over the mesh. In S2S
      // mode the reply channel is the tool result instead, so say so.
      framing: (request) =>
        `[Delegated request from the front desk] ${request}\n\n` +
        `Research this with your tools, then state your findings as plain text ` +
        `(no tool calls needed to reply — your final message IS the reply).`,
      emptyResult: "The worker produced no findings.",
    });
  }
  return g.__s2sHost;
}
