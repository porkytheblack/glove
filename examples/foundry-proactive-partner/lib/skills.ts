import { readdir, readFile } from "node:fs/promises";
import type { ContentSkill } from "glove-core";

/**
 * The person's skills: how they like recurring jobs done, written once in
 * skills/*.md. The partner sees the list and reads one in full when it needs
 * it. The first line is the description.
 */
export async function loadSkills(): Promise<ContentSkill[]> {
  const folder = new URL("../skills/", import.meta.url);
  const names = (await readdir(folder)).filter((name) => name.endsWith(".md"));
  return Promise.all(names.map(async (name) => {
    const content = await readFile(new URL(name, folder), "utf8");
    return { name: name.replace(/\.md$/, ""), description: content.split("\n")[0]!.replace(/^#\s*/, ""), content };
  }));
}
