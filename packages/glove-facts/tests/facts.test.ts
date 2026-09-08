import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { FactStore, FactPreparation, InMemoryFactAdapter, createModelPreparation, buildRecordFactTool } from "../src/index";
import type { Fact, FactRequirement, PreparationReport } from "../src/index";
const scope = { subject: "client:1", context: "matter:1" };
const input = (text = "Email: ada@example.com") => ({ text, source: { kind: "message" as const, id: "m1" }, verification: "verified" as const });
const requirement = (extra = {}): FactRequirement => ({ id: "email", kind: "information", criteria: "Contact email", schema: z.email(), eligible: true, ...extra });
const propose = (facts: Fact[], extra = {}) => ({ proposals: [{ requirement: "email", value: "ada@example.com", refs: facts.map(({ id, revision }) => ({ id, revision })), strength: "sufficient", derivation: "explicit", explanation: "The supplied contact email", ...extra }] });
async function setup() { const facts = new FactStore(new InMemoryFactAdapter(), { scope }); await facts.record(input(), { operationId: "m1-email" }); return facts; }
async function run(preparer: FactPreparation, requirements = [requirement()], consumer = "form:1", acceptedClaimIds: string[] = []) {
  return preparer.run({ consumer, requirements, acceptedClaimIds }, async report => ({ value: report!, acceptedClaimIds: report?.decisions.filter(d => d.apply).map(d => d.claim!.id) ?? [] }));
}
test("capture is revisioned, idempotent and rejects conflicting operation ids", async () => {
  const facts = await setup();
  const [f] = await facts.list();
  assert.deepEqual(await facts.record(input(), { operationId: "m1-email" }), f);
  await assert.rejects(facts.record(input("different"), { operationId: "m1-email" }), /reused/);
  const corrected = await facts.record(input("Email: corrected@example.com"), { operationId: "m2", supersedes: f });
  assert.equal(corrected.id, f.id); assert.equal(corrected.revision, 2);
  assert.equal((await facts.list({ history: true })).length, 2);
  await assert.rejects(facts.record(input(), { operationId: "m3", supersedes: f }), /stale/);
});
test("capacity errors explicitly; stored urgent facts survive delivery failure and can be retried", async () => {
  let calls = 0;
  const facts = new FactStore(new InMemoryFactAdapter(), { scope, maxRevisions: 1, onUrgent: () => { if (++calls === 1) throw new Error("offline"); } });
  const urgent = { ...input("Deadline tomorrow"), urgent: true };
  await assert.rejects(facts.record(urgent, { operationId: "urgent" }), /saved/);
  assert.equal((await facts.list({ urgent: true })).length, 1);
  await facts.record(urgent, { operationId: "urgent" });
  assert.equal(calls, 2);
  await assert.rejects(facts.record(input(), { operationId: "overflow" }), /capacity/);
});
test("fact scope includes both subject and matter; prototype-shaped operation ids are safe", async () => {
  const adapter = new InMemoryFactAdapter();
  const a = new FactStore(adapter, { scope });
  for (const operationId of ["__proto__", "constructor", "toString"]) await a.record(input(), { operationId });
  assert.equal((await a.list()).length, 3);
  for (const other of [{ ...scope, subject: "client:2" }, { ...scope, context: "matter:2" }]) assert.deepEqual(await new FactStore(adapter, { scope: other }).list(), []);
});
test("disabled preparation performs no inference or claims and preserves all captured state", async () => {
  const facts = await setup(); let enabled = false; let calls = 0;
  const preparer = new FactPreparation(facts, { enabled: () => enabled, inference: { infer: async () => { calls++; return propose(await facts.list()); } } });
  assert.equal(await run(preparer), undefined); assert.equal(calls, 0);
  assert.equal((await facts.inspect()).claims.length, 0); assert.equal((await facts.list()).length, 1);
  // Use request candidates, never recursively acquire the same fact lock.
  preparer.config.inference.infer = async (data: any) => { calls++; return propose(data.facts); };
  enabled = true; assert.equal((await run(preparer)).decisions[0].apply, true);
  const state = await facts.inspect(); enabled = false; await run(preparer);
  assert.deepEqual(await facts.inspect(), state);
});
test("shared evidence is linked separately to multiple consumers, never consumed", async () => {
  const facts = await setup();
  const preparer = new FactPreparation(facts, { enabled: true, inference: { infer: async (data: any) => propose(data.facts) } });
  const a = await run(preparer); const b = await run(preparer, [requirement()], "goal:1");
  assert.notEqual(a.decisions[0].claim!.id, b.decisions[0].claim!.id);
  assert.equal((await facts.inspect()).claims.filter(c => c.state === "accepted").length, 2);
  assert.equal((await facts.list()).length, 1);
  assert.equal((await facts.list({ unclaimedBy: "form:1" })).length, 0);
  assert.equal((await facts.list({ unclaimedBy: "form:2" })).length, 1);
});
test("unverified, ambiguous and conflicted evidence cannot silently satisfy requirements", async () => {
  for (const verification of ["unverified", "ambiguous", "conflicted"] as const) {
    const facts = new FactStore(new InMemoryFactAdapter(), { scope }); await facts.record({ ...input(), verification }, { operationId: "1" });
    const report = await run(new FactPreparation(facts, { enabled: true, inference: { infer: async (data: any) => propose(data.facts) } }));
    assert.equal(report.decisions[0].apply, false);
    assert.equal(report.decisions[0].status, verification === "conflicted" ? "conflict" : "confirmation");
  }
});
test("synthesis keeps every source revision and distinguishes derived values", async () => {
  const facts = await setup(); await facts.record(input("Use ada at example dot com"), { operationId: "2" });
  const report = await run(new FactPreparation(facts, { enabled: true, inference: { infer: async (data: any) => propose(data.facts, { derivation: "synthesized" }) } }));
  assert.equal(report.decisions[0].claim!.refs.length, 2); assert.equal(report.decisions[0].claim!.derivation, "synthesized");
});
test("unknown, stale, duplicate references and invalid values reject the inference batch", async () => {
  const facts = await setup(); const [old] = await facts.list(); await facts.record(input(), { operationId: "2", supersedes: old });
  for (const override of [{ refs: [{ id: "invented", revision: 1 }] }, { refs: [{ id: old.id, revision: 1 }] }, { value: "not an email" }, { refs: [] }, { requirement: "invented" }]) {
    const report = await run(new FactPreparation(facts, { enabled: true, inference: { infer: async (data: any) => propose(data.facts, override) } }));
    assert.ok(report.error); assert.ok(report.decisions.every(d => !d.apply));
  }
  assert.equal((await facts.inspect()).claims.length, 0);
});
test("intention is not an action and preference is not authorized approval", async () => {
  for (const kind of ["action", "approval", "outcome"] as const) {
    const facts = await setup();
    const config = new FactPreparation(facts, { enabled: true, inference: { infer: async (data: any) => propose(data.facts, { value: true }) } });
    const rules = [requirement({ kind, schema: z.literal(true), evidenceKey: "send", authorizedActors: ["manager"] })];
    assert.equal((await run(config, rules)).decisions[0].apply, false);
    const f = await facts.record({ ...input("Done"), evidence: { kind, key: "send", result: "success", actor: "manager" } }, { operationId: "done" });
    config.config.inference.infer = async () => propose([f], { value: true });
    assert.equal((await run(config, rules)).decisions[0].apply, true);
    if (kind === "approval") assert.equal((await run(config, [requirement({ kind, schema: z.literal(true), evidenceKey: "send", authorizedActors: ["someone-else"] })])).decisions[0].apply, false);
  }
});
test("ineligible upcoming requirements get proposals without commits", async () => {
  const facts = await setup(); const report = await run(new FactPreparation(facts, { enabled: true, inference: { infer: async (data: any) => propose(data.facts) } }), [requirement({ eligible: false })]);
  assert.equal(report.decisions[0].status, "ineligible"); assert.equal(report.decisions[0].apply, false);
  assert.equal((await facts.inspect()).claims[0].state, "proposed");
});
test("corrections and changed criteria put prior completions into review", async () => {
  const facts = await setup(); const prep = new FactPreparation(facts, { enabled: true, inference: { infer: async (data: any) => propose(data.facts) } });
  const claim = (await run(prep)).decisions[0].claim!;
  await facts.record(input("different email"), { operationId: "2", supersedes: (await facts.list())[0] });
  const report = await run(prep, [requirement({ current: { value: "ada@example.com", claimId: claim.id } })]);
  assert.equal(report.decisions[0].status, "review"); assert.equal(report.decisions[0].apply, false);
});
test("failed commits retain proposed links; restart receipts repair acceptance without duplicate claims", async () => {
  const facts = await setup(); const config = { enabled: true, inference: { infer: async (data: any) => propose(data.facts) } };
  const preparer = new FactPreparation(facts, config); let report: PreparationReport;
  await assert.rejects(preparer.run({ consumer: "form:1", requirements: [requirement()] }, async r => { report = r!; throw new Error("lost acknowledgement"); }));
  assert.equal((await facts.inspect()).claims[0].state, "proposed");
  const id = report!.decisions[0].claim!.id;
  const result = await run(new FactPreparation(facts, config), [requirement({ current: { value: "ada@example.com", claimId: id } })], "form:1", [id]);
  assert.equal(result.decisions[0].apply, false);
  assert.equal((await facts.inspect()).claims.length, 1); assert.equal((await facts.inspect()).claims[0].state, "accepted");
});
test("scope lock prevents corrections racing a validated consumer commit", async () => {
  const facts = await setup(); let release!: () => void; const gate = new Promise<void>(r => release = r); let entered!: () => void; const ready = new Promise<void>(r => entered = r);
  const prep = new FactPreparation(facts, { enabled: true, inference: { infer: async (data: any) => { entered(); await gate; return propose(data.facts); } } });
  const old = (await facts.list())[0]; const preparation = run(prep); await ready;
  let corrected = false; const correction = facts.record(input("new"), { operationId: "2", supersedes: old }).then(() => { corrected = true; });
  await Promise.resolve(); assert.equal(corrected, false); release();
  assert.equal((await preparation).decisions[0].apply, true); await correction; assert.equal(corrected, true);
});
test("model adapter makes a dedicated inference invocation and validates its output", async () => {
  let calls = 0;
  const model = { name: "test", setSystemPrompt: () => { throw new Error("must not mutate shared model"); }, prompt: async (request: any) => {
    calls++; assert.equal(request.messages.length, 1); assert.equal(request.tools[0].name, "submit_preparation");
    return { messages: [{ sender: "agent" as const, text: "", tool_calls: [{ tool_name: "submit_preparation", input_args: { proposals: [] } }] }], tokens_in: 10, tokens_out: 2 };
  } };
  assert.deepEqual(await createModelPreparation(model).infer({ facts: [] }), { proposals: [] }); assert.equal(calls, 1);
});
test("record_fact binds host scope and provenance and cannot grant verification", async () => {
  const facts = await setup(); const tool = buildRecordFactTool(facts, () => ({ source: { kind: "message", id: "m2" }, operationId: "m2" }));
  assert.equal((await tool.do!({ fact: "This action was done", verification: "verified" } as any, undefined as any)).status, "error");
  const result = await tool.do!({ fact: "This action was done" }, undefined as any);
  assert.equal(result.status, "success"); assert.equal((await facts.list()).at(-1)!.verification, "unverified");
});

