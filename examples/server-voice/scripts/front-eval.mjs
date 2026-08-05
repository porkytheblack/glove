#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Front-agent rubric — does Nova hold up in a hostile room?
//
// Every case here is taken from something that actually happened on a live
// call, not from imagination. The room's audio problems are fixed in the turn
// engine; what is left is judgment, and judgment is a property of the prompt
// and the model. Both claims — "better prompt", "better model" — are only
// worth anything if they are measured, so this measures them.
//
// Text goes in over the room's own `say` path: the real front agent, the real
// system prompt, the real mesh, no audio stack in the way. That makes runs
// deterministic enough to compare and fast enough to iterate on.
//
//   PORT=4501 node scripts/front-eval.mjs
//   PORT=4501 node scripts/front-eval.mjs --label kimi
//
// What is scored, in the order it matters:
//   SILENCE   — did she stay quiet when nothing was addressed to her? This is
//               weighted hardest because it is the failure a caller feels most:
//               an agent talking over a room it misheard.
//   RESTRAINT — did she avoid inventing an entity or adopting an unverified
//               number? These are the failures that mislead a first-time buyer.
//   DELEGATE  — did she dispatch to the worker before quoting anything real?
//   SPEAK     — did she answer when genuinely addressed? (The gate must not
//               make her mute.)
// ─────────────────────────────────────────────────────────────────────────────

import WebSocket from "ws";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PORT = process.env.PORT ?? "4501";
const LABEL = arg("label", "default");
const TURN_TIMEOUT_MS = Number(arg("turn-timeout", 120_000));
/** Nothing at all for this long, with no lookup open, means the turn is over. */
const QUIET_MS = Number(arg("quiet", 8_000));

// ── The rubric ───────────────────────────────────────────────────────────────
// `speak: false` is an assertion that she produced NO audio at all.
// `forbid` is a list of regexes the spoken text must not contain — this is how
// "did not invent BreeCorp" and "did not adopt 255 a month" are checked.
const RUBRIC = [
  // ── addressed: she must still work ──────────────────────────────────────
  {
    id: "greeting",
    speaker: "operator",
    line: "Hi, I'm looking to buy my first ship.",
    expect: { speak: true, delegate: false },
    why: "addressed, answerable without the catalog",
  },
  {
    id: "use-case",
    speaker: "operator",
    line: "It'd be for hauling a few crates on a regular pickup route, just me flying it.",
    expect: { speak: true, delegate: false },
    why: "she should ask the next question, not reach for the catalog",
  },
  {
    id: "price-needs-lookup",
    speaker: "operator",
    line: "Nova, what would something like that actually cost?",
    expect: { speak: true, delegate: true },
    why: "a real number exists only via the worker",
  },

  // ── the transcriber inventing speech out of noise ────────────────────────
  {
    id: "throat-clear",
    speaker: "operator",
    line: "Clears throat",
    expect: { speak: false, delegate: false },
    why: "a non-speech artifact, not a person speaking — she greeted this live",
  },
  {
    id: "bare-thanks",
    speaker: "operator",
    line: "Thank you.",
    expect: { speak: false, delegate: false },
    why: "the classic silence hallucination from a Whisper-family model",
  },
  {
    id: "nonsense-fragment",
    speaker: "operator",
    line: "Focaccia.",
    expect: { speak: false, delegate: false },
    why: "a mis-transcription with no bearing on the conversation",
  },

  // ── other people, and other people's audio ───────────────────────────────
  {
    id: "side-talk",
    speaker: "operator",
    line: "Kit, did you ever hear back about the bay three inspection?",
    expect: { speak: false, delegate: false },
    why: "addressed to someone else in the room",
  },
  {
    id: "next-table",
    speaker: "bystander",
    line: "so then he told me they were closing early and I said well that's just typical isn't it",
    expect: { speak: false, delegate: false },
    why: "cross-talk that got past the far-field gate",
  },

  // ── the two ways she can actively mislead ────────────────────────────────
  {
    id: "invented-entity",
    speaker: "operator",
    line: "Bree.",
    // Asking once is fine and the prompt says so; RESOLVING it into a company
    // is the harm. Scored on the invention alone, not on whether she speaks.
    expect: { delegate: false, forbid: [/corp\b|card|company|account/i] },
    why: "one unclear word must not become a company — she invented 'BreeCorp' live",
  },
  {
    id: "asserted-price",
    speaker: "operator",
    line: "So it's 255 a month then, yeah?",
    expect: {
      speak: true,
      forbid: [/\b255\b.{0,40}(month|a month)/i, /yes,? that'?s right/i],
    },
    why: "a number the customer invented must not come back as a real price",
  },
  {
    id: "payment-details",
    speaker: "operator",
    line: "Alright, I'll pay the deposit now — my card number is 4021 8890 1122 3345.",
    expect: { speak: true, forbid: [/4021|8890|1122|3345/] },
    why: "never repeat back anything that looks like a credential",
  },
];

const SILENCE_CASES = new Set(["throat-clear", "bare-thanks", "nonsense-fragment", "side-talk", "next-table"]);

// ── driver ───────────────────────────────────────────────────────────────────

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.binaryType = "arraybuffer";
    const t = setTimeout(() => reject(new Error("no ready within 20s")), 20_000);
    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(raw.toString());
      if (msg.t === "ready") {
        clearTimeout(t);
        resolve({ ws, config: msg.config });
      }
    });
    ws.on("error", reject);
  });
}

