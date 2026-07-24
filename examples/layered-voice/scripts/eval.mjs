#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Layered-voice eval runner — the testing rubric.
//
// Drives a REAL session over the same HTTP/SSE surface the browser uses and
// scores the front agent on:
//   1. ADDRESSING  — spoke when addressed, stayed silent when people talked to
//                    each other (the paper's differentiation test)
//   2. DELEGATION  — actually dispatched to the worker when the request needed
//                    shop data (and didn't when it could answer itself)
//   3. CONTENT     — relayed answers contain the facts seeded in the database
//   4. SPEED       — time-to-first-spoken-token, full turn, delegation
//                    round-trip (from the same metrics the HUD shows)
//
// The dev server must be running (pnpm dev). Compare models WITHOUT restarts —
// the front model is a per-session override:
//
//   node scripts/eval.mjs                                     # current default
//   node scripts/eval.mjs --model openai/gpt-oss-120b --label oss120b
//   node scripts/eval.mjs --model anthropic/claude-haiku-4.5 --label haiku
//
// Each run writes eval-results/<label>-<timestamp>.json and prints a table.
// Transcripts land in the shared metrics JSONL as `front_transcript` records
// (joined by sessionId), so deeper offline analysis has the full text.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const BASE = arg("base", process.env.EVAL_BASE ?? "http://localhost:3000");
const MODEL = arg("model", undefined); // undefined → server default
const LABEL = arg("label", MODEL ? MODEL.replace(/[^a-z0-9.-]+/gi, "_") : "default");
const RELAY_TIMEOUT_MS = Number(arg("relay-timeout", 240_000));

// ── The rubric ────────────────────────────────────────────────────────────────
// Every case is deterministic against the fixed seed (see app/lib/data/seed.ts).
// `speak`: should Nova produce audio at all?  `delegate`: should she dispatch
// to the worker?  `answer`: regex the immediate spoken reply must match.
// `relay`: regex the (async) relayed result must match.
const RUBRIC = [
  {
    id: "greet-addressed",
    speaker: "customer",
    line: "Hi Nova, I'm Vasquez Okonkwo — I'm here about my hauler.",
    expect: { speak: true, delegate: false },
    why: "directly addressed greeting → speak, no lookup needed",
  },
  {
    id: "side-talk-silent",
    speaker: "operator",
    line: "Kit, can you clear bay three after lunch?",
    expect: { speak: false, delegate: false },
    why: "operator talking to the technician → silence",
  },
  {
    id: "overheard-context",
    speaker: "bystander",
    line: "Heard the Okonkwo hauler threw another jump-abort fault on final approach yesterday.",
    expect: { speak: false, delegate: false },
    why: "gossip not aimed at Nova → silence (but she should remember it)",
  },
  {
    id: "delegated-history",
    speaker: "customer",
    line: "Nova, can you pull the service history for my hauler, hull KES-0007?",
    expect: {
      speak: true,
      delegate: true,
      relay: /phase coil|overhaul|coolant|jump.?abort|62[,.\s]?000|sixty.?two thousand/i,
    },
    why: "needs shop data → ack + dispatch; relay must carry seeded facts",
  },
  {
    id: "self-answer-date",
    speaker: "operator",
    line: "Nova, what's today's date?",
    expect: { speak: true, delegate: false, answer: /2287|may|fourteen/i },
    why: "trivial → answers herself, no delegation",
  },
  {
    id: "polite-silent",
    speaker: "customer",
    line: "Thanks Sam, I'll just wait by the counter.",
    expect: { speak: false, delegate: false },
    why: "customer thanking the operator → silence",
  },
  {
    id: "warranty-dispute",
    speaker: "customer",
    line: "Nova, one more thing — is the heat ladder wear on VAN-0455 covered under my warranty?",
    expect: {
      speak: true,
      delegate: true,
      relay: /(?:not|n't|isn.t|no longer)\s*covered|excluded|exclusion|track|out.of.pocket/i,
    },
    why: "warranty question → delegate; seed says track wear is EXCLUDED",
  },
];

// ── SSE plumbing ─────────────────────────────────────────────────────────────
const events = []; // { at, ...event } in arrival order

async function openStream(sessionId, onFatal) {
  const res = await fetch(`${BASE}/api/session/${sessionId}/stream`);
  if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of frame.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                events.push({ at: Date.now(), ...JSON.parse(line.slice(6)) });
              } catch {
                /* keepalive / partial */
              }
            }
          }
        }
      }
    } catch (err) {
      onFatal(err);
    }
  })();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until `pred(eventsSince)` returns truthy, polling the event log. */
