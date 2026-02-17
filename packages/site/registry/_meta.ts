import type { ReactNode } from "react";

// ─── Taxonomy ────────────────────────────────────────────────────────────────

export type ToolCategory = "input" | "confirmation" | "display" | "navigation";
export type ToolPattern = "pushAndWait" | "pushAndForget";

// ─── Metadata (serialisable — safe for RSC) ──────────────────────────────────

export interface ToolMeta {
  slug: string;
  name: string;
  category: ToolCategory;
  pattern: ToolPattern;
  description: string;
}

// ─── Full entry (includes render — client only) ──────────────────────────────

export interface ToolEntry extends ToolMeta {
  preview: { data: Record<string, unknown> };
  source: string;
  render: (props: {
    data: Record<string, unknown>;
    resolve: (value: unknown) => void;
  }) => ReactNode;
}

// ─── Static imports ──────────────────────────────────────────────────────────

import * as askPreference from "./ask-preference";
import * as textInput from "./text-input";
import * as collectForm from "./collect-form";
import * as confirmAction from "./confirm-action";
import * as approvePlan from "./approve-plan";
import * as showInfoCard from "./show-info-card";
import * as suggestOptions from "./suggest-options";

// ─── Module shape exported by each registry file ─────────────────────────────

interface ToolModule {
  meta: ToolMeta;
  preview: { data: Record<string, unknown> };
  source: string;
  render: (props: {
    data: Record<string, unknown>;
    resolve: (value: unknown) => void;
  }) => ReactNode;
}

const modules: ToolModule[] = [
  askPreference,
  textInput,
  collectForm,
  confirmAction,
  approvePlan,
  showInfoCard,
  suggestOptions,
];

function toEntry(m: ToolModule): ToolEntry {
  return {
    slug: m.meta.slug,
    name: m.meta.name,
    category: m.meta.category,
    pattern: m.meta.pattern,
    description: m.meta.description,
    preview: m.preview,
    source: m.source,
    render: m.render,
  };
}

const _allTools: ToolEntry[] = modules.map(toEntry);

export function getAllTools(): ToolEntry[] {
  return _allTools;
}

export function getToolBySlug(slug: string): ToolEntry | undefined {
  return _allTools.find((t) => t.slug === slug);
}
