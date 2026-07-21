// ─────────────────────────────────────────────────────────────────────────────
// Inbound event tags — the mirror of the outbound <speech> protocol.
//
// The front agent's history always contains her FULL intended line (glove-core
// persists the whole model turn), but the room may have heard less: the user
// barged in mid-audio, or the TTS stream failed. These builders frame those
// audio-channel realities as tagged EVENT notices appended to her history, so
// the model knows what actually happened:
//
//   <user-interruption> … </user-interruption>  someone talked over you; shows
//                                               exactly how much was heard,
//                                               with the cut-off <speech> tag
//                                               synthetically closed
//   <speech-failure> … </speech-failure>        your line never played at all
//
// The prompt (front-agent.ts) teaches Nova to treat any <tag>-wrapped notice
// as a system signal, not a person speaking.
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT_TAGS = {
  interruption: "user-interruption",
  speechFailure: "speech-failure",
  workerResult: "worker-result",
  workerTrouble: "worker-trouble",
} as const;

/**
 * Frame a barge-in for the front agent's history. `heard` is the estimated
 * prefix of the last spoken line that actually played before the cut — embedded
 * inside a synthetically CLOSED <speech> tag so the transcript stays
 * well-formed even though the real speech was cut mid-tag.
 */
export function frameInterruption(heard: string): string {
  const detail = heard
    ? `Of your last line, the room heard ONLY: <speech>${heard}</speech> — it was cut off right there (the tag is closed synthetically; the rest was never spoken).`
    : `You were cut off before any audio played — the room heard NONE of your last line.`;
  return (
    `<${EVENT_TAGS.interruption}>${detail} ` +
    `Whoever spoke has the floor now. When you next speak, do not re-deliver the unheard remainder wholesale — respond to them first, and re-state only what still matters.` +
    `</${EVENT_TAGS.interruption}>`
  );
}

/** Frame a TTS failure: the line was generated but never reached the room. */
export function frameSpeechFailure(detail?: string): string {
  return (
    `<${EVENT_TAGS.speechFailure}>Your last spoken line failed to play${detail ? ` (${detail})` : ""} — the room did NOT hear it. ` +
    `Re-say the important part when you next have a natural opening.` +
    `</${EVENT_TAGS.speechFailure}>`
  );
}

/**
 * The §5 wakeup notice: the worker finished a delegated request. The actual
 * findings arrive alongside this via the framework's `[Inbox: N item(s)
 * resolved]` injection; the tag tells Nova what kind of moment this is.
 */
export function frameWorkerResult(): string {
  return (
    `<${EVENT_TAGS.workerResult}>Your capability partner finished a delegated request — the findings are in the resolved inbox block in your context. ` +
    `Relay them now to whoever asked, inside <speech> tags: one or two natural spoken sentences with just the key facts. ` +
    `Do not re-delegate unless there is a genuinely new question to answer.` +
    `</${EVENT_TAGS.workerResult}>`
  );
}

/**
 * The §8 failure notice: a delegated request errored or went unanswered.
 * Nova must level with the asker rather than keep them waiting or invent
 * results; the stale waiting reminder is cleared by the orchestrator.
 */
export function frameWorkerTrouble(reason: string): string {
  return (
    `<${EVENT_TAGS.workerTrouble}>A delegated request hit trouble: ${reason}. The asker is still waiting on it. ` +
    `Tell them honestly, inside <speech> tags — a brief heads-up, and offer to try again if they want. Do NOT invent results.` +
    `</${EVENT_TAGS.workerTrouble}>`
  );
}
