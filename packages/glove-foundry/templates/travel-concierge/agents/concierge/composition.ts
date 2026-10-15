import { composeAgent } from "glove-foundry";
import calendar from "./apps/calendar.app.js";
import tripContext from "./layers/trip-context.layer.js";
import travellerMemory from "./memory/traveller.memory.js";
import usage from "./subscribers/usage.subscriber.js";
import convertCurrency from "./tools/convert-currency.tool.js";

/**
 * The catalogue: everything this agent's instances are *allowed* to use.
 *
 * - `calendar` and `convertCurrency` are installable. They mount only on an
 *   instance that installs them (see instances.ts).
 * - `travellerMemory`, `tripContext` and `usage` are definition surfaces; they
 *   are also selected in agent.ts (`memory`, `layers`, `subscribers`).
 *
 * Composition is by value, not by string id. Rename a file and the import
 * breaks at compile time instead of failing at runtime.
 */
export const conciergeComponents = composeAgent(
  calendar,
  convertCurrency,
  travellerMemory,
  tripContext,
  usage,
);
