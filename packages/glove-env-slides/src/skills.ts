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
- Repeating chrome (a footer) belongs on a master via \`defineSlideMaster\`,
  not stamped onto each slide — otherwise it comes back as a body line on
  every slide when the deck is read.

Check it afterwards: \`describe('/out/review.pptx')\` gives slide count and
titles, \`outline()\` gives the text of every slide.
`,
};

export const SLIDES_SKILLS: Skill[] = [QUICK, CUSTOM];
