import { glovebox, rule, composite } from "glovebox-core";
import { agent } from "./agent";

/**
 * The wrap module. `glovebox build ./glovebox.ts` consumes this default export
 * and emits a Dockerfile + nixpacks.toml + bundled server + manifest.
 *
 * Base: glovebox/docs:1.2 — already ships pandoc, qpdf, pdftk-java,
 * ghostscript, libreoffice. We add poppler-utils for `pdftotext`.
 */
export default glovebox.wrap(agent, {
  name: "glovebox-pdf-extractor",
  version: "0.1.0",
  base: "glovebox/docs",
  packages: {
    // The docs base provides qpdf and pdftk-java; pdftotext lives in
    // poppler-utils, which isn't in the base layer.
    apt: ["poppler-utils"],
  },
  env: {
    ANTHROPIC_API_KEY: {
      required: true,
      secret: true,
      description: "API key for the Anthropic provider used by the agent.",
    },
  },
  storage: {
    // Inputs use the default policy (url first, inline fallback).
    // Outputs: small files inline, anything bigger goes through the local-server
    // adapter with a 1h TTL so the client can fetch them on demand.
    outputs: composite([rule.inline({ below: "1MB" }), rule.localServer({ ttl: "1h" })]),
  },
  limits: {
    memory: "1Gi",
    timeout: "5m",
  },
});
