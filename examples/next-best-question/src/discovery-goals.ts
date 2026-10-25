import { defineGoalProgram } from "glove-memory/goals";
import type { GoalPlanConfig } from "./goals";

/**
 * A sales discovery call as a goal program. Written in the order a playbook
 * would use; prospects rarely follow it.
 */
export const discovery = defineGoalProgram({
  key: "discovery",
  goals: [
    {
      key: "context", title: "Understand the business", objective: "Know who they are and what they use today",
      items: [{ key: "size", label: "Team size" }, { key: "tools", label: "Current tools" }],
    },
    {
      key: "pain", title: "Understand the problem", objective: "Know what is going wrong and what it costs",
      items: [{ key: "problem", label: "Main problem" }, { key: "impact", label: "What it costs them" }],
    },
    {
      key: "budget", title: "Qualify the budget", objective: "Know what they can spend and who signs off",
      items: [{ key: "range", label: "Budget range" }, { key: "approver", label: "Who approves the spend" }],
    },
    {
      key: "timeline", title: "Agree a timeline", objective: "Know when they need it working",
      items: [{ key: "date", label: "Go-live date" }],
    },
  ],
});

/** Worded for a small NLI model; see `claimPlan` for why statements read as answers. */
export const discoveryPlan: GoalPlanConfig = {
  covered: {
    "context/size": "The speaker's company has a stated number of employees.",
    "context/tools": "The speaker mentions software they use.",
    "pain/problem": "The speaker describes a problem they have.",
    "pain/impact": "The problem loses the speaker a stated amount of money or time.",
    "budget/range": "The speaker names a budget figure.",
    "budget/approver": "The speaker says who approves spending.",
    "timeline/date": "The speaker says when they need it working.",
  },
  groups: {
    context: "The speaker is describing their company.",
    pain: "The speaker is complaining about a problem.",
    budget: "The speaker wants to know the price.",
    timeline: "The speaker is talking about a deadline.",
  },
};
