// The ADDRESSING-MONITOR agent — the second "frontend" agent.
//
// It has no microphone and never joins the conversation. On every transcribed
// utterance it reads the speaker label + recent transcript and infers ONE
// thing: was this line addressed to Nova, or to another person in the room?
// Its verdict gates whether the front agent responds at all. This is what lets
// the system tell "you talking to it" apart from "you talking to someone else".
//
// It's rebuilt fresh per utterance (a classifier wants clean context each time),
// reusing the monitor model tier.

import { Glove, Displaymanager, MemoryStore, type SubscriberAdapter } from "glove-core";
import { z } from "zod";
import { buildModel } from "./models";
import { ASSISTANT_NAME, rosterForMonitor, speakerLabel } from "./speakers";
import type { AddressingVerdict, SpeakerRole } from "../shared/types";

export interface MonitorLine {
  role: SpeakerRole;
  text: string;
  /** How this earlier line was ultimately treated, if known. */
  addressee?: "assistant" | "human" | "ambiguous";
}

const MONITOR_SYSTEM_PROMPT = `You are the addressing monitor for a voice assistant named "${ASSISTANT_NAME}" at a busy starship service desk. Multiple people are in the room and talk both to each other AND to ${ASSISTANT_NAME}. You cannot hear tone — you only get the transcript with speaker labels.

Your ONLY job: decide who the LATEST utterance is addressed to. Respond by calling report_addressing exactly once, then stop.

The people in the room:
${rosterForMonitor()}
Plus ${ASSISTANT_NAME} — the voice assistant (not a person; never a speaker).

Decide one of:
- "assistant": the latest line is directed at ${ASSISTANT_NAME} — a question, request, or command clearly meant for the assistant. Signals: naming ${ASSISTANT_NAME}, asking for a lookup/quote/booking, "can you…", "pull up…", "what's the…", or answering a question ${ASSISTANT_NAME} just asked.
- "human": the latest line is directed at another PERSON in the room, not the assistant. Signals: using someone's name, side-chat between the operator and customer, small talk between people, or a reply to what a person (not ${ASSISTANT_NAME}) just said.
- "ambiguous": genuinely unclear who it's aimed at, or it could be either.

Use the recent transcript for context — who spoke last, who asked what. Prefer "human" for casual chatter between people, and "assistant" for anything that reads like an instruction or a lookup request. Be decisive; only use "ambiguous" when you truly cannot tell.`;

function buildPrompt(recent: MonitorLine[], latest: MonitorLine): string {
  const lines = recent.length
    ? recent
        .map((l) => {
          const tag = l.addressee ? ` {addressed to: ${l.addressee}}` : "";
          return `  ${speakerLabel(l.role)}: "${l.text}"${tag}`;
        })
        .join("\n")
    : "  (no prior lines)";
  return `Recent transcript (oldest first):
${lines}

LATEST utterance to classify:
  ${speakerLabel(latest.role)}: "${latest.text}"

Who is this latest utterance addressed to? Call report_addressing.`;
}

export async function classifyAddressing(
  args: { recent: MonitorLine[]; latest: MonitorLine },
  subscriber?: SubscriberAdapter,
): Promise<AddressingVerdict> {
  let captured: AddressingVerdict | null = null;

  const agent = new Glove({
    store: new MemoryStore(`monitor_${Date.now()}`),
    model: buildModel("monitor", false),
    displayManager: new Displaymanager(),
    systemPrompt: MONITOR_SYSTEM_PROMPT,
    serverMode: true,
    compaction_config: { compaction_instructions: "n/a" },
  })
    .fold({
      name: "report_addressing",
      description: "Report your verdict on who the latest utterance is addressed to. Call this exactly once.",
      inputSchema: z.object({
        addressee: z.enum(["assistant", "human", "ambiguous"]).describe("Who the latest utterance is aimed at"),
        confidence: z.number().min(0).max(1).describe("Your confidence, 0 to 1"),
        reason: z.string().describe("One short sentence explaining the call"),
      }),
      async do(input) {
        captured = {
          addressee: input.addressee,
          confidence: input.confidence,
          reason: input.reason,
        };
        return { status: "success", data: "Verdict recorded. You are done." };
      },
    })
    .build();

  if (subscriber) agent.addSubscriber(subscriber);

  try {
    await agent.processRequest(buildPrompt(args.recent, args.latest));
  } catch (err) {
    return {
      addressee: "ambiguous",
      confidence: 0,
      reason: `Monitor error: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  return (
    captured ?? {
      addressee: "ambiguous",
      confidence: 0,
      reason: "Monitor did not return a structured verdict.",
    }
  );
}