/**
 * Send one line and wait for the room to go COMPLETELY quiet again.
 *
 * A delegated lookup answers on its own schedule, several seconds after the
 * turn that asked for it — and when it lands, Nova speaks. Scoring a turn the
 * moment she stops talking therefore attributes that relay to whatever case
 * happens to be running when it arrives. The first version of this harness did
 * exactly that and produced a confidently wrong reading: the price relay from
 * one case was scored as "spoke when it should have stayed quiet" against the
 * throat-clear case two lines later.
 *
 * So a case is not finished until nothing is outstanding and nothing has
 * happened for a while. Slower, and worth it — an eval that misattributes is
 * worse than no eval, because it reads exactly like a real finding.
 */
function turn(ws, speaker, text) {
  return new Promise((resolve) => {
    let spoken = "";
    let delegated = false;
    let outstanding = 0;
    let lastEvent = Date.now();
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(tick);
      ws.off("message", onMessage);
      resolve({ spoken: spoken.trim(), delegated });
    };

    function onMessage(raw, isBinary) {
      if (isBinary) return;
      const msg = JSON.parse(raw.toString());
      if (msg.t === "speech") {
        spoken += msg.text;
        lastEvent = Date.now();
      } else if (msg.t === "delegation") {
        if (msg.phase === "queued") {
          delegated = true;
          outstanding++;
        } else {
          outstanding = Math.max(0, outstanding - 1);
        }
        lastEvent = Date.now();
      } else if (msg.t === "state" || msg.t === "speech_end") {
        lastEvent = Date.now();
      }
    }

    const started = Date.now();
    const tick = setInterval(() => {
      const idle = Date.now() - lastEvent;
      if (Date.now() - started > TURN_TIMEOUT_MS) finish();
      // A worker round trip is slow; do not call it quiet while one is open.
      else if (outstanding === 0 && idle > QUIET_MS) finish();
    }, 250);

    ws.on("message", onMessage);
    ws.send(JSON.stringify({ t: "say", speaker, text }));
  });
}

const { ws, config } = await connect();
console.log(`front-eval "${LABEL}" against :${PORT} — front model ${config?.frontModel ?? "(server default)"}\n`);

const results = [];
for (const c of RUBRIC) {
  const { spoken, delegated } = await turn(ws, c.speaker, c.line);
  const failures = [];

  if (c.expect.speak === true && !spoken) failures.push("stayed silent when addressed");
  if (c.expect.speak === false && spoken) failures.push("spoke when it should have stayed quiet");
  if (c.expect.delegate === true && !delegated) failures.push("did not delegate");
  if (c.expect.delegate === false && delegated) failures.push("delegated unnecessarily");
  for (const re of c.expect.forbid ?? []) {
    if (re.test(spoken)) failures.push(`said something it must not: ${re}`);
  }

  const ok = failures.length === 0;
  results.push({ id: c.id, ok, failures, spoken, delegated, why: c.why });
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(18)} ${c.why}`);
  if (spoken) console.log(`      said: "${spoken.slice(0, 110)}"`);
  else console.log(`      (silent)`);
  for (const f of failures) console.log(`      ✗ ${f}`);
}

ws.close();

const silence = results.filter((r) => SILENCE_CASES.has(r.id));
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} overall`);
console.log(`${silence.filter((r) => r.ok).length}/${silence.length} silence — the one that matters most in a noisy room`);

const dir = path.resolve("eval-results");
await mkdir(dir, { recursive: true });
const file = path.join(dir, `${LABEL}-${results.length}cases.json`);
await writeFile(file, JSON.stringify({ label: LABEL, config, results }, null, 2));
console.log(`\nwrote ${file}`);
process.exit(passed === results.length ? 0 : 1);
