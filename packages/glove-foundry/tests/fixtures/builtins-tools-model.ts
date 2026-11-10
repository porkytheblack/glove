import { appendFileSync } from "node:fs";
import type { ModelAdapter, ModelPromptResult, PromptRequest } from "glove-core";

/** Writes the tool names each request offered the model, then answers. */
export class ToolListingModel implements ModelAdapter {
  readonly name = "builtins-fixture";
  constructor(private readonly agent: string) {}
  setSystemPrompt(): void {}
  async prompt(request: PromptRequest): Promise<ModelPromptResult> {
    const file = process.env.FOUNDRY_TEST_BUILTINS_LOG;
    const tools = (request.tools ?? []).map((tool) => tool.name).sort();
    if (file) appendFileSync(file, `${JSON.stringify({ agent: this.agent, tools })}\n`);
    return { messages: [{ sender: "agent", text: "ok" }], tokens_in: 1, tokens_out: 1 };
  }
}
