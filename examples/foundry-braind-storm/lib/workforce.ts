import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Displaymanager,
  Glove,
  MemoryStore,
  createAdapter,
  type ContentPart,
  type IGloveRunnable,
  type Message,
  type ModelAdapter,
  type ModelPromptResult,
} from "glove-core";
import { documents } from "glove-env-documents";
import { images } from "glove-env-images";
import { geminiImages } from "glove-image/gemini";
import { InMemoryImageAssetStore, InMemoryImageLibrary, mountImage } from "glove-image";
import { InMemoryMeshAdapter, MeshNetwork, mountMesh } from "glove-mesh";
import {
  createWorkingEnvironment,
  hostDirectory,
  mountWorkingEnvironment,
  type WorkingEnvironment,
} from "glove-working-environment";
import { Cause, Effect, Exit } from "effect";
import { ROLES, type SpecialistId } from "../agents/_shared/roles.js";
import type { StormActivity, StormArtifact, StormResult, StormTelemetry } from "./protocol.js";
import { loadSkillSet, skillAdapter, type SkillSourceAdapter } from "./skill-source.js";
import { normalizeStormId } from "./storm-id.js";
import {
  abortableDelay,
  fileProviderGate,
  isRetryableProviderError,
  providerErrorMessage,
  providerErrorStatus,
  providerRetryDelayMs,
  type ProviderGate,
} from "./provider-pressure.js";

const here = dirname(fileURLToPath(import.meta.url));
const exampleRoot = resolve(here, "..");

export interface StormInput {
  brief: string;
  stormId: string;
  skillPacks: readonly string[];
  generateImage?: boolean;
  remoteSkills?: boolean;
  transcript?: readonly { role: "user" | "assistant"; text: string }[];
}

export interface StormRuntimeOptions {
  signal?: AbortSignal;
  source?: SkillSourceAdapter;
  onEvent?: (event: StormActivity) => void;
  onTelemetry?: (event: StormTelemetry) => void;
  /** Host-owned admission policy shared by text and image provider calls. */
  providerGate?: ProviderGate;
}

type TelemetryInput = Omit<StormTelemetry, "at">;

function emitTelemetry(options: StormRuntimeOptions, event: TelemetryInput): void {
  options.onTelemetry?.({ at: new Date().toISOString(), ...event });
}

