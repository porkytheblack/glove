import { museOf, personaOf, plansState } from "../../server/muse";
import { orNotFound, pagePerson } from "../../server/signed-in";
import { DoneToday } from "../../ui/DoneToday";

const MARKS = { done: "Done", next: "Next", todo: "To do", later: "Put off", skipped: "Skipped" } as const;

export default async function PlansPage() {
  const person = await pagePerson();
  const name = personaOf(await orNotFound(museOf(person.id))).name;
  const { plans, planned, done } = await plansState(person.id);
  return (
    <>
      <header className="head">
        <h1>Plans</h1>
        <span className="sub">What {name} is working toward, and everything it did and will do.</span>
      </header>
      <main className="main">
        {plans.length === 0 ? (
          <section className="card">
            <h2>No plans yet</h2>
            <span className="note">Give {name} a goal, like a trip or a race, and it makes a plan you can follow here.</span>
          </section>
        ) : null}
        {plans.map((plan) => (
          <section key={plan.key} aria-labelledby={`plan-${plan.key}`} className="card">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <h2 id={`plan-${plan.key}`}>{plan.title}</h2>
              <span className="status" style={{ flex: "none" }}>{plan.done} of {plan.total}</span>
            </div>
            <ul className="steps">
              {plan.steps.map((step) => (
                <li key={step.key}>
                  <span role="img" aria-label={MARKS[step.state]} className={`mark ${step.state}`} />
                  <span className={step.state === "done" || step.state === "skipped" ? "done-text" : undefined}>
                    {step.label}{step.state === "later" ? <span className="muted"> · put off</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section aria-labelledby="log" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 id="log" style={{ margin: 0, padding: "0 4px", fontSize: 16, fontWeight: 600 }}>Log</h2>
          <div className="card" style={{ gap: 8 }}>
            <span className="label">PLANNED</span>
            {planned.length === 0 ? <span className="note">Nothing planned.</span> : (
              <ul className="list">
                {planned.map((line, index) => <li key={index}>{line}</li>)}
              </ul>
            )}
          </div>
          <DoneToday entries={done} />
        </section>
      </main>
    </>
  );
}
