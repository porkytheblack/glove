---
"glove-working-environment": minor
---

`definePureModule` — a host npm package exposed to scripts **synchronously**, in one declaration.

```ts
const env = await createWorkingEnvironment({
  stdlib: [
    documents(),
    definePureModule({
      name: "lodash",
      from: "lodash",
      description: "Lodash utilities for shaping data.",
      pick: ["groupBy", "sumBy", "orderBy", "uniqBy", "camelCase", "cloneDeep"],
    }),
  ],
});
```

Scripts then write ordinary lodash — `rows.map(r => camelCase(r.name))`, no await, inside callbacks — and it works, because the package is imported *inside the worker* and bound directly into the vm context, the same route `env:std` takes. No bundling, no hand-written types, no VFS bytes: accurate synchronous declarations and a README with the import line are generated at creation, and every `pick` name is verified against the real module then, so a typo fails with the available names rather than as `undefined` in a script.

Why this exists as a third route beside adapters and builders: adapter calls cross a thread, so they are async — right for I/O, silently wrong for a library whose idiom is synchronous. Measured before building this: routing lodash through an adapter made muscle-memory code stringify promises as `{}` while the run reported success. Sync is the forgiving direction — `await` on a plain value is a no-op, so **there is no syntax for a model to get wrong**, which is the design goal.

The boundary work, each rule held by a test:

- `pick` is required and is the sandbox boundary — these functions run in the worker's realm, outside the vm. The genuinely dangerous class is string-to-code members (`_.template` runs `Function(source)` host-side); never pick one. Prototype members are refused at definition time.
- Callbacks cross inward (`sumBy(rows, r => r.n)` works) and returned functions cross back as guarded context-realm wrappers — `memoize` works, and its constructor chain dead-ends inside the sandbox.
- Wrong names are corrected at *write time*, before a run is spent, exactly like any other module; a wrong `pick` or unresolvable `from` fails at environment creation naming the fix.
- Pure modules survive worker replacement: the respawned worker re-imports them from its start message.

Route by shape: I/O or genuinely async → `defineAdapter`. A stateful builder written at the end → `defineBuilder`. Pure synchronous computation → `definePureModule`.
