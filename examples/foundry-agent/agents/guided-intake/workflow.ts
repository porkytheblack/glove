import { z } from "zod";
import { defineGoalProgram } from "glove-memory/goals";
import { defineForm, FormRegistry } from "glove-memory/forms";

export const nameRequirement = { key: "name", label: "Record the user's name" };
export const identityGoal = { key: "identity", title: "Get acquainted", objective: "Learn how to address the user", items: [nameRequirement] };
export const intakeGoals = defineGoalProgram({ key: "intake", goals: [identityGoal] });
export const intakeForm = defineForm({
  id: "intake", version: 1, name: "Introduction", description: "Collect the name the user wants us to use.",
}).step("identity", { title: "Introduction" }, step => step.field("name", { schema: z.string().min(1), label: "Preferred name" })).build();
export const intakeForms = new FormRegistry().register(intakeForm.id, {
  name: intakeForm.name, description: intakeForm.description, load: () => intakeForm,
});
