// Load `.env.local` / `.env` into process.env.
//
// Import this FIRST, before anything that reads a key — station's CLI does not
// load dotfiles on its own, so without this `station.config.ts` sees no
// credentials and refuses to boot, and rooms see no ELEVENLABS_API_KEY.
//
// It matters here more than in a typical app because of how the processes
// nest: the signal runner spawns each room and each research job as a CHILD
// process, and children inherit `process.env` from station. So loading once,
// in the station process, is what puts the provider keys inside every run.
//
// `.env.local` wins over `.env` — dotenv keeps the first value it sees for a
// key and never overwrites something already in the real environment, so a var
// exported in your shell still beats both files.

import { config } from "dotenv";
import path from "node:path";

/** The example root, regardless of which subdirectory a script runs from. */
const ROOT = path.resolve(import.meta.dirname, "..");

config({
  path: [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")],
  quiet: true,
});
