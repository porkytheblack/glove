import type { Message, ModelAdapter, ModelPromptResult, PromptRequest } from "glove-core";

export type DemoRole = "interactor" | "coder" | "researcher";

/**
 * A scripted stand-in for each layer, used when no API key is set. It plays
 * one layered exchange: the user asks for code, the interactor finds the
 * coder on the mesh and sends it the work, the coder asks which language, the
 * interactor answers from what it remembers, and the reply comes back. Real
 * models replace it as soon as a key is set.
 */
export class DemoModel implements ModelAdapter {
  readonly name: string;
  constructor(private readonly role: DemoRole) {
    this.name = `demo-${role}`;
  }
  setSystemPrompt(): void {}

  async prompt(request: PromptRequest): Promise<ModelPromptResult> {
    // Runtime context (memory, open threads) rides at the tail; read past it.
    const last = [...request.messages].reverse().find((message) => !message.framework_context)!;
    if (last.tool_results?.length) return this.afterTool(JSON.stringify(last.tool_results[0]!.result));
    return this.role === "interactor"
      ? this.interactor(last.text)
      : this.role === "coder"
        ? this.coder(last.text)
        : say("Two sources agree: the release ships on Friday.");
  }

  private interactor(text: string): ModelPromptResult {
    if (text.startsWith("<mesh-message")) {
      const from = attribute(text, "from");
      if (text.includes('status="replied"')) return say(`Your code is ready. ${body(text)}`);
      if (text.includes('status="failed"')) return say(`The coder could not finish: ${body(text)}`);
      return call("glove_mesh_send_message", {
        to: from,
        in_reply_to: attribute(text, "id"),
        content: "TypeScript. They always want TypeScript.",
      });
    }
    if (/\b(write|build|code|script)\b/i.test(text)) {
      this.task = `The user asked: ${text}`;
      return call("glove_mesh_list_agents", {});
    }
    return say("Noted.");
  }

  private coder(text: string): ModelPromptResult {
    if (text.includes('from="') && !text.includes("TypeScript")) {
      return call("glove_mesh_send_message", {
        to: attribute(text, "from"),
        content: "Which language should the code be in?",
        blocking: true,
      });
    }
    return say("Wrote /out/slugify.ts in TypeScript, with three tests passing.");
  }

  private task = "";

  private afterTool(result: string): ModelPromptResult {
    if (this.role === "interactor") {
      const coder = /\{"id":"([^"]+)","name":"Coder"/.exec(result)?.[1];
      if (coder && this.task) {
        const task = this.task;
        this.task = "";
        return call("glove_mesh_send_message", { to: coder, content: task });
      }
      return say("On it. I've asked the coder; I'll tell you when it's done.");
    }
    const answer = /"reply":"([^"]*)"/.exec(result)?.[1];
    return say(answer ? `Wrote /out/slugify.ts in ${answer.split(".")[0]}, with three tests passing.` : "Waiting for an answer on the language.");
  }
}

function attribute(text: string, name: string): string {
  return new RegExp(`<mesh-message[^>]* ${name}="([^"]*)"`).exec(text)?.[1] ?? "";
}

function body(text: string): string {
  return /<mesh-message[^>]*>\n([\s\S]*?)\n<\/mesh-message>/.exec(text)?.[1] ?? "";
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
