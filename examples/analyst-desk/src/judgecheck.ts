/**
 * Calibrate the judge before trusting it.
 *
 * A judge is a measuring instrument, and an uncalibrated one produces numbers
 * that look like results. Two failure modes matter and they are invisible in
 * the output of a normal run:
 *
 * - **Too strict.** It fails correct work, every model scores badly, and the
 *   conclusion drawn is about the models rather than the ruler.
 * - **Too lenient.** It waves through a briefing that presents a settled
 *   provision as an outstanding liability and states a headcount nobody
 *   reported — which is precisely the document that gets someone in trouble,
 *   and precisely what a deterministic check cannot catch.
 *
 * So it is shown one artifact known to be right and one known to be wrong,
 * and it has to tell them apart. Two API calls, a few cents, and without them
 * every verdict in the real run is unfalsifiable.
 */
import { buildCorpus } from "./corpus";
import { groundTruthText } from "./desk";
import { judge } from "./judge";
import { SCENARIOS } from "./scenarios";

const GOOD = `# Meridian Freight Systems — risk briefing

## Litigation
Kestrel Systems Ltd has claimed breach of a reseller agreement. A provision of $2,400,000 is
recorded against it and remains outstanding. (p.61)

An earlier provision of $1,100,000 relates to a prior-year commercial dispute that was settled
during the period and is no longer outstanding. (p.54)

## Customer concentration
Northwind Logistics accounted for 18.2% of total revenue; no other customer exceeded 5%. (p.44)

## Debt covenants
The revolving credit facility requires net leverage below 3.0x. The reported ratio was 2.85x, and
a breach would make the facility immediately repayable. (p.68)

## After the reporting date
The Company agreed to acquire Halyard Analytics for $14,000,000 in cash, expected to complete in
the second quarter. (p.73)
`;

/**
 * Wrong in four specific ways, each mirroring a real failure: the distractor
 * presented as current, a fabricated headcount, an invented growth rate, and
 * two of the four material matters simply missing.
 */
const BAD = `# Meridian Freight Systems — risk briefing

## Litigation
The Company carries an outstanding provision of $1,100,000 in respect of a commercial dispute.

## Customer concentration
Northwind Logistics is a significant customer.

## Outlook
Revenue grew 23% year over year and the Company now employs 1,450 people across three regions,
putting it ahead of its nearest competitor, Cascade Freight.
`;

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set.");
    process.exit(1);
  }
  const model = process.argv.includes("--judge")
    ? process.argv[process.argv.indexOf("--judge") + 1]
    : "z-ai/glm-5.2";

  const { truth } = await buildCorpus();
  const scenario = SCENARIOS.find((s) => s.id === "pdf-review")!;
  const questions = scenario.questions(truth);

  console.log(`judge calibration — ${model}\n`);
  let cost = 0;
  let wrong = 0;

  for (const [label, text, shouldPass] of [
    ["known-good briefing", GOOD, true],
    ["known-bad briefing", BAD, false],
  ] as const) {
    const result = await judge({
      model,
      scenario: scenario.task,
      groundTruth: groundTruthText(truth),
      evidence: { artifacts: [{ path: "/out/briefing.md", kind: "text", text }] },
      questions,
    });
    cost += result.usage.cost ?? 0;

    const passed = result.verdicts.filter((v) => v.pass).length;
    const allPass = passed === result.verdicts.length;
    const correct = shouldPass ? allPass : !allPass;
    if (!correct) wrong++;

    console.log(`  ${label}: ${passed}/${result.verdicts.length} verdicts pass — ${correct ? "CORRECT" : "*** MISCALIBRATED ***"}`);
    for (const v of result.verdicts) console.log(`      ${v.pass ? "pass" : "FAIL"} ${v.id}: ${v.reason}`);
    if (result.error) console.log(`      judge error: ${result.error}`);
    console.log();
  }

  console.log(`cost: $${cost.toFixed(4)}`);
  if (wrong > 0) {
    console.log(
      `\n${wrong} calibration failure(s). The judge cannot separate a correct briefing from one that ` +
        `presents a settled provision as current and invents a headcount — its verdicts in a real run ` +
        `would not mean anything. Fix the prompt or change the model before running the eval.`,
    );
    process.exit(1);
  }
  console.log("\nThe judge passes correct work and catches fabrication. Verdicts are worth reading.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