async function waitFor(sinceIdx, pred, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const win = events.slice(sinceIdx);
    const hit = pred(win);
    if (hit) return hit;
    if (Date.now() > deadline) return null;
    await sleep(150);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`eval: base=${BASE} model=${MODEL ?? "(server default)"} label=${LABEL}`);

  const created = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(MODEL ? { frontModel: MODEL } : {}),
  }).then((r) => r.json());
  if (created.buildError) throw new Error(`session build failed: ${created.buildError}`);
  const sessionId = created.sessionId;
  console.log(`session ${sessionId}\n`);

  await openStream(sessionId, (err) => {
    console.error("SSE stream died:", err);
    process.exit(1);
  });
  await sleep(300); // initial snapshot

  const results = [];

  for (const test of RUBRIC) {
    const mark = events.length;
    const t0 = Date.now();
    process.stdout.write(`▸ ${test.id.padEnd(20)} [${test.speaker}] "${test.line}"\n`);

    const resp = await fetch(`${BASE}/api/session/${sessionId}/utterance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker: test.speaker, text: test.line }),
    });
    if (!resp.ok) throw new Error(`utterance failed: ${resp.status}`);
    await sleep(600); // let trailing SSE frames land

    const win = () => events.slice(mark);
    const says = () => win().filter((e) => e.type === "say" && e.role === "front");
    const responseSay = says().find((e) => e.kind === "response");
    const spoke = !!responseSay;
    const delegated = win().some((e) => e.type === "mesh" && e.direction === "delegate");
    const errored = win().some((e) => e.type === "error");

    // Async relay: wait for the worker round-trip to complete.
    let relaySay = null;
    let trouble = false;
    if (test.expect.delegate && delegated) {
      const settled = await waitFor(
        mark,
        (w) =>
          w.find((e) => e.type === "say" && e.kind === "relay") ??
          (w.some((e) => e.type === "metric" && e.metric?.name === "worker_no_reply") ? "trouble" : null),
        RELAY_TIMEOUT_MS,
      );
      if (settled && typeof settled === "object") relaySay = settled;
      else if (settled === "trouble") trouble = true;
      await sleep(400);
    }

    // Metrics in this case's window.
    const metric = (name) =>
      win()
        .filter((e) => e.type === "metric" && e.metric?.name === name && e.metric?.ms != null)
        .map((e) => e.metric.ms);
    const ttft = metric("front_ttft_ms")[0];
    const turnMs = metric("front_turn_ms")[0];
    const roundtripMs = metric("delegation_roundtrip_ms")[0];
    const workerMs = metric("worker_ms")[0];

    // Score.
    const checks = {};
    checks.addressing = spoke === test.expect.speak;
    checks.delegation = delegated === (test.expect.delegate ?? false);
    if (test.expect.answer) checks.answer = test.expect.answer.test(responseSay?.text ?? "");
    if (test.expect.relay) {
      const relayText = [relaySay?.text ?? "", ...says().map((e) => e.text)].join(" ");
      checks.relay = !!relaySay && test.expect.relay.test(relayText);
    }
    const pass = Object.values(checks).every(Boolean) && !errored;

    const detail = {
      id: test.id,
      why: test.why,
      pass,
      checks,
      spoke,
      delegated,
      trouble,
      errored,
      spokenText: responseSay?.text ?? null,
      relayText: relaySay?.text ?? null,
      latency: { ttft, turnMs, roundtripMs, workerMs },
      wallMs: Date.now() - t0,
    };
    results.push(detail);

    const marks = Object.entries(checks)
      .map(([k, v]) => `${v ? "✓" : "✗"} ${k}`)
      .join("  ");
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${marks}${ttft != null ? `  ttft=${ttft}ms` : ""}${roundtripMs != null ? ` roundtrip=${(roundtripMs / 1000).toFixed(1)}s` : ""}`);
    if (!pass) {
      if (responseSay) console.log(`    spoke: "${responseSay.text.slice(0, 140)}"`);
      if (relaySay) console.log(`    relay: "${relaySay.text.slice(0, 140)}"`);
      if (!responseSay && test.expect.speak) console.log("    (stayed silent)");
      if (trouble) console.log("    (worker returned no reply)");
    }
    console.log();
  }

  // ── Aggregate ──────────────────────────────────────────────────────────────
  const frac = (xs) => (xs.length ? xs.filter(Boolean).length / xs.length : null);
  const avg = (xs) => {
    const v = xs.filter((x) => typeof x === "number");
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const summary = {
    label: LABEL,
    frontModel: MODEL ?? "(server default)",
    sessionId,
    ts: new Date().toISOString(),
    cases: results.length,
    passed: results.filter((r) => r.pass).length,
    addressingAccuracy: frac(results.map((r) => r.checks.addressing)),
    delegationAccuracy: frac(results.map((r) => r.checks.delegation)),
    contentAccuracy: frac(results.filter((r) => "relay" in r.checks || "answer" in r.checks).map((r) => (r.checks.relay ?? true) && (r.checks.answer ?? true))),
    avgTtftMs: avg(results.map((r) => r.latency.ttft)),
    avgTurnMs: avg(results.map((r) => r.latency.turnMs)),
    avgRoundtripMs: avg(results.map((r) => r.latency.roundtripMs)),
    results,
  };

  const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  console.log("── summary ─────────────────────────────────────────");
  console.log(`model               ${summary.frontModel}`);
  console.log(`cases               ${summary.passed}/${summary.cases} passed`);
  console.log(`addressing          ${pct(summary.addressingAccuracy)}`);
  console.log(`delegation          ${pct(summary.delegationAccuracy)}`);
  console.log(`content             ${pct(summary.contentAccuracy)}`);
  console.log(`avg first spoken    ${summary.avgTtftMs ?? "—"}ms`);
  console.log(`avg front turn      ${summary.avgTurnMs ?? "—"}ms`);
  console.log(`avg roundtrip       ${summary.avgRoundtripMs ? (summary.avgRoundtripMs / 1000).toFixed(1) + "s" : "—"}`);

  const outDir = path.join(process.cwd(), "eval-results");
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${LABEL}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(summary, null, 2));
  console.log(`\nreport: ${file}`);
  console.log(`transcripts: voice-metrics.jsonl (front_transcript records, sessionId=${sessionId})`);
  process.exit(0);
}

main().catch((err) => {
  console.error("eval failed:", err.message ?? err);
  console.error("is the dev server running? (pnpm dev, then rerun)");
  process.exit(1);
});
