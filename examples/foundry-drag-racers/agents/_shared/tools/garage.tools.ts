import type { GloveFoldArgs } from "glove-core";
import { z } from "zod";
import { RACERS, type RacerId, type RacerProfile } from "../../../lib/racers.js";

export function garageTools(profile: RacerProfile): ReadonlyArray<GloveFoldArgs<any>> {
  return [
    {
      name: "inspect_my_car",
      description: "Read the racer's exact car, power, performance, and setup facts before answering a technical question.",
      inputSchema: z.object({}),
      async do() {
        return { status: "success" as const, data: profile.car };
      },
    },
    {
      name: "share_garage_photo",
      description: "Return the racer's generated garage portrait when the caller asks to see the racer or car.",
      inputSchema: z.object({}),
      async do() {
        return {
          status: "success" as const,
          data: { racer: profile.name, car: profile.car.name, image: profile.image, generatedForThisExample: true },
        };
      },
    },
    {
      name: "size_up_rival",
      description: "Get this racer's candid, fictional opinion of another racer in the paddock.",
      inputSchema: z.object({ racerId: z.enum(["jax-redline", "maya-nitro", "kenji-ghost"]) }),
      async do(input) {
        const { racerId } = input as { racerId: RacerId };
        const rival = RACERS.find((item) => item.id === racerId)!;
        return {
          status: "success" as const,
          data: { rival: rival.name, nickname: rival.nickname, opinion: profile.opinions[racerId] },
        };
      },
    },
  ];
}
