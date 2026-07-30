// ─────────────────────────────────────────────────────────────────────────────
// The vocabulary this room biases its recognizer towards.
//
// Scribe accepts a `keyterms` list, and it is the most effective accuracy lever
// the API exposes. It earns its keep twice over here:
//
//   • Proper nouns. "Kestrel", "Nimbus", "Borehound", "Meridian Yards" are not
//     words a general model expects, and a showroom conversation is made of
//     almost nothing else. Mis-hearing the model name is the one error that
//     reliably wastes a lookup.
//   • ACCENTED speech. A general model asked to transcribe an unfamiliar accent
//     is guessing across the whole language; biasing it toward the handful of
//     terms that can plausibly occur in THIS conversation shrinks that space
//     dramatically. It is the closest thing to accent adaptation the API offers.
//
// Ordered most-distinctive first, because the list is capped and the head is
// what survives. Terms must also be SHORT: Scribe rejects any keyterm over 20
// characters, and rejects the entire list when one offends — so "Vanguard
// Interceptor MkII" does not go in, "Vanguard" does. That is no loss: the
// distinctive token is the one a recognizer needs help with, not the suffix.
// ─────────────────────────────────────────────────────────────────────────────

import { SHIP_MODELS } from "./data/seed";
import { ASSISTANT_NAME, SPEAKERS } from "./speakers";

/** Terms every conversation in this shop can be expected to contain. */
export function roomKeyterms(): string[] {
  const terms = new Set<string>();

  // Who they might address, first: getting the assistant's own name wrong is
  // the difference between a line aimed at her and one she ignores.
  terms.add(ASSISTANT_NAME);
  for (const s of SPEAKERS) terms.add(s.shortName);

  // The catalog, as the WORDS people actually say. "The Kestrel" is far more
  // common out loud than "the Kestrel L2 Hauler", and the leading proper noun
  // is the part a recognizer struggles with — the rest is ordinary English.
  for (const m of SHIP_MODELS) {
    for (const word of [...m.name.split(" "), ...m.manufacturer.split(" ")]) {
      const clean = word.replace(/[^A-Za-z0-9-]/g, "");
      // Skip short words and bare designators ("L2", "X", "MkII") — they carry
      // no acoustic distinctiveness on their own.
      if (clean.length > 3 && !/^\w?\d/.test(clean)) terms.add(clean);
    }
    terms.add(m.shipClass);
  }

  // The handful of domain words a first-time buyer will hear and repeat back.
  for (const t of [
    "Orbital Dynamics",
    "credits",
    "fold range",
    "light-year",
    "tonnes",
    "cargo bay",
    "hull",
    "drive",
    "warranty",
    "financing",
    "docking fees",
  ]) {
    terms.add(t);
  }

  return [...terms];
}
