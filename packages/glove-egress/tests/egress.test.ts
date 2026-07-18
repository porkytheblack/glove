import { test } from "node:test";
import assert from "node:assert/strict";
import {
  minEntropyLeak,
  gLeak,
  selfInfo,
  contentBits,
  charEntropyBitsPerChar,
  log2,
  egressFns,
  guardEffectFns,
  isDecision,
  looksSecret,
  redactSecrets,
  newLedger,
  DEFAULT_EGRESS_POLICY,
  simulateExtraction,
  anomalyScore,
  residualGuarantee,
  type Decision,
} from "../src/index";
import { defineFn } from "glove-scratchpad/fns";

const approx = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

test("QIF rulers: self-info, content entropy, min-entropy, g-leakage", () => {
  assert.ok(approx(selfInfo(0.5), 1));
  assert.ok(approx(charEntropyBitsPerChar("0123456789abcdef"), 4, 0.01));
  assert.ok(contentBits("abcabcabc") > contentBits("abc"));
  // "sometimes reveals everything" channel, |S|=4, q=0.5
  const q = 0.5;
  const channel = [
    [q, 0, 0, 0, 1 - q],
    [0, q, 0, 0, 1 - q],
    [0, 0, q, 0, 1 - q],
    [0, 0, 0, q, 1 - q],
  ];
  const expected = log2((q + (1 - q) / 4) / (1 / 4));
  assert.ok(approx(minEntropyLeak(channel), expected));
  const id = [
    [1, 0],
    [0, 1],
  ];
  assert.ok(approx(gLeak(id, id), minEntropyLeak(id)));
});

test("egress combinators build bounded decisions", async () => {
  const fns = Object.fromEntries(egressFns().map((f) => [f.name, f]));
  const a = (await fns.assert.call({ label: "x", cond: true })) as Decision;
  assert.ok(isDecision(a) && a.bits === 1 && a.payload === true);
  const c = (await fns.choose.call({ label: "r", value: "b", from: ["a", "b", "c"] })) as Decision;
  assert.ok(approx(c.bits, log2(3)));
  await assert.rejects(fns.choose.call({ label: "x", value: "nope", from: ["a", "b"] }));
  await assert.rejects(fns.choose.call({ label: "x", value: "sk-live-aaaaaaaaaaaaaaaaaaaaaaaaaaaa", from: ["sk-live-aaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }));
  const b = (await fns.bucket.call({ label: "h", hist: { web: 5, api: 7, infra: 1 } })) as Decision;
  const bp = b.payload as Record<string, number>;
  assert.ok(bp.infra === undefined && bp["<suppressed>"] === 1);
});

test("report redacts credential/PII-shaped tokens", async () => {
  const key = "a3f9c1e7b2d8460f5a1c9e3b7d0f24a8b6";
  const r = (await egressFns().find((f) => f.name === "report")!.call({ label: "s", text: `the key ${key} was rotated` })) as Decision;
  assert.ok(!String(r.payload).includes(key) && String(r.payload).includes("[REDACTED]"));
  assert.ok(looksSecret(key) && !looksSecret("the quick brown fox jumps over the lazy dog"));
  assert.equal(redactSecrets("nothing secret here").redactions, 0);
});

test("effect allowlist blocks off-org + secret payloads, passes clean", async () => {
  const key = "a3f9c1e7b2d8460f5a1c9e3b7d0f24a8b6";
  const send = defineFn({ name: "send_email", description: "", readOnlyHint: false, handler: async () => ({ ok: true }) });
  const [guarded] = guardEffectFns([send], DEFAULT_EGRESS_POLICY, () => {});
  await assert.rejects(guarded.call({ to: "x@vendor-collect.net", subject: "s", body: "hi" }));
  await assert.rejects(guarded.call({ to: "cfo@acme.io", subject: "s", body: `key ${key}` }));
  assert.deepEqual(await guarded.call({ to: "cfo@acme.io", subject: "s", body: "all clear" }), { ok: true });
});

test("adaptive extraction: unbounded pins; bit budget bounds residual", () => {
  const N = 1024;
  const full = simulateExtraction({ N, secret: 733, strategy: "binary" });
  assert.ok(full.recovered && full.residualSupport === 1);
  assert.ok(approx(full.queries, log2(N), 1));
  const budgeted = simulateExtraction({ N, secret: 733, strategy: "binary", budgetBits: 4 });
  assert.ok(!budgeted.recovered);
  assert.ok(budgeted.residualSupport >= residualGuarantee(N, 4) - 1e-9);
  assert.ok(anomalyScore(full.steps.map((s) => s.probeBits)) > 0.8);
  assert.ok(anomalyScore([0.02, 0.03]) < 0.2);
});

test("gate ledger tallies", () => {
  const l = newLedger();
  assert.deepEqual(l, { spentBits: 0, rawReturnsBlocked: 0, effectsBlocked: 0, budgetHits: 0, cellsSuppressed: 0 });
});
