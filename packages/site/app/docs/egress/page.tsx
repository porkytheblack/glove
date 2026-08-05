import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Egress Control",
  description:
    "Turn the sandbox boundary into a measured, enforced privacy boundary — QIF metering, an egress gate, and red-team simulation.",
};

export default function EgressPage() {
  return (
    <div className="docs-content">
      <h1>Egress Control</h1>

      <p>
        The one-eval-tool boundary makes an agent{" "}
        <strong>context-efficient</strong>: only the value a program returns
        enters the model&apos;s context. <code>glove-egress</code> makes that
        same boundary a <strong>privacy</strong> boundary, and gives you the
        instruments to measure it.
      </p>

      <p>
        It is built on the <a href="/docs/code-execution">function catalog</a> —
        the egress combinators are ordinary <code>ToolFn</code>s, so they mount
        on any REPL surface (<code>glove-js</code>, <code>glove-python</code>,{" "}
        <code>glove-lisp</code>).
      </p>

      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          <strong>Honest status.</strong> <code>glove-egress</code> is consumed
          by two benchmarks today, not yet by a production deployment. It is the
          tested primitive the exfiltration study concludes is needed, ready for
          the first app that wants a measured, enforced boundary.
        </p>
      </div>

      <h2 id="why">Why enforcement, not priming</h2>

      <p>
        The exfiltration study reaches one structural conclusion:{" "}
        <strong>
          a privacy boundary that depends on the model&apos;s goodwill is not a
          boundary
        </strong>
        . Voluntary &ldquo;return only decisions&rdquo; priming plateaued at a{" "}
        <strong>33% leak rate</strong>; only enforcement reached 0%. The
        consequence is that enforcement belongs in the platform — not in a
        prompt, and not copy-pasted into each app.
      </p>

      <h2 id="metering">1. QIF metering — pick the right ruler</h2>

      <p>
        The intuitive &ldquo;an assertion collapses a k-way read to log₂k
        bits&rdquo; is Shannon information — and{" "}
        <strong>Shannon is the wrong safety ruler</strong>, because it averages
        a catastrophic reveal away. All three rulers ship:
      </p>

      <ul>
        <li>
          <strong>Shannon self-information</strong> (<code>selfInfo</code>,{" "}
          <code>contentBits</code>) — a throughput headline.
        </li>
        <li>
          <strong>min-entropy / g-leakage</strong> (<code>minEntropyLeak</code>,{" "}
          <code>gLeak</code>) — the one-guess / coarse-win risk, the
          security-grounded bound.
        </li>
        <li>
          <strong>empirical canary extraction</strong> (
          <code>BoundaryMeter.report</code>) — the operational ground truth:
          which exact secrets crossed.
        </li>
      </ul>

      <CodeBlock
        filename="meter.ts"
        language="typescript"
        code={`import { BoundaryMeter, minEntropyLeak, gLeak } from "glove-egress";

const meter = new BoundaryMeter();
meter.cross("read", record);                        // record every value that crosses
meter.cross("assertion", true, { decisionSpace: 2 });

const r = meter.report(canaries);
// { bytesCrossed, bitsCrossed, canariesRecovered, secretBitsRecovered, … }`}
      />

      <h2 id="gate">2. The enforced egress gate</h2>

      <p>
        Priming a model to &ldquo;return only decisions&rdquo; is a discount,
        not a boundary. The gate makes it structural: a program{" "}
        <strong>must end in a decision</strong> built by an egress combinator,
        whose codomain is bounded by construction.
      </p>

      <CodeBlock
        filename="gate.ts"
        language="typescript"
        code={`import { egressFns, guardEffectFns, DEFAULT_EGRESS_POLICY } from "glove-egress";

// assert / count / choose / bucket / report
session.registerAll(egressFns(DEFAULT_EGRESS_POLICY));

// Effect allowlist — blocks outbound effects to off-org recipients or
// carrying secret-shaped payloads.
const guarded = guardEffectFns(catalog, DEFAULT_EGRESS_POLICY, onBlock);`}
      />

      <table>
        <thead>
          <tr>
            <th>Combinator</th>
            <th>What can cross</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>assert({"{ label, cond }"})</code>
            </td>
            <td>One bit</td>
          </tr>
          <tr>
            <td>
              <code>count({"{ label, n }"})</code>
            </td>
            <td>An integer</td>
          </tr>
          <tr>
            <td>
              <code>choose({"{ label, value, from }"})</code>
            </td>
            <td>One member of a small set</td>
          </tr>
          <tr>
            <td>
              <code>bucket({"{ label, hist }"})</code>
            </td>
            <td>A k-anonymity-suppressed histogram</td>
          </tr>
          <tr>
            <td>
              <code>report({"{ label, text }"})</code>
            </td>
            <td>Short prose with credential/PII tokens redacted</td>
          </tr>
        </tbody>
      </table>

      <p>
        A per-session <strong>min-entropy bit budget</strong> caps cumulative
        disclosure across calls (QIF composition — <em>not</em> differential
        privacy; a deterministic authoritative bit has unbounded ε). The gate
        refuses raw returns, so wiring it onto a specific eval tool — an{" "}
        <code>execute_js</code> that must return a decision — is a few lines.
      </p>

      <h2 id="redteam">3. Red-team simulation</h2>

      <p>
        Before you trust a budget, watch an adversary spend it. The simulator
        runs extraction strategies against a policy and reports what remains
        unknown:
      </p>

      <CodeBlock
        filename="redteam.ts"
        language="typescript"
        code={`import { simulateExtraction, residualGuarantee } from "glove-egress";

// Binary search pins a 1024-way secret in ~10 queries…
simulateExtraction({ N: 1024, secret: 733, strategy: "binary" });

// …unless the bit budget halts it: ≥64 candidates still remain.
simulateExtraction({ N: 1024, secret: 733, strategy: "binary", budgetBits: 4 });`}
      />

      <h2 id="study">The study</h2>

      <p>
        The design and its evaluation — Shannon vs min-entropy, canaries, four
        egress disciplines run against real models, and the delegated-judge tier
        — are written up as{" "}
        <em>The Boundary Is the Guarantee</em> in{" "}
        <a
          href="https://github.com/porkytheblack/glove/blob/main/benches/scratchpad-bench/EXFIL-PAPER.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          benches/scratchpad-bench/EXFIL-PAPER.md
        </a>
        .
      </p>

      <h2 id="related">Related</h2>

      <ul>
        <li>
          <a href="/docs/code-execution">Code Execution</a> — the surface these
          combinators mount on
        </li>
        <li>
          <a href="/docs/scratchpad">Scratchpad</a> — the catalog they guard
        </li>
      </ul>
    </div>
  );
}
