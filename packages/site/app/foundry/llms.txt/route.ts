import { buildFoundryLlmsTxt } from "@/lib/foundry-llms";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildFoundryLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, must-revalidate",
    },
  });
}
