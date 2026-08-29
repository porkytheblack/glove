export function normalizeStormId(value: string): string {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return clean || `storm-${Date.now()}`;
}
