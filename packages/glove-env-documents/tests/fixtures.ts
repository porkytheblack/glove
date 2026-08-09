/**
 * Fixtures the form and font tests need, built rather than committed.
 *
 * A checked-in .pdf would hide the thing under test — which field names a form
 * has, which glyphs a font carries — behind an opaque blob nobody re-reads.
 * These are produced here so the expectations and the fixture stay in one
 * place, and so a change to either shows up as a diff rather than as a
 * mysterious failure.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * A real TrueType font, taken from the `pdfjs-dist` dev dependency this
 * package already installs.
 *
 * The host's own `/usr/share/fonts` is not a fixture: a CI image without
 * fontconfig has none, and one with a different distribution has different
 * ones. Liberation Sans ships inside a package in the lockfile, so the bytes
 * are the same everywhere the tests run — and it carries Latin, Greek and
 * Cyrillic, which is enough to prove the non-Latin path without shipping a
 * multi-megabyte CJK face.
 */
export function liberationSans(): Uint8Array {
  const require = createRequire(import.meta.url);
  return new Uint8Array(readFileSync(require.resolve("pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf")));
}

/** The same family's bold cut, for the two-face case. */
export function liberationSansBold(): Uint8Array {
  const require = createRequire(import.meta.url);
  return new Uint8Array(readFileSync(require.resolve("pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf")));
}

/**
 * A fillable application form: one of every field kind `fillForm` handles.
 *
 * Built with pdf-lib's own form API — which this adapter deliberately does not
 * expose — so the fixture is an *independent* producer of the thing the
 * bindings read. A bug symmetric across read and write would otherwise
 * round-trip unnoticed.
 */
export async function makeAcroForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const form = doc.getForm();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);

  const name = form.createTextField("applicant.name");
  name.setText("");
  name.addToPage(page, { x: 20, y: 250, width: 250, height: 20 });

  form.createCheckBox("applicant.agree").addToPage(page, { x: 20, y: 210, width: 15, height: 15 });

  const plan = form.createDropdown("applicant.plan");
  plan.setOptions(["Basic", "Pro", "Enterprise"]);
  plan.addToPage(page, { x: 20, y: 170, width: 150, height: 20 });

  const contact = form.createRadioGroup("applicant.contact");
  contact.addOptionToPage("Email", page, { x: 20, y: 130, width: 15, height: 15 });
  contact.addOptionToPage("Phone", page, { x: 80, y: 130, width: 15, height: 15 });

  form.updateFieldAppearances(helvetica);
  return doc.save();
}
