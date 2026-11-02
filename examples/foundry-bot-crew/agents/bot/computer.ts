import { defineWorkingEnvironment, foundryDataEnvironmentPersistence, type FoundryRequest } from "glove-foundry";
import { fetchFiles } from "glove-env-fetch";
import gmail from "./transmissions/gmail.transmission.js";

/** A run that new mail started: the mail is text from anyone, so it gets no network. */
export const startedByMail = (request: FoundryRequest): boolean =>
  request.source?.kind === "transmission" && request.source.provider === gmail.id;

/**
 * One computer per person, shared by all their bots: files one bot writes
 * under /workspace, another can read. Foundry saves it per workspace, and the
 * workspace is the person. Saves replace the whole snapshot, so two bots
 * writing at once keep the last one; on Kuiper, a sandbox and a browser per
 * person (glove-execution/kuiper) replace it with one live machine.
 *
 * On a run that new mail started, the computer has files and scripts but no
 * web: an email that tells a bot to send what it read somewhere has nowhere to
 * send it.
 */
export const computer = defineWorkingEnvironment({
  options: ({ assembly }) => ({
    stdlib: startedByMail(assembly.request) ? [] : [fetchFiles({ maxResponseBytes: 2_000_000 })],
  }),
  persistence: foundryDataEnvironmentPersistence({ scope: "workspace" }),
});
