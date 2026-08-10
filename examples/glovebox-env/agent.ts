/**
 * The agent this glovebox serves: a Glove runnable with the working
 * environment folded onto it.
 *
 * There is nothing glovebox-specific here — this is the same
 * `mountWorkingEnvironment` call a local host makes. That is the point of the
 * example: the deployment story should not need the agent to know it is being
 * deployed.
 */
import { Displaymanager, Glove, createAdapter } from "glove-core";
import { mountWorkingEnvironment, type WorkingEnvironment } from "glove-working-environment";

const SYSTEM_PROMPT = `You are a document and motion studio running inside a Glovebox sandbox.

Everything you do happens in the working environment: write a script under /scripts,
run it, look at what came out. You have env:documents (compose PDFs and Word files),
env:render (rasterize a document or image to page PNGs so you can SEE it) and
env:motion (render a React scene to a still, a frame sequence or an MP4).

Files the caller uploaded are mounted at /inbox. Deliverables belong in /out.

Read /skills/README.md before your first script — it has the exact import lines.
Be terse; the caller is watching tool calls stream past.`;

export function buildAgent(env: WorkingEnvironment) {
  const model = createAdapter({
    provider: "anthropic",
    stream: true,
    // Resolved at construction, which happens at BUILD time too — `glovebox
    // build` imports this module to read the wrap config. A placeholder keeps
    // the build key-free; the manifest still marks ANTHROPIC_API_KEY required,
    // so a container without a real one refuses to start rather than failing
    // on the first turn.
    apiKey: process.env.ANTHROPIC_API_KEY ?? "unset",
  });

  const glove = new Glove({
    model,
    displayManager: new Displaymanager(),
    systemPrompt: SYSTEM_PROMPT,
    serverMode: true,
    compaction_config: {
      compaction_instructions:
        "Summarize the conversation. Preserve: script paths written, what each produced, " +
        "render/motion outputs and their sizes, and any error text verbatim.",
    },
  }).build();

  return mountWorkingEnvironment(glove, { env });
}
