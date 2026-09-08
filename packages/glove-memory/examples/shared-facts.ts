/** Use one evidence store for both workflows. Supply your own runnable, model
 * and durable adapters in production; the reference adapters are process-local. */
import type { ModelAdapter } from "glove-core";
import { z } from "zod";
import { FactStore, FactPreparation, InMemoryFactAdapter, createModelPreparation, useFacts } from "glove-facts";
import { defineForm, defineGoalProgram, FormRegistry, MemorySchema, InMemoryFormAdapter, InMemoryGoalAdapter } from "glove-memory";
import { useFormRunner, useGoalRunner, type FormEnableTarget } from "glove-memory/tools";

export async function sharedEvidence(glove: FormEnableTarget, preparationModel: ModelAdapter, currentMessageId: () => string) {
  const subject = "tenant:1/client:2";
  const facts = new FactStore(new InMemoryFactAdapter(), { scope: { subject, context: "matter:3" } });
  useFacts(glove, facts, () => {
    const id = currentMessageId();
    return { source: { kind: "message", id }, operationId: id };
  });
  const preparer = new FactPreparation(facts, { enabled: true, inference: createModelPreparation(preparationModel) });
  const rule = { kind: "information" as const, criteria: "Client's preferred contact email" };
  const registry = new FormRegistry().register("contact", {
    name: "Contact", description: "Client contact details",
    load: () => defineForm({ id: "contact", version: 1, name: "Contact", description: "Client contact details" })
      .step("details", { title: "Contact details" }, s => s.field("email", { label: "Email", schema: z.email() })).build(),
  });
  const { runner: forms } = useFormRunner(glove, new InMemoryFormAdapter({ schema: new MemorySchema() }), {
    registry, subject, preparation: { preparer, rule: field => field.id === "email" ? rule : undefined },
  });
  const { runner: goals } = useGoalRunner(glove, new InMemoryGoalAdapter(), {
    scope: { subject, key: "intake" }, preparation: { preparer, rule: (_goal, item) => item.key === "email" ? rule : undefined },
  });
  await facts.record({ text: "Ada's preferred contact email is ada@example.com.", value: "ada@example.com",
    source: { kind: "document", id: "contract:contact-details" }, verification: "verified",
  }, { operationId: "contract:contact-details/email" });
  await goals.start(defineGoalProgram({ key: "intake", goals: [{ key: "contact", title: "Contact", objective: "Know how to contact the client", items: [{ key: "email", label: "Preferred email" }] }] }));
  await forms.start("contact");
  return { facts, preparer, forms, goals };
}