function outcomePreview(value: string): string {
  return value.replace(/[#*_`>\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 280);
}

function asError(cause: unknown): Error {
  let current: unknown = cause;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const nested = (current as { error?: unknown; cause?: unknown }).error
      ?? (current as { cause?: unknown }).cause;
    if (!nested) break;
    current = nested;
  }
  return current instanceof Error ? current : new Error(String(current));
}

function responseText(value: Message | ModelPromptResult): string {
  const message = "messages" in value ? value.messages.at(-1) : value;
  return message?.text?.trim() || "No written response was produced.";
}

export function createBraindTextAdapter(model = process.env.BRAIND_TEXT_MODEL ?? "gemini-3.5-flash-lite"): ModelAdapter {
  return createAdapter({
    provider: "gemini",
    model,
    apiKey: process.env.GEMINI_API_KEY,
    stream: false,
    maxTokens: 12_000,
    reasoningEffort: "low",
  });
}

function reserveTextModels(primaryName: string): string[] {
  const primaryModel = primaryName.split(":").slice(1).join(":");
  return (process.env.BRAIND_TEXT_FALLBACK_MODELS ?? "gemini-3.1-flash-lite")
    .split(",")
    .map((model) => model.trim())
    .filter((model, index, models) => model.length > 0 && model !== primaryModel && models.indexOf(model) === index);
}

async function promptWithoutToolSurface(
  agent: IGloveRunnable,
  text: string,
  signal?: AbortSignal,
  content?: ContentPart[],
  telemetry?: {
    options: StormRuntimeOptions;
    agent: StormTelemetry["agent"];
    step: string;
    title: string;
    detail: string;
    progress: number;
    /** Promotes a healthy reserve across every text agent in this workforce run. */
    activateModel?: (model: string) => void;
  },
): Promise<string> {
  const inbox = await agent.store.getResolvedInboxItems?.() ?? [];
  const handoffs = inbox.length
    ? `\n\nResolved mesh handoffs:\n${inbox.map((item) => `- ${item.request}\n  ${item.response ?? ""}`).join("\n")}`
    : "";
  const gate = telemetry?.options.providerGate ?? defaultProviderGate;
  const maxAttempts = readBoundedInteger(process.env.BRAIND_MODEL_MAX_ATTEMPTS, 5, 1, 8);
  const reserveModels = reserveTextModels(agent.model.name);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (telemetry) {
        emitTelemetry(telemetry.options, {
          kind: "model",
          status: "active",
          step: telemetry.step,
          title: telemetry.title,
          detail: attempt === 0 ? telemetry.detail : `Retrying model work after a transient provider response (attempt ${attempt + 1}).`,
          agent: telemetry.agent,
          progress: telemetry.progress,
          attempt: attempt + 1,
        });
      }
      const result = await gate.run(() => agent.model.prompt({
          messages: [{ sender: "user", text: `${text}${handoffs}`, ...(content ? { content } : {}) }],
          tools: [],
        }, async () => {}, signal), {
        signal,
        onQueued: ({ waitedMs }) => {
          if (!telemetry) return;
          emitTelemetry(telemetry.options, {
            kind: "model",
            status: "queued",
            step: telemetry.step,
            title: `${telemetry.title} is waiting for provider capacity`,
            detail: `Foundry is pacing Gemini requests across active campaigns. This pass has waited ${Math.max(1, Math.round(waitedMs / 1_000))}s; completed workspace artifacts remain safe.`,
            agent: telemetry.agent,
            progress: telemetry.progress,
            attempt: attempt + 1,
          });
        },
      });
      const visible = responseText(result);
      if (visible !== "No written response was produced.") {
        if (telemetry) {
          emitTelemetry(telemetry.options, {
            kind: "model",
            status: "complete",
            step: telemetry.step,
            title: `${telemetry.title} landed`,
            detail: outcomePreview(visible),
            agent: telemetry.agent,
            progress: telemetry.progress,
            attempt: attempt + 1,
          });
        }
        return visible;
      }
      throw new Error("The model completed without visible output.");
    } catch (cause) {
      if (signal?.aborted || !isRetryableProviderError(cause)) throw cause;
      if (attempt === maxAttempts - 1) {
        if (telemetry) {
          emitTelemetry(telemetry.options, {
            kind: "model",
            status: "error",
            step: telemetry.step,
            title: `${telemetry.title} could not clear provider pressure`,
            detail: `Gemini did not accept the pass after ${maxAttempts} attempts. Completed artifacts remain in the workspace. ${providerErrorMessage(cause)}`,
            agent: telemetry.agent,
            progress: telemetry.progress,
            attempt: attempt + 1,
          });
        }
        throw cause;
      }
      const delayMs = providerRetryDelayMs(cause, attempt + 1);
      const status = providerErrorStatus(cause);
      const reserveModel = status === 429 ? reserveModels.shift() : undefined;
      if (reserveModel) {
        if (telemetry?.activateModel) telemetry.activateModel(reserveModel);
        else agent.setModel(createBraindTextAdapter(reserveModel));
      }
      if (telemetry) {
        emitTelemetry(telemetry.options, {
          kind: "model",
          status: "warning",
          step: telemetry.step,
          title: `${telemetry.title} paused`,
          detail: status === 429
            ? `Gemini rate-limited this pass. Retry ${attempt + 2} of ${maxAttempts} is scheduled in ${Math.ceil(delayMs / 1_000)}s${reserveModel ? ` on reserve model ${reserveModel}` : ""}; completed workspace artifacts remain safe.`
            : `A transient provider response interrupted this pass. Retry ${attempt + 2} of ${maxAttempts} is scheduled in ${Math.ceil(delayMs / 1_000)}s.`,
          agent: telemetry.agent,
          progress: telemetry.progress,
          attempt: attempt + 1,
        });
      }
      await abortableDelay(delayMs, signal);
    }
  }
  throw new Error("Model retry policy exhausted.");
}

function readBoundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

const defaultProviderGate = fileProviderGate({
  name: "gemini",
  lockPath: resolve(exampleRoot, ".braind-storm", "provider-gates", "gemini.lock"),
  minimumIntervalMs: readBoundedInteger(process.env.BRAIND_GEMINI_MIN_INTERVAL_MS, 8_000, 0, 60_000),
  staleAfterMs: readBoundedInteger(process.env.BRAIND_GEMINI_STALE_LEASE_MS, 330_000, 30_000, 600_000),
});

