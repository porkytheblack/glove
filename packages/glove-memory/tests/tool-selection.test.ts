/** Allowlisting / denylisting the folded memory tool surface. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MemorySchema } from "../src/core/schema";
import { MemoryToolSelectionError } from "../src/core/errors";
import { InMemoryContextAdapter } from "../src/in-memory/context";
import { InMemoryEntityAdapter } from "../src/in-memory/entity";
import { InMemoryEpisodicAdapter } from "../src/in-memory/episodic";
import { InMemoryResourcesAdapter } from "../src/in-memory/resources";
import { selectTools } from "../src/tools/selection";
import {
  useContext,
  useEpisodicCurator,
  useMemoryCurator,
  useResourcesCurator,
} from "../src/tools/index";
import { z } from "zod";

const schema = new MemorySchema()
  .defineNodeClass({ name: "Person", schema: z.object({ name: z.string() }), identityKeys: [["name"]] })
  .defineEpisodeKind({ name: "note" })
  .defineResourceRoot({ path: "/notes" });

/** Minimal `FoldTarget` that just records what it was handed. */
function recorder() {
  const names: string[] = [];
  return {
    names,
    glove: {
      fold(args: { name: string }) {
        names.push(args.name);
        return this;
      },
      // `useContext` needs the prompt seam too.
      getSystemPrompt: () => "base",
      setSystemPrompt: () => {},
      processRequest: async () => ({}) as never,
    },
  };
}

const surface = [
  { name: "glove_resources_ls" },
  { name: "glove_resources_read" },
  { name: "glove_resources_write" },
  { name: "glove_resources_remove" },
];

// ─── selectTools ──────────────────────────────────────────────────────────

test("no selection is a pass-through", () => {
  assert.equal(selectTools(surface), surface);
  assert.equal(selectTools(surface, {}), surface);
});

test("short and full names both resolve", () => {
  assert.deepEqual(
    selectTools(surface, { allow: ["ls", "glove_resources_read"] }).map((t) => t.name),
    ["glove_resources_ls", "glove_resources_read"],
  );
});

test("allow narrows, deny subtracts, order is preserved", () => {
  assert.deepEqual(
    selectTools(surface, { allow: ["ls", "read", "write"], deny: ["write"] }).map((t) => t.name),
    ["glove_resources_ls", "glove_resources_read"],
  );
  assert.deepEqual(
    selectTools(surface, { deny: ["write", "remove"] }).map((t) => t.name),
    ["glove_resources_ls", "glove_resources_read"],
  );
});

test("denying something already excluded by allow is a no-op, not an error", () => {
  assert.deepEqual(
    selectTools(surface, { allow: ["ls"], deny: ["write"] }).map((t) => t.name),
    ["glove_resources_ls"],
  );
});

test("a selector that matches nothing throws — a typo must never silently grant", () => {
  assert.throws(
    () => selectTools(surface, { deny: ["wrtie"] }),
    (e: unknown) => {
      assert.ok(e instanceof MemoryToolSelectionError);
      assert.equal(e.code, "unknown_tool");
      assert.deepEqual(e.unknown, ["wrtie"]);
      assert.ok(e.available.includes("glove_resources_write"));
      assert.match(e.message, /Unknown tool selector/);
      return true;
    },
  );
  assert.throws(() => selectTools(surface, { allow: ["nope"] }), MemoryToolSelectionError);
});

// ─── The `use*` helpers ───────────────────────────────────────────────────

test("useResourcesCurator: read-only surface from the full curator set", () => {
  const { names, glove } = recorder();
  useResourcesCurator(glove, new InMemoryResourcesAdapter({ schema }), {
    tools: { allow: ["ls", "read", "stat", "grep", "glob"] },
  });
  assert.deepEqual(names, [
    "glove_resources_ls",
    "glove_resources_read",
    "glove_resources_stat",
    "glove_resources_grep",
    "glove_resources_glob",
  ]);
});

test("useResourcesCurator: drop just the destructive verbs", () => {
  const { names, glove } = recorder();
  useResourcesCurator(glove, new InMemoryResourcesAdapter({ schema }), {
    tools: { deny: ["remove", "move"] },
  });
  assert.equal(names.includes("glove_resources_remove"), false);
  assert.equal(names.includes("glove_resources_move"), false);
  assert.equal(names.includes("glove_resources_write"), true);
});

test("useMemoryCurator: an entity curator that may add but never merge", () => {
  const { names, glove } = recorder();
  useMemoryCurator(glove, new InMemoryEntityAdapter({ schema }), {
    tools: { deny: ["merge_nodes"] },
  });
  assert.equal(names.includes("glove_memory_merge_nodes"), false);
  assert.equal(names.includes("glove_memory_add_node"), true);
});

test("useEpisodicCurator: record-only timeline", () => {
  const { names, glove } = recorder();
  useEpisodicCurator(glove, new InMemoryEpisodicAdapter({ schema }), {
    tools: { deny: ["update", "delete"] },
  });
  assert.deepEqual(names.sort(), [
    "glove_episodic_find",
    "glove_episodic_record",
    "glove_episodic_timeline",
  ]);
});

test("useContext: context the agent may add to but never clear", () => {
  const { names, glove } = recorder();
  useContext(glove, new InMemoryContextAdapter({ schema }), { tools: { deny: ["unset"] } });
  assert.deepEqual(names, [
    "glove_context_get",
    "glove_context_set",
    "glove_context_update",
  ]);
});

test("omitting options keeps the whole surface", () => {
  const { names, glove } = recorder();
  useResourcesCurator(glove, new InMemoryResourcesAdapter({ schema }));
  assert.equal(names.length, 12);
});
