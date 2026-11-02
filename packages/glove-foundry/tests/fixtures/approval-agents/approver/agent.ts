import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { permissionKey, type Message, type PermissionStatus, type StoreAdapter, type TokenConsumptionCounter } from "glove-core";
import { z } from "zod";
import { defineAgent } from "../../../../src/index.js";
import { ScriptedModel } from "../../delegation-scripted.js";

interface Saved { messages: Message[]; permissions: Record<string, PermissionStatus>; tokens: number; turns: number }

/** Transcripts and permission decisions on disk, so a restarted runtime finds them. */
class FileStore implements StoreAdapter {
  readonly identifier: string;
  private readonly file: string;
  constructor(conversationId: string) {
    const directory = process.env.FOUNDRY_TEST_APPROVAL_DIR!;
    mkdirSync(directory, { recursive: true });
    this.identifier = conversationId;
    this.file = join(directory, `${Buffer.from(conversationId).toString("hex")}.json`);
  }
  private read(): Saved {
    try { return JSON.parse(readFileSync(this.file, "utf8")) as Saved; } catch { return { messages: [], permissions: {}, tokens: 0, turns: 0 }; }
  }
  private change(edit: (saved: Saved) => void): void {
    const saved = this.read();
    edit(saved);
    writeFileSync(this.file, JSON.stringify(saved));
  }
  async getMessages() { return this.read().messages; }
  async appendMessages(messages: Message[]) { this.change((saved) => { saved.messages.push(...messages); }); }
  async getTokenCount() { return this.read().tokens; }
  async addTokens(args: TokenConsumptionCounter) { this.change((saved) => { saved.tokens += args.tokens_in + args.tokens_out; }); }
  async getTurnCount() { return this.read().turns; }
  async incrementTurn() { this.change((saved) => { saved.turns++; }); }
  async resetCounters() { this.change((saved) => { saved.tokens = 0; saved.turns = 0; }); }
  async getPermission(toolName: string, input?: unknown) { return this.read().permissions[permissionKey(toolName, input)] ?? "unset"; }
  async setPermission(toolName: string, status: PermissionStatus, input?: unknown) {
    this.change((saved) => {
      const key = permissionKey(toolName, input);
      if (status === "unset") delete saved.permissions[key];
      else saved.permissions[key] = status;
    });
  }
}

const note = { to: "lena", note: "8 works" };

export default defineAgent({
  description: "Sends a note once someone approves it",
  store: ({ conversationId }) => new FileStore(conversationId),
  tools: [{
    name: "send_note",
    description: "Send a note",
    inputSchema: z.object({ to: z.string(), note: z.string() }),
    requiresPermission: true,
    async do(input: { readonly to: string; readonly note: string }) {
      appendFileSync(process.env.FOUNDRY_TEST_APPROVAL_LOG!, `${JSON.stringify(input)}\n`);
      return { status: "success" as const, data: "delivered" };
    },
  }],
  // "send" asks to send the note. A decision that reaches a conversation that
  // moved on reads as an event: approved, it sends again; denied, it lets go.
  model: () => new ScriptedModel(
    (last) => last.includes("denied your earlier request") ? { say: "understood: not sending" }
      : last.includes("approved your earlier request") || last.includes("send") ? { call: "send_note", input: note }
      : { say: `ok: ${last}` },
    (result) => `sent: ${(JSON.parse(result) as { status: string }).status}`,
  ),
  systemPrompt: "Fixture approver",
});
