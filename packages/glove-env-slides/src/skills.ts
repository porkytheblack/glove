/**
 * Worked recipes for env:slides, materialized under /skills.
 *
 * A deck is the artifact this environment is most often asked to *produce*,
 * and the one where a wrong guess is most expensive: the model does not see
 * the slide, so a table that ran off the bottom looks exactly like one that
 * fitted. Both recipes here end by reading the deck back.
 */
import type { StdlibAdapter } from "glove-working-environment";

type Skill = NonNullable<StdlibAdapter["skills"]>[number];

const QUICK: Skill = {
  name: "slides-quick",
  summary: "A presentable deck in one call: create(spec, output).",
  body: `# A deck in one call

\`create\` takes the spec FIRST, then the output path. It applies a consistent
layout — cover slide, rules, footer on a master — so you do not spend
decisions on styling.

\`\`\`js
import { create } from 'env:slides';

export default async function main() {
  return create({
    title: 'Q3 Revenue Review',
    subtitle: 'Prepared from transactions.csv and the annual report',
    footer: 'Confidential — internal',
    slides: [
      { title: 'Headline', metric: { value: '$4.4M', caption: 'total revenue, +18% vs plan' } },
      { title: 'By region', table: [['Region', 'Revenue'], ['EMEA', '$2,435,210']] },
      { title: 'Risks', bullets: ['Supplier concentration', '  single source for cells'] },
      { title: 'Trend', image: '/tmp/chart.png', body: 'Revenue by month.' },
    ],
  }, '/out/review.pptx');
}
\`\`\`

Per slide, pick ONE of \`bullets\`, \`table\`, \`metric\` or \`body\`. Two leading
spaces in a bullet indents it one level. \`notes\` adds speaker notes.

Then look at what you made — you cannot see the slide, so check it:

\`\`\`js
import { describe, outline } from 'env:slides';
const info = await describe('/out/review.pptx');   // { slides, titles, words, media }
\`\`\`
`,
};

const CUSTOM: Skill = {
  name: "slides-custom",
  summary: "Full control over a deck: pptxgenjs's own API, unchanged.",
  body: `# A deck laid out exactly how you want it

\`create\` covers the standard deck. When you need your own layout — a
two-column slide, a chart, particular colours and positions — use
\`PptxGenJS\` directly. It is the real library, so code written against
pptxgenjs's documentation works here as written.

Everything is synchronous until the write, which is the only await.

\`\`\`js
import { PptxGenJS } from 'env:slides';

export default async function main() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';        // 10 x 5.63 inches; positions are inches
  pptx.title = 'Q3 Revenue Review';

  const cover = pptx.addSlide();
  cover.addText('Q3 Revenue Review', { x: 0.6, y: 2.1, w: 8.8, h: 1, fontSize: 40, bold: true, color: '1A1A2E' });
  cover.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.9, w: 1.2, h: 0.06, fill: { color: '2563EB' } });

  const s = pptx.addSlide();
  s.addText('By region', { x: 0.6, y: 0.4, w: 8.8, h: 0.7, fontSize: 26, bold: true });
  s.addTable(
    [
      [{ text: 'Region', options: { bold: true, color: 'FFFFFF', fill: { color: '2563EB' } } },
       { text: 'Revenue', options: { bold: true, color: 'FFFFFF', fill: { color: '2563EB' } } }],
      ['EMEA', '$2,435,210'],
    ],
    { x: 0.6, y: 1.5, w: 4.2, fontSize: 13, border: { pt: 0.5, color: 'E5E7EB' },
      autoPage: true, autoPageRepeatHeader: true },     // long tables continue onto new slides
  );
  s.addImage({ path: '/tmp/chart.png', x: 5.2, y: 1.5, w: 4.2, h: 3.3, sizing: { type: 'contain', w: 4.2, h: 3.3 } });
  s.addNotes('Revenue is concentrated in EMEA.');

  return pptx.writeFile({ fileName: '/out/review.pptx' });
}
\`\`\`

Things worth knowing:

- **Positions are inches**, from the top-left. A 16:9 slide is 10 x 5.63.
- **Colours are hex without \`#\`**: \`'2563EB'\`.
- **\`addImage({ path })\` reads from the tree**, like every other path here.
- **\`autoPage: true\` on a long table.** Without it a 40-row table draws all
  40 rows on one slide, most of them past the bottom edge — and because the
  text is still in the file, reading it back finds every row and nothing
  looks wrong until someone opens the deck.
- **\`writeFile\` is the only await.** A deck you build and never write
  produces no file.
- **You cannot read values back off the object.** The whole document is
  recorded and replayed at the write, so a property read gives you nothing
  useful — \`pptx.slides\` and friends are not available mid-build. Compute
  what you need from your own data before you start.
- Repeating chrome (a footer) belongs on a master via \`defineSlideMaster\`,
  not stamped onto each slide — otherwise it comes back as a body line on
  every slide when the deck is read.

Check it afterwards: \`describe('/out/review.pptx')\` gives slide count and
titles, \`outline()\` gives the text of every slide.
`,
};

const EDITING: Skill = {
  name: "slides-editing",
  summary: "Fix text in a deck you were given, without rebuilding it: replaceText.",
  body: `# Editing a deck instead of regenerating it

'Fix the typo on slide 4' is an **edit**. Do not \`extract()\` the text and
\`create()\` a new deck — that rebuilds the file out of the only things
\`DeckSpec\` can express, and everything else is gone. Measured on a deck this
adapter wrote, the rebuild lost the chart image and the footer's slide layout.
On a deck a designer made, it would lose the design.

\`\`\`js
import { outline, replaceText } from 'env:slides';

export default async function main() {
  // Read it first — matching is literal, so copy the text exactly as written.
  const text = await outline('/inbox/q3.pptx');

  const edit = await replaceText('/inbox/q3.pptx', {
    'Nortwind Traders': 'Northwind Traders',
  }, { slides: 4, output: '/out/q3.pptx' });

  // → { path, replacements: 1, slides: [{ slide: 4, replacements: 1 }], unmatched: [] }
  if (edit.unmatched.length > 0) throw new Error('never found: ' + edit.unmatched.join(', '));
  return edit;
}
\`\`\`

Only the slide parts that matched are rewritten. Masters, layouts, themes,
\`ppt/media/*\` and animations are copied byte for byte.

## What it will and will not do

- **Will** find text split across formatting runs — PowerPoint starts a new run
  wherever formatting changes, so one visible line is often three runs.
- **Will** keep the replacement in the run its match started in, so a bold word
  stays bold.
- **Will** scope to a slide (\`{ slides: 4 }\`) or several (\`{ slides: [2, 4] }\`),
  numbered exactly as \`describe\` and \`extract\` number them. Omit it for the
  whole deck.
- **Will** leave speaker notes alone unless you pass \`{ notes: true }\`.
- **Will not** match across a paragraph break, and it is case-sensitive.
- **Will not** add slides, move them, or change a layout. For that, build a new
  deck with \`PptxGenJS\` — nothing can open an existing one.

If nothing matches, it throws rather than writing an identical deck, so a fix
that did not happen cannot be reported as one.
`,
};

export const SLIDES_SKILLS: Skill[] = [QUICK, CUSTOM, EDITING];
