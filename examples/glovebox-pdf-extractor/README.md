# glovebox-pdf-extractor

A canonical Glovebox example: a Glove agent that extracts text and structural
metadata from PDFs by shelling out to native binaries (`pdftotext`, `qpdf`,
`pdftk`) and returns the results to a remote client over a single
authenticated WebSocket.

This is the example to read first if you want to understand how Glovebox is
meant to be used end-to-end. Source layout:

```
agent.ts      — Glove instance: model, store, system prompt, tool registration
tools.ts      — extract_text / extract_metadata / split_pages
glovebox.ts   — glovebox.wrap(...) — base image, packages, storage, limits
dev.ts        — local runtime (no docker, no `glovebox build`)
client.ts     — Node CLI demo client using glovebox-client
```

## What the agent does

A user uploads a PDF. The agent picks the right tool(s) and writes the results
to `/output`, where the kit picks them up and ships them back to the client
according to the configured storage policy.

| Tool | Native binary | Reads | Writes |
|------|---------------|-------|--------|
| `extract_text` | `pdftotext` (poppler-utils) | `/input/<file>.pdf` | `/output/<basename>.txt` |
| `extract_metadata` | `qpdf --json --no-original-object-ids` | `/input/<file>.pdf` | `/output/<basename>.metadata.json` |
| `split_pages` | `pdftk … cat <range> output` | `/input/<file>.pdf` | `/work/<basename>-pages-<range>.pdf` |

`split_pages` writes to `/work` on purpose — it's a scratch area that does
**not** get exfiltrated. The user explicitly tags the file for return by
invoking the `/output <path>` hook (registered automatically by `glovebox-kit`).

## Why this exercises Glovebox

* Native binaries (`pdftotext`, `qpdf`, `pdftk`) — exactly the kind of thing
  you don't want to run in your host process.
* File **inputs** (PDFs uploaded by the client) and file **outputs** (txt, JSON,
  optionally split PDFs).
* The `glovebox/docs:1.2` base image (already ships `qpdf` and `pdftk-java`).
  We add `poppler-utils` for `pdftotext` to demonstrate `packages.apt`.
* Composite output storage policy: small files inline, larger files served via
  the local-server adapter with a 1h TTL.
* The `/output` hook for tagging non-`/output` files for exfiltration — wired
  up by `applyInjections` in `glovebox-kit`.

## Files at a glance

### `glovebox.ts`

```ts
import { glovebox, rule, composite } from "glovebox-core";
import { agent } from "./agent";

export default glovebox.wrap(agent, {
  name: "glovebox-pdf-extractor",
  base: "glovebox/docs",
  packages: { apt: ["poppler-utils"] },
  env: { ANTHROPIC_API_KEY: { required: true, secret: true } },
  storage: {
    outputs: composite([rule.inline({ below: "1MB" }), rule.localServer({ ttl: "1h" })]),
  },
  limits: { memory: "1Gi", timeout: "5m" },
});
```

### `agent.ts`

A vanilla Glove instance using `createAdapter({ provider: "anthropic", stream: true })`,
a `SqliteStore` at `/work/glove.db`, and `serverMode: true`. The system prompt
documents each tool and the `/output` hook contract.

### `tools.ts`

Each tool is a plain `GloveFoldArgs<I>` (no display, no permissions). Each one
shells out via `node:child_process.execFile`, captures `stdout` / `stderr` /
exit code, and returns `ToolResultData` with `status: "success" | "error"`. On
non-zero exit the stderr ends up on `message`. Inputs are read from `/input`,
outputs written to `/output` (or `/work` for `split_pages`).

## Running it locally (no docker)

```bash
# from the repo root
pnpm install
export ANTHROPIC_API_KEY=sk-ant-...
pnpm --filter glovebox-pdf-extractor dev
```

`dev.ts` boots `glovebox-kit/startGlovebox` directly against a temp filesystem
(no `/input`/`/output`/`/work` mounts on your host). It synthesizes a manifest,
generates a one-shot `GLOVEBOX_KEY` if you didn't set one, and prints the key
on stdout. Use that key in another shell when running the client.

## Running it with `glovebox build`

```bash
pnpm --filter glovebox-pdf-extractor build
# Produces ./dist/{Dockerfile, nixpacks.toml, glovebox.json, glovebox.key, server/}
```

