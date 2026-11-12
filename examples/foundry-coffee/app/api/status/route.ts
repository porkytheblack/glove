import { modelChoice } from "../../../lib/models";
import { SHOP } from "../../../lib/shop";
import { FOUNDRY_URL, foundry } from "../../lib/server/foundry";

export const dynamic = "force-dynamic";

/** What is set up, so the page can say what will and will not work. */
export async function GET(): Promise<Response> {
  let foundryOk = false;
  try {
    foundryOk = (await foundry().health()).ok;
  } catch {
    foundryOk = false;
  }
  const model = modelChoice();
  return Response.json({
    shop: SHOP.name,
    foundry: { ok: foundryOk, url: FOUNDRY_URL },
    model: { provider: model.provider, model: model.model, demo: model.demo },
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
  });
}
