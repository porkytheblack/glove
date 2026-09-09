import type { ContentPart, Message, ModelPromptResult } from "glove-core";

interface PromptTarget {
  getSystemPrompt(): string;
  setSystemPrompt(prompt: string): void;
  processRequest(request: string | ContentPart[], signal?: AbortSignal): Promise<ModelPromptResult | Message>;
}
let sequence = 0;

/**
 * Each subsystem owns only its exact marked block. Read the live prompt when
 * writing, never a registration-time snapshot: otherwise the innermost
 * processRequest wrapper erases the sections mounted after it. Markers also
 * allow an empty status to remove its old block without erasing host edits.
 */
export function attachPromptSection(target: PromptTarget, render: () => Promise<string>): { set: (text: string) => void; refresh: () => Promise<void> } {
  const id = ++sequence;
  let previous = "";
  let revision = 0;
  const originalSetter = target.setSystemPrompt.bind(target);
  // Host lifecycle/configuration code may replace the base instructions.
  // Each mounted subsystem keeps ownership of its live block, including
  // when setters are stacked through a runnable proxy.
  target.setSystemPrompt = (prompt) => {
    originalSetter(previous && !prompt.includes(previous) ? prompt + previous : prompt);
  };
  const set = (text: string) => {
    revision++;
    const current = target.getSystemPrompt();
    const base = previous ? current.replace(previous, "") : current;
    previous = text ? `\n\n<glove-memory-section id="${id}">\n${text}\n</glove-memory-section>` : "";
    // Bypass our own preserving setter so an empty render really removes
    // this section. Earlier subsystems still preserve their own blocks.
    originalSetter(base + previous);
  };
  const refresh = async () => {
    const startedAt = revision;
    const rendered = await render();
    // A write may refresh this section while an older storage read is in
    // flight. Do not replace that committed status with the stale read.
    if (revision === startedAt) set(rendered);
  };
  const original = target.processRequest.bind(target);
  target.processRequest = async (request, signal) => {
    await refresh();
    return original(request, signal);
  };
  return { set, refresh };
}
