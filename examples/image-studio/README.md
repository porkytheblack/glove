# image-studio

An art-director agent built on [`glove-image`](../../packages/glove-image) — the
smallest complete tour of agentic image generation.

```bash
export OPENROUTER_API_KEY=sk-or-...          # https://openrouter.ai/keys
pnpm --filter glove-image-studio start
```

Talk to it in plain language. It decides when to save a character, generate,
edit, regenerate, or assemble. Everything it makes is written to `./out`.

```
> create a character called mira, a wiry sky-courier with a patched flight jacket
  [tool] glove_image_character_save
  Saved "mira".

> draw her landing at a neon night market
  [tool] glove_image_generate
  [spend] enhance: 1 req, 180→96 tok
  [spend] generate: 1 req, 51→1310 tok, $0.0387
  [saved] ./out/mira-market-landing.png

> same but at dawn
  [tool] glove_image_regenerate
  [saved] ./out/mira-market-dawn.png

> /cost
{ "total": { "requests": 3, "cost_usd": 0.0775 }, "by_source": { ... } }
```

## What it demonstrates

| Concept | Where |
|---------|-------|
| The prompt pipeline — characters, scenes, style, LLM rewrite, `fitToModel` | the `pipeline` array in `index.ts` |
| Durable characters and scenes | the agent calls `glove_image_character_save` / `_scene_save` on its own |
| Lineage and replay | `glove_image_regenerate` on "same but ..." requests |
| Cost tracking at four scopes | the `onUsage` callback, the `UsageMeter`, and `/cost` |
| Storage seams | `InMemoryImageAssetStore` / `InMemoryImageLibrary` — the two things you swap in production |
| Opt-in vision | the commented-out `review` block |

`/cost` prints the session report. Uncomment the `review` block to give the
agent eyes — it will then critique and refine its own generations, at roughly
25k input tokens per look.

## Notes

- The default image model is `google/gemini-2.5-flash-image` through OpenRouter;
  change `openrouterImages({ model })` for any other image-output model.
- `sharp` is installed here so `glove_image_assemble` works (contact sheets,
  before/after comparisons). It is an optional peer of the package.
- Both stores are in-memory: the library and every asset are lost on exit.
  `./out` is what survives.

See the [image workflows guide](https://glove.dterminal.net/docs/image) for the
full design.
