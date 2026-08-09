import sharp from "sharp";

async function frame(w, h, colour) {
  return sharp({ create: { width: w, height: h, channels: 3, background: colour } }).png().toBuffer();
}

async function makeGif(n = 4, w = 40, h = 20) {
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(await frame(w, h, { r: i * 60, g: 255 - i * 60, b: 100 }));
  return sharp(frames, { join: { animated: true } }).gif().toBuffer();
}

const gif = await makeGif();
const src = await sharp(gif, { animated: true }).metadata();
console.log("source pages", src.pages, "delay", src.delay, "loop", src.loop, "size", src.width + "x" + src.height, "pageHeight", src.pageHeight);

async function report(label, fn) {
  try {
    const buf = await fn();
    const m = await sharp(buf, { animated: true }).metadata();
    console.log(label.padEnd(36), "→ pages", String(m.pages).padEnd(3), (m.width + "x" + m.height).padEnd(10), "pageHeight", String(m.pageHeight).padEnd(5), "fmt", m.format, "delay", JSON.stringify(m.delay));
  } catch (e) {
    console.log(label.padEnd(36), "→ ERROR", e.message.split("\n")[0]);
  }
}

await report("resize animated", () => sharp(gif, { animated: true }).resize({ width: 20, height: 10 }).gif().toBuffer());
await report("resize NOT animated", () => sharp(gif).resize({ width: 20, height: 10 }).gif().toBuffer());
await report("resize animated→webp", () => sharp(gif, { animated: true }).resize({ width: 20 }).webp().toBuffer());
await report("resize animated→png", () => sharp(gif, { animated: true }).resize({ width: 20 }).png().toBuffer());
await report("convert animated→webp", () => sharp(gif, { animated: true }).webp().toBuffer());
await report("convert animated→jpeg", () => sharp(gif, { animated: true }).jpeg().toBuffer());
await report("rotate 90 animated", () => sharp(gif, { animated: true }).rotate(90).gif().toBuffer());
await report("rotate 180 animated", () => sharp(gif, { animated: true }).rotate(180).gif().toBuffer());
await report("rotate autoorient animated", () => sharp(gif, { animated: true }).rotate().gif().toBuffer());
await report("extract animated", () => sharp(gif, { animated: true }).extract({ left: 5, top: 5, width: 10, height: 10 }).gif().toBuffer());
await report("thumb cover animated", () => sharp(gif, { animated: true }).resize({ width: 16, height: 16, fit: "cover" }).gif().toBuffer());
await report("resize contain animated", () => sharp(gif, { animated: true }).resize({ width: 30, height: 30, fit: "contain", background: "#000000" }).gif().toBuffer());
await report("stats animated (no-op)", async () => gif);
