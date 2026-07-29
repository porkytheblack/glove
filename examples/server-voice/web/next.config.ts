// Next loads `.env.local` from its OWN directory, but this example keeps one
// env file at the root next to `.env.example` — so pull that in as well.
//
// dotenv never overwrites a value already in `process.env`, and Next reads its
// own dotfiles before evaluating this config, so precedence ends up as:
//
//   shell  >  web/.env.local  >  ../.env.local  >  ../.env
//
// Both sides read what lands here: the room-allocation route at request time
// (same process), and any NEXT_PUBLIC_* inlined at build, which happens after
// this file runs.

import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

const EXAMPLE_ROOT = path.resolve(import.meta.dirname, "..");

loadEnv({
  path: [path.join(EXAMPLE_ROOT, ".env.local"), path.join(EXAMPLE_ROOT, ".env")],
  quiet: true,
});

const config: NextConfig = {};
export default config;
