import { join } from "node:path";
import { BrowserSessionManager } from "station-browser-use";
import { SteelBrowserAdapter } from "station-browser-use/steel";
import { ContainerSandboxAdapter } from "station-sandbox/container";
import { readState, writeState } from "./state.js";
import { root, secret, stateDir } from "./settings.js";

async function steel(path: string, body?: unknown) {
  const response = await fetch(`https://api.steel.dev/v1${path}`, {
    method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(60000),
    headers: { "steel-api-key": secret("STEEL_API_KEY"), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Steel request failed (${response.status}); inspect the provider before retrying.`); }
  return await response.json() as Record<string, unknown>;
}
async function personalProfile(): Promise<{ id: string; projectId: string }> {
  if (process.env.STEEL_PROFILE_ID) {
    if (!process.env.STEEL_PROJECT_ID) throw new Error("An existing STEEL_PROFILE_ID also requires its STEEL_PROJECT_ID.");
    return { id: process.env.STEEL_PROFILE_ID, projectId: process.env.STEEL_PROJECT_ID };
  }
  const saved = await readState<{ id: string; projectId?: string } | null>("profile.json", null);
  if (saved) {
    if (saved.projectId) return { id: saved.id, projectId: saved.projectId };
    const bootstrap = await readState<{ id: string } | null>("profile-bootstrap.json", null);
    if (!bootstrap) throw new Error("Set STEEL_PROJECT_ID for the retained profile.");
    const session = await steel(`/sessions/${encodeURIComponent(bootstrap.id)}`);
    if (typeof session.projectId !== "string") throw new Error("Steel did not return its project identifier.");
    const profile = { id: saved.id, projectId: session.projectId };
    await writeState("profile.json", profile); return profile;
  }
  const pending = await readState<{ id?: string; profileId?: string } | null>("profile-bootstrap.json", null);
  if (pending) throw new Error("A profile bootstrap is unresolved. Reconcile the session in Steel before clearing .operator/profile-bootstrap.json; do not create another blindly.");
  await writeState("profile-bootstrap.json", {});
  const session = await steel("/sessions", { persistProfile: true, timeout: 60000, useProxy: true, solveCaptcha: false });
  if (typeof session.id !== "string" || typeof session.profileId !== "string" || typeof session.projectId !== "string") throw new Error("Steel did not return a profile. Reconcile bootstrap state.");
  await writeState("profile-bootstrap.json", { id: session.id, profileId: session.profileId });
  await steel(`/sessions/${encodeURIComponent(session.id)}/release`, {});
  for (let attempt = 0; attempt < 30; attempt++) {
    const profile = await steel(`/profiles/${encodeURIComponent(session.profileId)}`);
    if (profile.status === "READY") {
      const saved = { id: session.profileId, projectId: session.projectId as string };
      await writeState("profile.json", saved);
      return saved;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("Steel profile is still uploading. Reconcile profile-bootstrap.json before restart.");
}
export async function createResources() {
  const profile = await personalProfile();
  const lifetime = Number(process.env.STEEL_SESSION_TIMEOUT_MS ?? 900000);
  const remote = new SteelBrowserAdapter({ apiKey: secret("STEEL_API_KEY"), projectId: profile.projectId, rootDir: join(stateDir, "steel", profile.projectId), profiles: { personal: profile.id }, sessionTimeoutMs: lifetime, timeoutMs: 60000, useProxy: true, solveCaptcha: false });
  // Known orphan IDs can be safely released. An uncertain create remains blocked.
  if (remote.pendingSessions().length) await remote.reconcile();
  const browser = new BrowserSessionManager(remote, 2, { idleTimeoutMs: 840000, stateRootDir: join(stateDir, "browser-state") });
  const sandbox = new ContainerSandboxAdapter({ rootDir: join(stateDir, "sandboxes"), image: process.env.SANDBOX_IMAGE ?? "node:22-bookworm-slim", seccompProfile: join(root, "vendor/moby/seccomp.json"), network: "bridge", memoryMb: 1024, cpus: 1, pidsLimit: 128, maxEnvironments: 2, maxServicesPerSandbox: 3, maxOutputBytes: 512 * 1024, enablePty: false });
  try {
    await sandbox.ready();
    let boxes = await sandbox.list();
    if (!boxes.length) boxes = [await sandbox.create()];
    await writeState("grants.json", { browserIds: [], sandboxIds: boxes.map(box => box.id) });
    return { browser, sandbox };
  } catch (error) {
    await Promise.allSettled([browser.close(), sandbox.close()]);
    throw error;
  }
}