test("inference cannot mutate the candidate evidence used by validation", async () => {
  const facts = new FactStore(new InMemoryFactAdapter(), { scope }); await facts.record({ ...input(), verification: "unverified" }, { operationId: "1" });
  const prep = new FactPreparation(facts, { enabled: true, inference: { infer: async (data: any) => { data.facts[0].verification = "verified"; return propose(data.facts); } } });
  assert.equal((await run(prep)).decisions[0].status, "confirmation");
  assert.equal((await facts.list())[0].verification, "unverified");
});
test("reworded inference rationale reuses the same evidence claim", async () => {
  const facts = await setup(); let n = 0;
  const prep = new FactPreparation(facts, { enabled: true, inference: { infer: async (data: any) => propose(data.facts, { explanation: `rationale ${++n}` }) } });
  const first = await run(prep); const second = await run(prep);
  assert.equal(first.decisions[0].claim!.id, second.decisions[0].claim!.id);
  assert.equal(first.decisions[0].explanation, second.decisions[0].explanation);
  assert.equal((await facts.inspect()).claims.length, 1);
});
test("foreign urgent evidence returned by a broken adapter is never rendered or sent to inference", async () => {
  const facts = await setup(); const state = await facts.inspect(); state.facts[0].scope.context = "foreign"; state.facts[0].urgent = true;
  facts.adapter.withScope = async (_scope, fn) => fn({ read: async () => structuredClone(state), save: async () => {} });
  let calls = 0;
  const report = await run(new FactPreparation(facts, { enabled: true, inference: { infer: async () => { calls++; return { proposals: [] }; } } }));
  assert.equal(calls, 0); assert.deepEqual(report.urgent, []); assert.match(report.error!, /another scope/);
});
