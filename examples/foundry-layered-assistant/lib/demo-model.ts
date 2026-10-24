import type { Message, ModelAdapter, ModelPromptResult, PromptRequest } from "glove-core";

export type DemoRole = "interactor" | "coder" | "researcher";

/**
 * A scripted stand-in for each layer, used when no API key is set. It plays
 * one layered exchange: the user asks for code, the interactor delegates, the
 * coder asks which language, the interactor answers from what it remembers,
 * and the result comes back. Real models replace it as soon as a key is set.
 */
export class DemoModel implements ModelAdapter {
  readonly name: string;
  constructor(private readonly role: DemoRole) {
    this.name = `demo-${role}`;
  }
  setSystemPrompt(): void {}

  async prompt(request: PromptRequest): Promise<ModelPromptResult> {
    // Runtime context (memory, open delegations) rides at the tail; read past it.
    const last = [...request.messages].reverse().find((message) => !message.framework_context)!;
    if (last.tool_results?.length) return say(this.afterTool(JSON.stringify(last.tool_results[0]!.result)));
    return this.role === "interactor"
      ? this.interactor(last.text)
      : this.role === "coder"
        ? this.coder(last.text)
        : say("Two sources agree: the release ships on Friday.");
  }

  private interactor(text: string): ModelPromptResult {
    const id = /id="(delegation_[^"]+)"/.exec(text)?.[1];
    if (id && text.includes('status="question"')) {
      return call("glove_foundry_reply", { delegationId: id, message: "TypeScript. They always want TypeScript." });
    }
    if (id && text.includes('status="completed"')) {
      const result = /Result:\n([\s\S]*?)\n<\/delegation>/.exec(text)?.[1] ?? "";
      return say(`Your code is ready. ${result}`);
    }
    if (/\b(write|build|code|script)\b/i.test(text)) {
      return call("glove_foundry_delegate", { to: "coder", task: `The user asked: ${text}` });
    }
    return say("Noted.");
  }

  private coder(text: string): ModelPromptResult {
    if (text.includes("<delegation-reply")) return say("Wrote /out/slugify.ts in TypeScript, with three tests passing.");
    return call("glove_foundry_ask", { question: "Which language should the code be in?" });
  }

  private afterTool(result: string): string {
    if (this.role === "interactor") return "On it. I've asked the coder; I'll tell you when it's done.";
    const answer = /"answer":"([^"]*)"/.exec(result)?.[1];
    return answer ? `Wrote /out/slugify.ts in ${answer.split(".")[0]}, with three tests passing.` : "Waiting for an answer on the language.";
  }
}

function reply(message: Message): ModelPromptResult {
  return { messages: [message], tokens_in: 1, tokens_out: 1 };
}

function say(text: string): ModelPromptResult {
  return reply({ sender: "agent", text });
}

function call(tool: string, input: Record<string, unknown>): ModelPromptResult {
  return reply({ sender: "agent", text: "", tool_calls: [{ tool_name: tool, input_args: input, id: `${tool}-${Date.now()}` }] });
}
