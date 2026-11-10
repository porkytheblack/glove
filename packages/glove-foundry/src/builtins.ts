/**
 * Which of Foundry's built-in tools a run gets.
 *
 * Every run gets every built-in unless its definition says otherwise with
 * `builtins`. A policy is an allow list, a block list or a filter, and is
 * resolved per run, so it can depend on the conversation. Names may end in
 * `*` to match a prefix (`glove_foundry_*`, `glove_mesh_*`).
 *
 * A built-in a run did not get is withheld, not refused: the model never sees
 * it. The controller also refuses any command from that run that only a
 * withheld tool could have sent.
 */
import type { FoundryCoreCommand } from "./core-tools.js";

/** What a built-in does, for filters that decide by kind rather than by name. */
export type FoundryBuiltinGroup =
  | "scheduling"
  | "spawning"
  | "transmission"
  | "conversations"
  | "workspace"
  | "environment"
  | "delegation"
  | "messaging"
  | "mesh";

export interface FoundryBuiltinTool {
  readonly name: string;
  readonly group: FoundryBuiltinGroup;
  /** Reads or writes data shared by the whole workspace (or every conversation of the instance). */
  readonly workspaceWide: boolean;
}

export const FOUNDRY_BUILTIN_TOOLS: ReadonlyArray<FoundryBuiltinTool> = Object.freeze([
  { name: "glove_foundry_spawn", group: "spawning", workspaceWide: true },
  { name: "glove_foundry_background", group: "spawning", workspaceWide: false },
  { name: "glove_foundry_schedule", group: "scheduling", workspaceWide: false },
  { name: "glove_foundry_schedules", group: "scheduling", workspaceWide: false },
  { name: "glove_foundry_sleep", group: "scheduling", workspaceWide: false },
  { name: "glove_foundry_transmit", group: "transmission", workspaceWide: false },
  { name: "glove_foundry_conversations", group: "conversations", workspaceWide: true },
  { name: "glove_foundry_workspace", group: "workspace", workspaceWide: true },
  { name: "glove_foundry_shared_inbox", group: "workspace", workspaceWide: true },
  { name: "glove_foundry_tasks", group: "workspace", workspaceWide: true },
  { name: "glove_foundry_environment", group: "environment", workspaceWide: false },
  { name: "glove_foundry_delegate", group: "delegation", workspaceWide: false },
  { name: "glove_foundry_reply", group: "delegation", workspaceWide: false },
  { name: "glove_foundry_ask", group: "delegation", workspaceWide: false },
  { name: "glove_foundry_message", group: "messaging", workspaceWide: false },
  { name: "glove_mesh_list_agents", group: "mesh", workspaceWide: false },
  { name: "glove_mesh_send_message", group: "mesh", workspaceWide: false },
  { name: "glove_mesh_broadcast", group: "mesh", workspaceWide: false },
  { name: "glove_mesh_acknowledge", group: "mesh", workspaceWide: false },
].map((tool) => Object.freeze(tool as FoundryBuiltinTool)));

const BY_NAME = new Map(FOUNDRY_BUILTIN_TOOLS.map((tool) => [tool.name, tool]));

export function isFoundryBuiltin(name: string): boolean {
  return BY_NAME.has(name);
}

/**
 * Which built-ins a run gets:
 *
 * - `["glove_foundry_schedule", "glove_mesh_*"]` or `{ allow: [...] }`: only
 *   these. A built-in added in a later release stays off.
 * - `{ block: [...] }`: every built-in but these. A later built-in is on.
 * - `{ filter: (tool) => boolean }`: decide per tool, by name, group, or
 *   whether it reaches workspace-wide data.
 *
 * Omitted, every built-in is on.
 */
export type FoundryBuiltinsPolicy =
  | ReadonlyArray<string>
  | { readonly allow: ReadonlyArray<string> }
  | { readonly block: ReadonlyArray<string> }
  | { readonly filter: (tool: FoundryBuiltinTool) => boolean };

function matcher(patterns: ReadonlyArray<string>): (name: string) => boolean {
  const exact = new Set(patterns.filter((pattern) => !pattern.endsWith("*")));
  const prefixes = patterns.filter((pattern) => pattern.endsWith("*")).map((pattern) => pattern.slice(0, -1));
  return (name) => exact.has(name) || prefixes.some((prefix) => name.startsWith(prefix));
}

/** Whether a built-in is on under this policy. Names that are not built-ins are always on. */
export function builtinAllowed(policy: FoundryBuiltinsPolicy | undefined): (name: string) => boolean {
  if (policy === undefined) return () => true;
  let decide: (tool: FoundryBuiltinTool) => boolean;
  const form = policy as { readonly allow?: ReadonlyArray<string>; readonly block?: ReadonlyArray<string>; readonly filter?: unknown };
  if (Array.isArray(policy)) {
    const allowed = matcher(policy as ReadonlyArray<string>);
    decide = (tool) => allowed(tool.name);
  } else if (Array.isArray(form.allow)) {
    const allowed = matcher(form.allow);
    decide = (tool) => allowed(tool.name);
  } else if (Array.isArray(form.block)) {
    const blocked = matcher(form.block);
    decide = (tool) => !blocked(tool.name);
  } else if (typeof form.filter === "function") {
    decide = form.filter as (tool: FoundryBuiltinTool) => boolean;
  } else {
    throw new Error("builtins must be a list of names, { allow }, { block } or { filter }.");
  }
  return (name) => {
    const tool = BY_NAME.get(name);
    return tool ? Boolean(decide(tool)) : true;
  };
}

/**
 * The built-ins that send a command of this type. `null` for commands Foundry
 * sends itself during assembly, which no policy withholds.
 */
export function builtinsForCommand(type: FoundryCoreCommand["type"] | string): ReadonlyArray<string> | null {
  switch (type) {
    case "spawn": return ["glove_foundry_spawn"];
    case "background": return ["glove_foundry_background"];
    case "schedule": return ["glove_foundry_schedule"];
    case "schedule.update":
    case "schedule.pause":
    case "schedule.resume":
    case "schedule.cancel": return ["glove_foundry_schedules"];
    case "sleep": return ["glove_foundry_sleep"];
    case "delegate": return ["glove_foundry_delegate"];
    case "delegate.reply": return ["glove_foundry_reply"];
    case "delegate.ask": return ["glove_foundry_ask"];
    case "agent.message": return ["glove_foundry_message"];
    case "mesh.list": return ["glove_mesh_list_agents", "glove_mesh_broadcast"];
    case "mesh.send": return ["glove_mesh_send_message", "glove_mesh_broadcast"];
    case "mesh.ack": return ["glove_mesh_acknowledge"];
    // Installed apps' own transmission tools send it too; see the runtime.
    case "transmit": return ["glove_foundry_transmit"];
    default: return null;
  }
}

/** The event a run emits with the built-ins it mounted, before any command. */
export const FOUNDRY_BUILTINS_MOUNTED_EVENT = "foundry.builtins.mounted";
