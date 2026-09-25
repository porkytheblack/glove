---
"glove-core": minor
"glove-next": minor
---

Add the Vercel AI Gateway as a built-in provider. `createAdapter({ provider: "vercel", model: "anthropic/claude-sonnet-4" })` and `createChatHandler({ provider: "vercel" })` route through `https://ai-gateway.vercel.sh/v1` using `AI_GATEWAY_API_KEY`. Inside a Vercel deployment they fall back to the `VERCEL_OIDC_TOKEN` that Vercel injects. With `cache` enabled, `cache_control` breakpoints are placed at the message level, the shape the gateway documents, so they reach Anthropic models upstream.

`ProviderDef` gains an optional `fallbackEnvVars` list, and the new `resolveProviderApiKey(def)` helper reads `envVar` first, then each fallback in order.
