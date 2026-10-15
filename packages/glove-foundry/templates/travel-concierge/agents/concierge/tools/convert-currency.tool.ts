import { Effect } from "effect";
import { defineSharedTool } from "glove-foundry";
import { z } from "zod";

/**
 * A shared tool is installable: it is in the agent's catalogue (composition.ts)
 * but mounts only on instances that install it — see `instances.ts`, where the
 * demo instance installs it with a home currency. One file, one default export,
 * and the filename is the id: `convert-currency`.
 *
 * The rates are fixed sample values. Replace `RATES` with a live rate source.
 */
const RATES: Readonly<Record<string, number>> = { USD: 1, EUR: 0.92, GBP: 0.79, KES: 129 };

const convertCurrency = defineSharedTool({
  description: "Convert a USD price into the traveller's home currency",
  config: z.object({ home: z.enum(["USD", "EUR", "GBP", "KES"]).default("USD") }),
  create: ({ config }) => Effect.sync(() => {
    const rate = RATES[config.home]!;
    return {
      name: "convert_currency",
      description: `Convert an amount in USD into ${config.home}, the traveller's home currency.`,
      inputSchema: z.object({ amountUsd: z.number().describe("Price in USD") }),
      async do({ amountUsd }: { amountUsd: number }) {
        return {
          status: "success" as const,
          data: { currency: config.home, amount: Math.round(amountUsd * rate * 100) / 100, rate },
        };
      },
    };
  }),
});

export default convertCurrency;
