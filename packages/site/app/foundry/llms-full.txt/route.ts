import { FOUNDRY_LLMS_FULL } from "@/lib/foundry-llms";

export const dynamic = "force-static";

export function GET() {
  return new Response(FOUNDRY_LLMS_FULL, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, must-revalidate",
    },
  });
}