function specialist(id: SpecialistId): IGloveRunnable {
  const profile = ROLES[id];
  return new Glove({
    store: new MemoryStore(`braind:${id}:${Date.now()}`),
    model: createBraindTextAdapter(),
    displayManager: new Displaymanager(),
    systemPrompt: [
      `You are ${profile.name}, Braind Storm's ${profile.role}.`,
      profile.prompt,
      "You work as a peer in an agent mesh. Read resolved inbox handoffs and the shared workspace before answering.",
      "Return decision-ready Markdown. Cite shared files by their /out path. Never claim evidence that is not present.",
    ].join("\n"),
    serverMode: true,
    compaction_config: { compaction_instructions: "Retain decisions, evidence, dissent, and shared artifact paths." },
  }).build();
}

async function sendHandoff(
  adapter: InMemoryMeshAdapter,
  from: string,
  to: string,
  content: string,
  activity: StormActivity[],
  options: StormRuntimeOptions,
  artifact?: string,
): Promise<void> {
  const event = { at: new Date().toISOString(), from, to, label: content, ...(artifact ? { artifact } : {}) };
  activity.push(event);
  options.onEvent?.(event);
  emitTelemetry(options, {
    kind: "mesh",
    status: "complete",
    step: `${from}-to-${to}`,
    title: `${from} handed work to ${to}`,
    detail: content,
    agent: from as StormTelemetry["agent"],
    peer: to as StormTelemetry["agent"],
    ...(artifact ? { artifact } : {}),
  });
  await adapter.send({
    id: `mesh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    from,
    to,
    content: artifact ? `${content}\nShared artifact: ${artifact}` : content,
    created_at: new Date().toISOString(),
    metadata: { storm: true, artifact },
  });
}

async function writeDoc(env: WorkingEnvironment, path: string, content: string): Promise<void> {
  await env.fs.writeFile(path, content.endsWith("\n") ? content : `${content}\n`);
}

async function createWordBrief(env: WorkingEnvironment, title: string, sections: Array<{ heading: string; text: string }>) {
  const source = `import { docx } from 'env:documents';\nexport default async function main() {\n  return docx.create('/out/brand-system.docx', ${JSON.stringify({
    title,
    author: "Braind Storm",
    content: sections.flatMap((section) => [{ heading: section.heading, level: 1 }, { text: section.text }]),
  })});\n}`;
  await env.fs.writeFile("/scripts/build-brand-system.js", source);
  const result = await env.runScript("/scripts/build-brand-system.js");
  if (!result.ok) throw new Error(result.error ?? "Could not create the Word brand system.");
}

export async function runStorm(
  lead: IGloveRunnable,
  input: StormInput,
  options: StormRuntimeOptions = {},
): Promise<StormResult> {
  emitTelemetry(options, {
    kind: "storm",
    status: "active",
    step: "convene",
    title: "Opening the weather room",
    detail: "Mara is loading the storm workspace, selected skill methods, and the five-agent mesh for this brief.",
    agent: "lead",
    progress: 3,
  });
  const exit = await Effect.runPromiseExit(Effect.gen(function* () {
    const stormId = normalizeStormId(input.stormId);
    const workspaceDir = resolve(exampleRoot, ".braind-storm", "workspaces", stormId);
    yield* Effect.tryPromise({ try: () => mkdir(workspaceDir, { recursive: true }), catch: asError });
    const skills = yield* Effect.tryPromise({ try: () => loadSkillSet(input.skillPacks, {
      source: options.source,
      signal: options.signal,
      remote: input.remoteSkills,
    }), catch: asError });
    const disk = hostDirectory(workspaceDir);
    const env = yield* Effect.tryPromise({ try: () => createWorkingEnvironment({
      filesystem: disk,
      stdlib: [documents(), images(), skillAdapter(skills)],
      limits: { runTimeoutMs: 60_000, maxVfsBytes: 192 * 1024 * 1024 },
      execution: { prewarm: true, onWarning: () => {} },
    }), catch: asError });
    emitTelemetry(options, {
      kind: "tool",
      status: "complete",
      step: "workspace",
      title: "Shared working environment mounted",
      detail: `${skills.length} skill method${skills.length === 1 ? "" : "s"} loaded. Documents, images, and the shared /inbox and /out filesystem are ready.`,
      agent: "lead",
      progress: 8,
    });

    const network = new MeshNetwork();
    const agents = Object.fromEntries((Object.keys(ROLES) as SpecialistId[]).map((id) => [id, specialist(id)])) as Record<SpecialistId, IGloveRunnable>;
    const activateWorkforceTextModel = (model: string) => {
      for (const agent of [lead, ...Object.values(agents)]) agent.setModel(createBraindTextAdapter(model));
    };
    const adapters = {} as Record<SpecialistId | "lead", InMemoryMeshAdapter>;
    const activity: StormActivity[] = [];
    let generatedImage: Uint8Array | undefined;
    let imageGenerationNote: string | undefined;

    const program = Effect.tryPromise({ try: async () => {
      const voicePaths = (await env.fs.glob("/inbox/voice/*.md")).sort().slice(-10);
      const voiceDirections = (await Promise.all(voicePaths.map(async (path) =>
        `--- ${path} ---\n${(await env.fs.readFile(path)).slice(0, 4_000)}`
      ))).join("\n\n");
      const directionContext = voiceDirections
        ? `\n\nThe caller left durable direction on Mara's live briefing line. Treat it as current first-party input, resolve it against the brief, and preserve any explicit constraints:\n\n${voiceDirections}`
        : "";
      await writeDoc(env, "/inbox/brief.md", `# Incoming brief\n\n${input.brief}`);
      await writeDoc(env, "/inbox/conversation.md", (input.transcript ?? []).map((item) => `**${item.role}:** ${item.text}`).join("\n\n") || "No prior conversation.");
      mountWorkingEnvironment(lead, { env, prime: false });
      for (const agent of Object.values(agents)) mountWorkingEnvironment(agent, { env, prime: false });

      adapters.lead = new InMemoryMeshAdapter(network, "lead");
      await mountMesh(lead, { adapter: adapters.lead, identity: { id: "lead", name: "Mara Vale", description: "Brand lead and public interface", capabilities: ["synthesis", "creative direction"] } });
      for (const id of Object.keys(ROLES) as SpecialistId[]) {
        adapters[id] = new InMemoryMeshAdapter(network, id);
        const role = ROLES[id];
        await mountMesh(agents[id], { adapter: adapters[id], identity: { id, name: role.name, description: role.role, capabilities: [...role.capabilities] } });
      }
      emitTelemetry(options, {
        kind: "storm",
        status: "complete",
        step: "convene",
        title: "Five minds are in the room",
        detail: "The peer mesh is registered. Each specialist has an inbox-capable store and the same shared working environment.",
        agent: "lead",
        progress: 12,
      });

      const imageAdapter = geminiImages({ apiKey: process.env.GEMINI_API_KEY, model: process.env.BRAIND_IMAGE_MODEL });
      await mountImage(agents.maker, {
        adapter: imageAdapter,
        assets: new InMemoryImageAssetStore(),
        library: new InMemoryImageLibrary(),
        model: agents.maker.model,
        curate: false,
      });

      await sendHandoff(adapters.lead, "lead", "scout", "Open the brief. Find the market and culture signals that should shape this brand.", activity, options, "/inbox/brief.md");
      const research = await promptWithoutToolSurface(agents.scout, `The shared workspace contains /inbox/brief.md. Its content is below. Use the working methods mounted under /skills and deliver your research signal brief.\n\n--- /inbox/brief.md ---\n${input.brief}${directionContext}`, options.signal, undefined, {
        options, agent: "scout", step: "sense", title: "Iris is reading the signal field",
        detail: "Looking for category conventions, audience tensions, cultural signals, and evidence that can change the direction—not decorating the brief.", progress: 22,
        activateModel: activateWorkforceTextModel,
      });
      await writeDoc(env, "/out/01-research-signals.md", research);
      emitTelemetry(options, { kind: "artifact", status: "complete", step: "sense", title: "Research signal brief committed", detail: "Iris put the evidence and tensions into the shared workspace for the strategist.", agent: "scout", artifact: "/out/01-research-signals.md", progress: 28 });

      await sendHandoff(adapters.scout, "scout", "strategist", "Signals are ready. Convert the most defensible tension into a positioning and go-to-market choice.", activity, options, "/out/01-research-signals.md");
      const strategy = await promptWithoutToolSurface(agents.strategist, `Use the mesh handoff and shared artifact path to write the positioning and GTM architecture.\n\n--- /inbox/brief.md ---\n${input.brief}${directionContext}\n\n--- /out/01-research-signals.md ---\n${research}`, options.signal, undefined, {
        options, agent: "strategist", step: "shape", title: "Theo is choosing the strategic tension",
        detail: "Converting evidence into a defensible position, category choice, audience promise, and sequenced route to market.", progress: 38,
        activateModel: activateWorkforceTextModel,
      });
      await writeDoc(env, "/out/02-positioning-gtm.md", strategy);
      emitTelemetry(options, { kind: "artifact", status: "complete", step: "shape", title: "Positioning and GTM committed", detail: "Theo made the commercial choice explicit and passed a usable architecture into the creative phase.", agent: "strategist", artifact: "/out/02-positioning-gtm.md", progress: 45 });

      await sendHandoff(adapters.strategist, "strategist", "maker", "Strategy is ready. Build distinct creative territories and a production-ready key-art direction.", activity, options, "/out/02-positioning-gtm.md");
      const creative = await promptWithoutToolSurface(agents.maker, `Read the shared artifacts below. Produce the chosen creative territory and key-art prompt. Do not generate the image yet; the Glove Image pipeline runs after your direction is committed.\n\n--- /inbox/brief.md ---\n${input.brief}${directionContext}\n\n--- /out/01-research-signals.md ---\n${research}\n\n--- /out/02-positioning-gtm.md ---\n${strategy}`, options.signal, undefined, {
        options, agent: "maker", step: "make", title: "Noor is building the brand world",
        detail: "Turning the strategic choice into a distinctive creative territory, verbal behavior, visual grammar, and a production-ready key-art direction.", progress: 55,
        activateModel: activateWorkforceTextModel,
      });
      await writeDoc(env, "/out/03-creative-direction.md", creative);
      emitTelemetry(options, { kind: "artifact", status: "complete", step: "make", title: "Creative direction committed", detail: "Noor locked the chosen territory before image generation so the visual is accountable to the strategy.", agent: "maker", artifact: "/out/03-creative-direction.md", progress: 61 });

      if (input.generateImage !== false && process.env.GEMINI_API_KEY) {
        try {
          emitTelemetry(options, { kind: "tool", status: "active", step: "render", title: "Glove Image is rendering key art", detail: "Gemini Image is producing one hero visual from Noor's committed direction, with negative space and no fabricated logo system.", agent: "maker", progress: 65 });
          const image = await (options.providerGate ?? defaultProviderGate).run(() => imageAdapter.generate({
              prompt: `Create the singular hero image for this brand direction. It must work as launch key art, contain no small text, no logos, and leave intentional negative space for a headline.\n\n${creative.slice(0, 12_000)}`,
              refs: [],
              size: "1600x900",
              candidates: 1,
            }, options.signal), {
            signal: options.signal,
            onQueued: ({ waitedMs }) => emitTelemetry(options, {
              kind: "tool", status: "queued", step: "render", title: "Key art is waiting for provider capacity",
              detail: `Foundry is pacing Gemini requests across active campaigns. The render has waited ${Math.max(1, Math.round(waitedMs / 1_000))}s.`, agent: "maker", progress: 65,
            }),
          });
          generatedImage = image.images[0]?.bytes;
          if (generatedImage) await env.fs.writeFile("/out/04-key-art.png", generatedImage);
          emitTelemetry(options, { kind: "tool", status: "complete", step: "render", title: "Key art rendered", detail: "The generated visual is now in the shared workspace and will be inspected by Vera as image input.", agent: "maker", artifact: "/out/04-key-art.png", progress: 71 });
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : String(cause);
          imageGenerationNote = `# Key art was not rendered\n\nNoor's production-ready visual direction remains in /out/03-creative-direction.md. The configured image adapter could not render this run. The host can retry after changing its model, quota, or billing configuration.\n\nProvider response: ${detail.slice(0, 900)}`;
          await writeDoc(env, "/out/04-image-generation-note.md", imageGenerationNote);
          emitTelemetry(options, { kind: "tool", status: "warning", step: "render", title: "Key art render deferred", detail: "The image adapter could not complete this pass. The written art direction remains production-ready and the provider note is preserved.", agent: "maker", artifact: "/out/04-image-generation-note.md", progress: 71 });
        }
      }

      await sendHandoff(adapters.maker, "maker", "critic", "Creative direction is ready. Review the entire chain and the generated key art when present.", activity, options, generatedImage ? "/out/04-key-art.png" : "/out/03-creative-direction.md");
      const critiquePrompt = `Pressure-test the strategy and creative system in the shared artifacts below. If an image is attached, inspect what is actually visible and include a specific visual verdict.\n\n--- /out/01-research-signals.md ---\n${research}\n\n--- /out/02-positioning-gtm.md ---\n${strategy}\n\n--- /out/03-creative-direction.md ---\n${creative}`;
      const criticInput: ContentPart[] = [{ type: "text", text: critiquePrompt }];
      if (generatedImage) criticInput.push({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(generatedImage).toString("base64") } });
      const review = await promptWithoutToolSurface(agents.critic, critiquePrompt, options.signal, criticInput, {
        options, agent: "critic", step: "pressure-test", title: "Vera is pressure-testing the chain",
        detail: generatedImage ? "Inspecting the visible key art against the brief, research, positioning, and creative promise; separating taste from strategic failure." : "Reviewing the evidence-to-strategy-to-creative chain and identifying where the direction becomes generic, unsupported, or hard to execute.", progress: 78,
        activateModel: activateWorkforceTextModel,
      });
      await writeDoc(env, "/out/05-creative-review.md", review);
      emitTelemetry(options, { kind: "artifact", status: "complete", step: "pressure-test", title: "Independent review committed", detail: "Vera's verdict and material dissent are in the workspace for Mara's final decision.", agent: "critic", artifact: "/out/05-creative-review.md", progress: 84 });

      await sendHandoff(adapters.critic, "critic", "lead", "Pressure test complete. Synthesize a clear recommendation, preserve material dissent, and give the next decision.", activity, options, "/out/05-creative-review.md");
      const synthesis = await promptWithoutToolSurface(lead, `You are speaking to the user as Mara Vale, the lead. Their brief was:\n${input.brief}${directionContext}\n\nThe shared artifact contents follow. Reply with: the central brand idea, why it can win, the chosen territory, the GTM sequence, what the critic changed, and the single next decision. Be direct and conversational; the files are available separately. Explicitly account for any direction left on the live briefing line.\n\n--- /out/01-research-signals.md ---\n${research}\n\n--- /out/02-positioning-gtm.md ---\n${strategy}\n\n--- /out/03-creative-direction.md ---\n${creative}\n\n--- /out/05-creative-review.md ---\n${review}`, options.signal, undefined, {
        options, agent: "lead", step: "decide", title: "Mara is making the call",
        detail: "Reconciling the specialist work without averaging it: preserving useful dissent, choosing the central idea, and identifying the next decision for you.", progress: 91,
        activateModel: activateWorkforceTextModel,
      });
      await writeDoc(env, "/out/00-lead-recommendation.md", synthesis);
      await createWordBrief(env, "Braind Storm — Brand System", [
        { heading: "Lead recommendation", text: synthesis },
        { heading: "Research signals", text: research },
        { heading: "Positioning and go-to-market", text: strategy },
        { heading: "Creative direction", text: creative },
        { heading: "Creative review", text: review },
      ]);
      emitTelemetry(options, { kind: "tool", status: "complete", step: "package", title: "Brand system packaged", detail: "The recommendation and every specialist contribution have been assembled into a shareable Word document.", agent: "lead", artifact: "/out/brand-system.docx", progress: 96 });
      await disk.commit();

      const exported = await env.export("/out/**");
      const artifacts: StormArtifact[] = exported
        .filter((file) => !file.path.endsWith("/"))
        .map((file) => ({
          path: file.path,
          name: file.path.split("/").at(-1) ?? file.path,
          kind: /\.(png|jpe?g|webp)$/i.test(file.path) ? "image" : "document",
          size: file.bytes.byteLength,
          href: `/api/artifacts?storm=${encodeURIComponent(stormId)}&path=${encodeURIComponent(file.path)}`,
        }));
      emitTelemetry(options, { kind: "storm", status: "complete", step: "complete", title: "The point of view has landed", detail: `${artifacts.length} shared artifacts are ready. Mara has returned with the central brand idea and the next decision.`, agent: "lead", progress: 100 });
      return { stormId, reply: synthesis, artifacts, activity, skills: skills.map((skill) => skill.name), imageGenerated: Boolean(generatedImage) } satisfies StormResult;
    }, catch: asError });

    return yield* program.pipe(Effect.ensuring(Effect.promise(async () => {
      for (const adapter of Object.values(adapters)) await adapter?.unregister().catch(() => {});
      await env.close().catch(() => {});
    })));
  }));
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.squash(exit.cause);
  emitTelemetry(options, {
    kind: "storm",
    status: "error",
    step: "failed",
    title: "The storm lost pressure",
    detail: failure instanceof Error ? failure.message : String(failure),
    agent: "lead",
  });
  throw failure;
}
