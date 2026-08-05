/** Live check: real PDF -> real render -> real vision model. Not part of CI. */
import { createWorkingEnvironment, type VisionAdapter } from "glove-working-environment";
import { render } from "../src/index";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const MODEL = process.env.VISION_MODEL ?? "google/gemini-2.5-flash";

const vision: VisionAdapter = {
  async describe({ bytes, mediaType, prompt }) {
    const dataUrl = `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`vision ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content ?? "(empty)";
  },
};

const env = await createWorkingEnvironment({ vision, stdlib: [render()] });
try {
  // A report with one deliberate defect: the last row runs off the page.
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  // Two deliberate layout defects that text extraction cannot see:
  // the title overlaps a subtitle, and the last row runs off the right edge.
  page.drawText("Regional Revenue Q2", { x: 50, y: 780, size: 26, font });
  page.drawText("Prepared for the board", { x: 50, y: 774, size: 18 });
  const rows = [["East", "163,200"], ["North", "106,000"], ["South", "101,500"], ["West", "57,600"]];
  rows.forEach(([r, v], i) => {
    const offPage = i === 3;
    page.drawText(r, { x: offPage ? 480 : 50, y: 720 - i * 30, size: 14 });
    page.drawText(`$${v} for the western territory`, { x: offPage ? 540 : 200, y: 720 - i * 30, size: 14 });
  });
  page.drawRectangle({ x: 50, y: 560, width: 400, height: 6, color: rgb(0.62, 0.83, 0.72) });
  page.drawText("TOTAL  $428,300", { x: 50, y: 520, size: 16, font });
  await env.mount(new Uint8Array(await doc.save()), "/out/report.pdf");

  const view = env.tools.find((t) => t.name === "view_image")!;
  const result = await view.do({
    path: "/out/report.pdf",
    prompt:
      "This should be a revenue report listing exactly four regions with a total. " +
      "List every region and figure you can see, state the total, and say whether any text is cut off or overlapping.",
  });
  console.log("status:", result.status);
  console.log("---");
  console.log(String(result.data ?? result.message));
} finally {
  await env.close();
}
