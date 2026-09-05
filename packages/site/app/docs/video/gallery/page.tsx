import { CodeBlock } from "@/components/code-block";
import { videoBrandGallery } from "@/lib/video-brand-gallery-data";

export const metadata = {
  title: "Aethel — an agent-directed video campaign",
  description:
    "A recorded glove-video campaign: recurring model references, three locations, provider fallbacks, full-clip reviews, a sequence delivery gate, and reconciled spend.",
};

type Attempt = (typeof videoBrandGallery.attempts)[number];

const passingScore = 82;
const taskBudgetUsd = 10;
// Reconciled from the OpenRouter account after the complete task. This includes
// director/reviewer calls that media recipe meters intentionally do not price.
const accountReconciledTaskSpendUsd = 9.34005964;

function blockingIssues(attempt: Attempt) {
  return attempt.review?.issues.filter((issue) => issue.severity !== "minor") ?? [];
}

export default function VideoGalleryPage() {
  const finalAttempts = videoBrandGallery.attempts.filter((attempt) =>
    attempt.file.startsWith("brand-veo-take-"),
  );
  const passingFinal = finalAttempts.find((attempt) => attempt.review?.decision === "pass");
  const totalSeconds = videoBrandGallery.attempts.reduce((sum, attempt) => sum + attempt.duration, 0);
  const mediaCost = videoBrandGallery.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0) +
    videoBrandGallery.references.reduce((sum, reference) => sum + reference.costUsd, 0);
  const reviewed = videoBrandGallery.attempts.filter((attempt) => attempt.review);

  return (
    <div className="docs-content video-gallery-page">
      <div className="video-gallery-kicker">AETHEL · ONE MODEL · THREE SCENES · A GATE THAT SAID NO</div>
      <h1>The campaign looks real.<br />So does the rejection evidence.</h1>

      <p className="video-gallery-lede">
        A Glove agent invented a fictional fashion brand, cast a recurring adult
        model, designed an oxidized-copper hero trench, created the identity pack,
        directed seven videos across two generators, and inspected every MP4. One
        final scene passed. The three-scene campaign did not—so the sequence delivery
        tool withheld it.
      </p>

      <div className="video-gallery-runbar">
        <span><small>SEQUENCE STATE</small>GATE HELD</span>
        <span><small>FINAL SHOTS</small>1 / 3 passed</span>
        <span><small>GENERATED</small>{totalSeconds.toFixed(0)} video seconds</span>
        <span><small>TASK SPEND</small>${accountReconciledTaskSpendUsd.toFixed(2)} / ${taskBudgetUsd.toFixed(2)}</span>
      </div>

      {passingFinal && (
        <section className="video-gallery-hero" aria-labelledby="passing-shot">
          <div className="video-gallery-hero-copy">
            <span className="video-status pass">SHOT PASS · {passingFinal.review!.score}/100</span>
            <h2 id="passing-shot">Blue hour cleared the shot gate</h2>
            <p>{passingFinal.review!.summary}</p>
            <dl>
              <div><dt>Generator</dt><dd>Veo 3.1 Fast</dd></div>
              <div><dt>Format</dt><dd>{passingFinal.width}×{passingFinal.height} · {passingFinal.duration.toFixed(0)}s</dd></div>
              <div><dt>Audio</dt><dd>{passingFinal.hasAudio ? "present" : "none"}</dd></div>
              <div><dt>Generation</dt><dd>${passingFinal.costUsd.toFixed(2)}</dd></div>
            </dl>
          </div>
          <video controls playsInline loop preload="metadata">
            <source src={`/video-gallery/${passingFinal.file}`} type="video/mp4" />
          </video>
        </section>
      )}

      <section className="video-gallery-held" aria-labelledby="held-campaign">
        <span className="video-status held">CAMPAIGN NOT PUBLISHED</span>
        <div>
          <h2 id="held-campaign">A passing clip is not a passing sequence.</h2>
          <p>
            The rooftop passed at 88. The studio missed required living camera
            motion; the city coat changed length and grew an unstable trailing
            strap. <code>glove_video_flow_deliver</code> rechecked every selected
            shot and refused to reveal the campaign.
          </p>
        </div>
        <strong>ALL SHOTS OR NONE</strong>
      </section>

      <h2 id="identity">The agent created the model before it shot the model</h2>
      <p>
        These are not gallery decorations. Three of the generated images became
        identity inputs to every Veo shot and independent comparison evidence for
        the Qwen reviewer. The recurring definition also locked face, hair, skin
        tone, performance, coat color, silhouette, and failure negatives.
      </p>
      <div className="video-brand-references">
        {videoBrandGallery.references.slice(0, 8).map((reference, index) => (
          <figure key={reference.id}>
            <img src={`/video-gallery/${reference.file}`} alt={`Aethel model identity reference ${index + 1}`} />
            <figcaption>REF {String(index + 1).padStart(2, "0")} · {reference.width}×{reference.height}</figcaption>
          </figure>
        ))}
      </div>

      <h2 id="final-sequence">The final three-scene candidate</h2>
      <p>
        Each clip is playable because this page is an audit artifact, not the
        agent&apos;s delivery channel. The cards show the latest identity-aware verdict
        that controlled whether the assembled campaign could ship.
      </p>
      <div className="video-filmstrip video-final-filmstrip">
        {finalAttempts.map((attempt, index) => {
          const passed = attempt.review?.decision === "pass";
          return (
            <article className={`video-film-card ${passed ? "pass" : "revise"}`} key={attempt.id}>
              <div className="video-film-frame">
                <video controls playsInline loop preload="metadata">
                  <source src={`/video-gallery/${attempt.file}`} type="video/mp4" />
                </video>
              </div>
              <div className="video-film-meta">
                <span>SCENE {String(index + 1).padStart(2, "0")} · {attempt.shot}</span>
                <strong>{attempt.review ? `${attempt.review.score}/100 · ${attempt.review.decision}` : "UNREVIEWED"}</strong>
                <p>{attempt.review?.summary ?? "No review was recorded."}</p>
                <small>{blockingIssues(attempt).length} blocking findings</small>
              </div>
            </article>
          );
        })}
      </div>

      <h2 id="model-routing">Why the agent changed models</h2>
      <p>
        “Best model” was treated as a capability decision, not a leaderboard
        slogan. Every switch followed an observed constraint and remained in the
        evidence ledger.
      </p>
      <table className="video-model-table">
        <thead><tr><th>Layer</th><th>Decision</th><th>Observed reason</th></tr></thead>
        <tbody>
          <tr>
            <td>Inspector</td>
            <td>Qwen 3.5 Flash</td>
            <td>Cheap Chinese multimodal model; returned structured, timestamped frame evidence. Xiaomi MiMo V2.5 accepted the request but did not finish the smoke review in five minutes.</td>
          </tr>
          <tr>
            <td>First generator</td>
            <td>Seedance 2.0</td>
            <td>Chosen for reference continuity. Its provider rejected the synthetic photoreal identity inputs as possible real-person privacy content, so the agent recorded the error and fell back.</td>
          </tr>
          <tr>
            <td>Final generator</td>
            <td>Veo 3.1 Fast</td>
            <td>Accepted three person references with person generation enabled. Live execution revealed that reference-to-video requires eight seconds even though the general catalog advertises 4/6/8.</td>
          </tr>
          <tr>
            <td>Delivery</td>
            <td>Sequence gate</td>
            <td>Every selected shot needs pass ≥ {passingScore}, no major/critical issue, and a latest actual-video review. Two failures held the campaign.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="decision-ledger">The final decision ledger</h2>
      <p>
        The reviewer saw chronological frames sampled every 0.5 seconds plus all
        three identity images. A score is only an index; publication is determined
        from the decision, threshold, and severity of concrete findings.
      </p>
      <div className="video-review-ledger">
        {finalAttempts.map((attempt, index) => {
          const review = attempt.review;
          if (!review) return null;
          const blockers = blockingIssues(attempt);
          const scoreDeficit = Math.max(0, passingScore - review.score);
          return (
            <article className="video-review-entry" key={`review-${attempt.id}`}>
              <header>
                <div>
                  <span>SCENE {String(index + 1).padStart(2, "0")} · ACTUAL-MP4 REVIEW</span>
                  <strong className="video-review-title">
                    {review.decision === "pass" ? "Cleared as an individual shot" : "Held for revision"}
                  </strong>
                </div>
                <div className="video-review-score" aria-label={`${review.score} out of 100`}>
                  <strong>{review.score}</strong><span>/100</span>
                  <i><b style={{ width: `${review.score}%` }} /></i>
                </div>
              </header>
              <div className="video-review-rules">
                <span className={review.decision === "pass" ? "ok" : "no"}>decision: {review.decision}</span>
                <span className={scoreDeficit === 0 ? "ok" : "no"}>
                  threshold: {scoreDeficit === 0 ? "met" : `${scoreDeficit} points short`}
                </span>
                <span className={blockers.length === 0 ? "ok" : "no"}>blocking issues: {blockers.length}</span>
              </div>
              <p className="video-review-summary">{review.summary}</p>
              <div className="video-review-strengths">
                <span>WHAT SURVIVED REVIEW</span>
                <ul>{review.strengths.map((strength) => <li key={strength}>{strength}</li>)}</ul>
              </div>
              <div className="video-review-issues">
                {review.issues.map((issue, issueIndex) => (
                  <section key={`${issue.criterion}-${issueIndex}`}>
                    <div>
                      <span className={`video-severity ${issue.severity}`}>{issue.severity}</span>
                      <strong>{issue.criterion}</strong>
                    </div>
                    <dl>
                      <div><dt>Evidence</dt><dd>{issue.evidence}</dd></div>
                      <div><dt>Required fix</dt><dd>{issue.fix}</dd></div>
                    </dl>
                  </section>
                ))}
              </div>
              {"revisionPrompt" in review && review.revisionPrompt && (
                <details className="video-revision-prompt">
                  <summary>Revision prompt produced from the evidence</summary>
                  <pre>{review.revisionPrompt}</pre>
                </details>
              )}
              <footer>reviewer · {review.reviewer}</footer>
            </article>
          );
        })}
      </div>

      <h2 id="pipeline">What Glove added around the model call</h2>
      <table>
        <thead><tr><th>Stage</th><th>Durable output</th><th>Why it matters</th></tr></thead>
        <tbody>
          <tr><td>Creative direction</td><td>Aethel, model definition, hero coat, three scenes</td><td>The human asked for the outcome; the agent supplied the campaign.</td></tr>
          <tr><td>Identity</td><td>8 generated references; 3 selected anchors</td><td>The same visual contract feeds generation and independent review.</td></tr>
          <tr><td>Flow</td><td>Structured shots, timed beats, parameters, lineage</td><td>Three jobs remain one resumable production rather than unrelated prompts.</td></tr>
          <tr><td>Inspection</td><td>{reviewed.length} stored verdicts with evidence and revision prompts</td><td>A provider success never becomes an automatic creative success.</td></tr>
          <tr><td>Delivery</td><td>All-or-nothing sequence decision</td><td>One passing hero clip cannot conceal two campaign-breaking shots.</td></tr>
        </tbody>
      </table>

      <h2 id="receipts">The receipts</h2>
      <table>
        <thead><tr><th>Measure</th><th>Recorded value</th></tr></thead>
        <tbody>
          <tr><td>Identity references generated</td><td>{videoBrandGallery.references.length}</td></tr>
          <tr><td>Video drafts generated and reviewed</td><td>{videoBrandGallery.attempts.length}</td></tr>
          <tr><td>Generated video duration</td><td>{totalSeconds.toFixed(1)} seconds</td></tr>
          <tr><td>Recipe-attributed media cost</td><td>${mediaCost.toFixed(4)}</td></tr>
          <tr><td>Account-reconciled complete task</td><td><strong>${accountReconciledTaskSpendUsd.toFixed(4)} / ${taskBudgetUsd.toFixed(2)}</strong></td></tr>
          <tr><td>Unspent hard limit</td><td>${(taskBudgetUsd - accountReconciledTaskSpendUsd).toFixed(4)}</td></tr>
        </tbody>
      </table>

      <div className="gallery-note">
        The account figure includes earlier experiments, model-selection smoke tests,
        director calls, video generation, and reviewers. Keys are read at runtime and
        never written into the gallery data or client bundle.
      </div>

      <h2 id="code">The delivery rule is code, not a suggestion</h2>
      <CodeBlock
        filename="campaign-policy.ts"
        language="typescript"
        code={`// The agent chooses the concept and runs the production.
await agent.processRequest("Create one recurring brand model across three scenes.");

// Each selected shot must have a latest passing actual-video review.
await glove_video_flow_deliver({
  run: campaignRun,
  replacements: revisedShots,
});

// The tool refuses the entire sequence when any shot is unreviewed,
// below threshold, marked revise, or has a major/critical issue.`}
      />

      <p>
        That is the point of <code>glove-video</code>: not pretending every expensive
        generation is good, but giving an agent enough memory, tools, evidence, and
        authority to run the creative process—and enough policy to stop it from
        shipping what it should know you will reject.
      </p>
    </div>
  );
}