To run the produced image locally:

```bash
docker build -t glovebox-pdf-extractor ./dist
docker run --rm -p 8080:8080 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e GLOVEBOX_KEY="$(cat ./dist/glovebox.key)" \
  glovebox-pdf-extractor
```

Deploy the same artifact to any host that can run an OCI image (Fly, Railway,
ECS, etc.). The container exposes a single WebSocket on port 8080.

## Calling the agent from the client

```bash
export GLOVEBOX_KEY=...   # match what the server is using
tsx ./client.ts ws://localhost:8080 path/to/sample.pdf
```

(Replace `path/to/sample.pdf` with any local PDF. This repo doesn't ship one.)

The client:

1. Calls `GET /environment` to print the box's metadata.
2. Reads the PDF from disk and uploads it via `box.prompt(text, { files })`.
   The default client storage wraps small files inline and falls back to URL
   refs for large ones.
3. Iterates `result.events` and prints `text_delta`, `tool_use`,
   `tool_use_result`, and `model_response_complete` events.
4. Awaits `result.message` (final assistant text) and `result.outputs`
   (`Record<string, FileRef>`), reads each output via `result.read(name)`, and
   writes it to `./outputs/`.

## Wire traffic — what to expect

```
→ {"type":"prompt","id":"req_1","text":"Extract the text and structural metadata…","inputs":{"sample.pdf":{"kind":"inline",...}}}
← {"type":"event","id":"req_1","event_type":"text_delta","data":{"text":"I'll start by"}}
← {"type":"event","id":"req_1","event_type":"tool_use","data":{"name":"extract_text","input":{"file":"sample.pdf"}}}
← {"type":"event","id":"req_1","event_type":"tool_use_result","data":{"tool_name":"extract_text","result":{"status":"success",...}}}
← {"type":"event","id":"req_1","event_type":"tool_use","data":{"name":"extract_metadata","input":{"file":"sample.pdf"}}}
← {"type":"event","id":"req_1","event_type":"tool_use_result","data":{"tool_name":"extract_metadata","result":{"status":"success",...}}}
← {"type":"event","id":"req_1","event_type":"model_response_complete","data":{...}}
← {"type":"complete","id":"req_1","message":"Extracted 12 pages…","outputs":{"sample.txt":{"kind":"inline",...},"sample.metadata.json":{"kind":"inline",...}}}
```

## Sample transcript

```
$ tsx ./client.ts ws://localhost:8080 ./sample.pdf
Connected to glovebox-pdf-extractor@0.1.0 (base=glovebox/docs)
I'll inspect the file then run both tools.
[tool_use] extract_text {"file":"sample.pdf"}
[tool_use_result] extract_text → success
[tool_use] extract_metadata {"file":"sample.pdf"}
[tool_use_result] extract_metadata → success
Done. Wrote sample.txt (12 pages, 28 414 chars) and sample.metadata.json.
[turn_complete]

─── final message ─────────────────────────────
Done. Wrote sample.txt (12 pages, 28 414 chars) and sample.metadata.json.

─── outputs ───────────────────────────────────
  sample.txt           (inline, 28414 bytes) → ./outputs/sample.txt
  sample.metadata.json (inline, 612 bytes)   → ./outputs/sample.metadata.json
```

## Asking for a page split

```
> Split pages 3-5 of sample.pdf and return the result.
[tool_use] split_pages {"file":"sample.pdf","range":"3-5"}
[tool_use_result] split_pages → success
> /output /work/sample-pages-3-5.pdf
```

The `/output` token is parsed by the hook `glovebox-kit` registers — it adds
the path to the per-request exfil set, the kit picks up the file at end of
turn, and uploads it through the configured outputs policy.

## Env vars

| Var | Required | Notes |
|-----|----------|-------|
| `ANTHROPIC_API_KEY` | yes | Provider key for the agent's model adapter. |
| `GLOVEBOX_KEY` | yes | Bearer token clients send on connect. The build CLI generates one in `dist/glovebox.key`. |
| `GLOVEBOX_ENDPOINT` | no | Default endpoint for `client.ts` if argv 1 is omitted. |

## Limits

`limits: { memory: "1Gi", timeout: "5m" }` is plenty for the included tools.
Bump `memory` if you hand the agent very large PDFs (qpdf's JSON dump scales
with the document's object table).
